/**
 * FTP 服务端底层协议引擎 (ftp-server-backend)
 * 纯原生 Node.js 实现，不依赖任何第三方库
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

function destroyQuietly(stream) {
    if (!stream || typeof stream.destroy !== 'function' || stream.destroyed) return;
    try { stream.destroy(); } catch (_) {}
}

function pipeDataTransfer(source, destination) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            destination.removeListener('finish', handleFinish);
            source.removeListener('error', handleError);
            destination.removeListener('error', handleError);
        };
        const settle = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) {
                try { source.unpipe(destination); } catch (_) {}
                destroyQuietly(source);
                destroyQuietly(destination);
                reject(error);
                return;
            }
            resolve();
        };
        const handleFinish = () => settle();
        const handleError = (error) => settle(error);

        source.on('error', handleError);
        destination.on('error', handleError);
        destination.once('finish', handleFinish);

        try {
            source.pipe(destination);
        } catch (error) {
            settle(error);
        }
    });
}

function sendDataAndClose(dataSocket, data, encoding = 'utf8') {
    return new Promise((resolve, reject) => {
        let settled = false;
        const handleError = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        dataSocket.once('error', handleError);
        try {
            dataSocket.end(data, encoding, (error) => {
                if (error) {
                    handleError(error);
                    return;
                }
                if (settled) return;
                settled = true;
                dataSocket.removeListener('error', handleError);
                resolve();
            });
        } catch (error) {
            handleError(error);
        }
    });
}

class FtpServerBackend {
    constructor(options) {
        this.port = options.port || 21;
        this.host = options.host || '0.0.0.0';
        this.username = options.username || 'anonymous';
        this.password = options.password || '';
        this.rootDirectory = options.rootDirectory || os.homedir();
        this.timeout = (options.timeout || 300) * 1000; // 毫秒
        this.onLog = options.onLog || (() => {});
        this.server = null;
        this.connections = new Set();
    }

    /**
     * 启动服务器
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.handleConnection(socket);
            });

            this.server.on('error', (err) => {
                this.log(`服务器启动错误: ${err.message}`);
                reject(err);
            });

            this.server.listen(this.port, this.host, () => {
                this.log(`FTP 服务端已成功启动，正在监听 ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    /**
     * 关闭服务器
     */
    stop() {
        return new Promise((resolve) => {
            for (const socket of this.connections) {
                try {
                    socket.write('421 Service not available, closing control connection.\r\n');
                    socket.destroy();
                } catch (e) {}
            }
            this.connections.clear();

            if (this.server) {
                this.server.close(() => {
                    this.log('FTP 服务端已完全关闭');
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * 输出日志
     */
    log(message) {
        this.onLog(message);
    }

    /**
     * 处理客户端控制连接
     */
    handleConnection(socket) {
        this.connections.add(socket);
        socket.setTimeout(this.timeout);

        const session = {
            username: null,
            isAuthenticated: false,
            currentDir: '/', // 虚拟当前路径 (相对于根目录)
            type: 'I', // 默认二进制模式
            passiveServer: null,
            passivePort: null,
            activeAddr: null,
            activePort: null,
            dataSocket: null,
            dataSocketError: null
        };

        const clientIp = socket.remoteAddress;
        const clientPort = socket.remotePort;
        this.log(`[连接] 来自 ${clientIp}:${clientPort} 的客户端已建立连接`);
        socket.write('220 FTP Server Ready\r\n');

        let buffer = '';
        socket.on('data', (data) => {
            buffer += data.toString('utf8');
            const lines = buffer.split('\r\n');
            buffer = lines.pop(); // 保存未读完的部分

            for (const line of lines) {
                if (line.trim() === '') continue;
                this.handleCommand(socket, session, line);
            }
        });

        socket.on('error', (err) => {
            this.log(`[连接异常] ${clientIp}:${clientPort} - ${err.message}`);
        });

        socket.on('timeout', () => {
            this.log(`[连接超时] ${clientIp}:${clientPort} 超时关闭`);
            socket.write('421 Timeout, goodbye.\r\n');
            socket.destroy();
        });

        socket.on('close', () => {
            this.connections.delete(socket);
            this.log(`[连接断开] ${clientIp}:${clientPort} 的控制通道已断开`);
            if (session.passiveServer) {
                try { session.passiveServer.close(); } catch (e) {}
            }
            if (session.dataSocket) {
                try { session.dataSocket.destroy(); } catch (e) {}
            }
        });
    }

    /**
     * 计算安全的系统物理路径，强力防范目录穿越漏洞 (Directory Traversal)
     */
    getRealPath(session, arg) {
        let virtualPath;
        if (arg.startsWith('/')) {
            virtualPath = path.normalize(arg);
        } else {
            virtualPath = path.normalize(path.join(session.currentDir, arg));
        }

        // 统一分隔符为斜杠
        virtualPath = virtualPath.replace(/\\/g, '/');
        if (!virtualPath.startsWith('/')) {
            virtualPath = '/' + virtualPath;
        }

        // 去除多余的 .. 目录穿越企图
        const parts = virtualPath.split('/').filter(p => p !== '' && p !== '.');
        const stack = [];
        for (const part of parts) {
            if (part === '..') {
                stack.pop();
            } else {
                stack.push(part);
            }
        }

        const resolvedVirtualPath = '/' + stack.join('/');
        const realPath = path.join(this.rootDirectory, resolvedVirtualPath);

        // 二重安全审计：验证最终解析物理路径是否仍在用户主目录下
        const relative = path.relative(this.rootDirectory, realPath);
        const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);
        const safeRealPath = (relative === '' || isSafe) ? realPath : this.rootDirectory;
        const safeVirtualPath = (relative === '' || isSafe) ? resolvedVirtualPath : '/';

        return {
            virtualPath: safeVirtualPath,
            realPath: safeRealPath
        };
    }

    /**
     * 处理协议指令
     */
    handleCommand(socket, session, line) {
        const spaceIndex = line.indexOf(' ');
        let cmd = spaceIndex === -1 ? line : line.substring(0, spaceIndex);
        let arg = spaceIndex === -1 ? '' : line.substring(spaceIndex + 1);

        cmd = cmd.toUpperCase().trim();
        arg = arg.trim();

        // 打印指令日志，避免密码泄露
        this.log(`[指令] ${socket.remoteAddress}:${socket.remotePort} > ${cmd} ${cmd === 'PASS' ? '******' : arg}`);

        // 用户身份认证守卫
        if (!session.isAuthenticated && cmd !== 'USER' && cmd !== 'PASS' && cmd !== 'QUIT') {
            socket.write('530 Please login with USER and PASS first.\r\n');
            return;
        }

        switch (cmd) {
            case 'USER':
                session.username = arg;
                socket.write('331 User name okay, need password.\r\n');
                break;

            case 'PASS':
                if (session.username === this.username && arg === this.password) {
                    session.isAuthenticated = true;
                    socket.write('230 User logged in, proceed.\r\n');
                    this.log(`[认证成功] 用户 "${session.username}" 登录成功`);
                } else {
                    socket.write('530 Username or password incorrect.\r\n');
                    this.log(`[认证失败] 尝试用户名: "${session.username}"`);
                }
                break;

            case 'SYST':
                socket.write('215 UNIX Type: L8\r\n');
                break;

            case 'FEAT':
                socket.write('211-Features supported\r\n PASV\r\n PORT\r\n TYPE\r\n LIST\r\n RETR\r\n STOR\r\n CWD\r\n CDUP\r\n PWD\r\n QUIT\r\n SIZE\r\n DELE\r\n MKD\r\n RMD\r\n211 End\r\n');
                break;

            case 'PWD':
                socket.write(`257 "${session.currentDir}" is current directory.\r\n`);
                break;

            case 'TYPE':
                session.type = arg.toUpperCase();
                socket.write(`200 Type set to ${session.type}.\r\n`);
                break;

            case 'CWD':
                this.handleCwd(socket, session, arg);
                break;

            case 'CDUP':
                this.handleCwd(socket, session, '..');
                break;

            case 'PASV':
                this.handlePasv(socket, session);
                break;

            case 'PORT':
                this.handlePort(socket, session, arg);
                break;

            case 'LIST':
                this.handleList(socket, session);
                break;

            case 'RETR':
                this.handleRetr(socket, session, arg);
                break;

            case 'STOR':
                this.handleStor(socket, session, arg);
                break;

            case 'SIZE':
                this.handleSize(socket, session, arg);
                break;

            case 'DELE':
                this.handleDele(socket, session, arg);
                break;

            case 'MKD':
                this.handleMkd(socket, session, arg);
                break;

            case 'RMD':
                this.handleRmd(socket, session, arg);
                break;

            case 'QUIT':
                socket.write('221 Goodbye.\r\n');
                socket.end();
                break;

            default:
                socket.write('502 Command not implemented.\r\n');
                break;
        }
    }

    /**
     * 切换目录 (CWD/CDUP)
     */
    handleCwd(socket, session, arg) {
        const { virtualPath, realPath } = this.getRealPath(session, arg);
        try {
            const stat = fs.statSync(realPath);
            if (stat.isDirectory()) {
                session.currentDir = virtualPath;
                socket.write('250 Directory successfully changed.\r\n');
                this.log(`[CWD] 切换虚拟工作路径至: ${virtualPath}`);
            } else {
                socket.write('550 Not a directory.\r\n');
            }
        } catch (e) {
            socket.write('550 Directory not found.\r\n');
        }
    }

    /**
     * 被动模式协商 (PASV)
     */
    handlePasv(socket, session) {
        if (session.passiveServer) {
            try { session.passiveServer.close(); } catch (e) {}
        }
        destroyQuietly(session.dataSocket);
        session.dataSocket = null;
        session.passivePort = null;
        session.dataSocketError = null;

        // 创建被动数据端口服务器监听连接
        const passiveServer = net.createServer((dataSocket) => {
            session.dataSocket = dataSocket;
            dataSocket.on('error', (err) => {
                this.log(`[数据通道错误] 被动连接异常: ${err.message}`);
                if (session.dataSocket === dataSocket) {
                    session.dataSocket = null;
                    session.dataSocketError = err;
                    destroyQuietly(dataSocket);
                }
            });
            // 收到连接后立刻停止数据服务器监听，保证单次会话安全性
            try { passiveServer.close(); } catch (e) {}
            if (session.passiveServer === passiveServer) {
                session.passiveServer = null;
            }
        });
        session.passiveServer = passiveServer;

        passiveServer.on('error', (err) => {
            this.log(`[被动模式错误] 数据端口监听失败: ${err.message}`);
            if (session.passiveServer === passiveServer) {
                session.passiveServer = null;
                session.passivePort = null;
                session.dataSocketError = err;
            }
            try { passiveServer.close(); } catch (_) {}
            try { socket.write(`425 Can't open passive connection: ${err.message}.\r\n`); } catch (_) {}
        });

        // 端口设为 0 以获取系统闲置随机端口
        passiveServer.listen(0, this.host, () => {
            const port = passiveServer.address().port;
            session.passivePort = port;

            const p1 = Math.floor(port / 256);
            const p2 = port % 256;

            // 获取绑定 IP 地址并过滤 ::ffff:
            let ip = this.host;
            if (ip === '0.0.0.0' || ip === '::') {
                ip = socket.localAddress;
            }
            if (ip.startsWith('::ffff:')) {
                ip = ip.substring(7);
            }
            if (ip === '::1') {
                ip = '127.0.0.1';
            }

            const ipParts = ip.split('.');
            if (ipParts.length !== 4) {
                // 回退本机默认网卡
                ipParts[0] = '127'; ipParts[1] = '0'; ipParts[2] = '0'; ipParts[3] = '1';
            }

            socket.write(`227 Entering Passive Mode (${ipParts.join(',')},${p1},${p2}).\r\n`);
            this.log(`[被动模式] 已在端口 ${port} 启动临时数据通道监听`);
        });
    }

    /**
     * 主动模式协商 (PORT)
     */
    handlePort(socket, session, arg) {
        const parts = arg.split(',');
        if (parts.length !== 6) {
            socket.write('501 Syntax error in IP address/port.\r\n');
            return;
        }

        const ip = parts.slice(0, 4).join('.');
        const port = parseInt(parts[4]) * 256 + parseInt(parts[5]);

        session.activeAddr = ip;
        session.activePort = port;
        destroyQuietly(session.dataSocket);
        session.dataSocket = null; // 清除已有的被动套接字
        session.dataSocketError = null;
        session.passivePort = null;

        socket.write('200 PORT command successful.\r\n');
        this.log(`[主动模式] 记录客户端连接方向: ${ip}:${port}`);
    }

    /**
     * 获取就绪的数据通道
     */
    getDataConnection(session) {
        return new Promise((resolve, reject) => {
            const takePassiveSocket = () => {
                if (session.dataSocketError) {
                    const error = session.dataSocketError;
                    session.dataSocketError = null;
                    session.passivePort = null;
                    reject(error);
                    return true;
                }
                if (!session.dataSocket) return false;
                const ds = session.dataSocket;
                session.dataSocket = null;
                session.passivePort = null;
                if (ds.destroyed) {
                    reject(new Error('被动模式数据连接已关闭'));
                } else {
                    resolve(ds);
                }
                return true;
            };

            // 被动模式：客户端已连接上来
            if (takePassiveSocket()) return;

            // 被动模式：客户端连接还在挂起，等待最多 5000ms
            if (session.passivePort) {
                let checkAttempts = 0;
                const interval = setInterval(() => {
                    if (session.dataSocket || session.dataSocketError) {
                        clearInterval(interval);
                        takePassiveSocket();
                    } else if (++checkAttempts >= 25) { // 5000ms timeout
                        clearInterval(interval);
                        session.passivePort = null;
                        reject(new Error('等待被动模式数据连接超时'));
                    }
                }, 200);
                return;
            }

            // 主动模式：服务器需要向客户端建立连接
            if (session.activeAddr && session.activePort) {
                this.log(`[数据通道] 正在主动连回客户端 ${session.activeAddr}:${session.activePort}`);
                let settled = false;
                const ds = net.connect(session.activePort, session.activeAddr, () => {
                    if (settled) return;
                    settled = true;
                    resolve(ds);
                });
                ds.on('error', (err) => {
                    this.log(`[数据通道错误] 主动连接异常: ${err.message}`);
                    if (settled) return;
                    settled = true;
                    reject(err);
                });
                return;
            }

            reject(new Error('未就绪的被动(PASV)或主动(PORT)数据传输信道'));
        });
    }

    /**
     * 读取目录列表 (LIST)
     */
    async handleList(socket, session) {
        const { realPath } = this.getRealPath(session, '.');
        this.log(`[数据传输] 开始获取目录文件列表: ${session.currentDir}`);
        let dataSocket = null;

        try {
            dataSocket = await this.getDataConnection(session);
            socket.write('150 Here comes the directory listing.\r\n');

            let files = [];
            try {
                files = fs.readdirSync(realPath);
            } catch (err) {}

            let responseData = '';
            for (const file of files) {
                const fullPath = path.join(realPath, file);
                try {
                    const stat = fs.statSync(fullPath);
                    const isDir = stat.isDirectory();
                    const size = stat.size;

                    // UNIX 标准格式：-rw-r--r--    1 owner    group         1024 Jun 03 09:30 filename
                    const mode = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
                    const mtime = stat.mtime;
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = months[mtime.getMonth()];
                    const day = String(mtime.getDate()).padStart(2, ' ');
                    const hour = String(mtime.getHours()).padStart(2, '0');
                    const min = String(mtime.getMinutes()).padStart(2, '0');
                    const timeStr = `${hour}:${min}`;

                    responseData += `${mode}    1 owner    group     ${String(size).padStart(10, ' ')} ${month} ${day} ${timeStr} ${file}\r\n`;
                } catch (e) {}
            }

            await sendDataAndClose(dataSocket, responseData, 'utf8');
            socket.write('226 Directory send OK.\r\n');
            this.log(`[数据传输] 成功发送目录文件列表: ${session.currentDir}`);
        } catch (err) {
            socket.write(dataSocket
                ? `451 Directory transfer aborted: ${err.message}.\r\n`
                : `425 Can't open data connection: ${err.message}.\r\n`);
            this.log(`[数据传输错误] LIST 失败: ${err.message}`);
        }
    }

    /**
     * 下载文件 (RETR)
     */
    async handleRetr(socket, session, arg) {
        const { realPath } = this.getRealPath(session, arg);
        this.log(`[数据传输] 客户端下载请求: ${realPath}`);
        let dataSocket = null;

        try {
            dataSocket = await this.getDataConnection(session);

            if (!fs.existsSync(realPath) || fs.statSync(realPath).isDirectory()) {
                socket.write('550 File not found or is a directory.\r\n');
                dataSocket.destroy();
                return;
            }

            socket.write('150 Opening BINARY mode data connection.\r\n');

            const readStream = fs.createReadStream(realPath);
            await pipeDataTransfer(readStream, dataSocket);
            try { socket.write('226 Transfer complete.\r\n'); } catch (e) {}
            this.log(`[数据传输成功] 下载成功: ${realPath}`);
        } catch (err) {
            try {
                socket.write(dataSocket
                    ? `451 File transfer aborted: ${err.message}.\r\n`
                    : `425 Can't open data connection: ${err.message}.\r\n`);
            } catch (e) {}
            this.log(`[数据传输错误] RETR 失败: ${err.message}`);
        }
    }

    /**
     * 上传文件 (STOR)
     */
    async handleStor(socket, session, arg) {
        const { realPath } = this.getRealPath(session, arg);
        this.log(`[数据传输] 客户端上传请求: ${realPath}`);
        let dataSocket = null;

        try {
            dataSocket = await this.getDataConnection(session);
            socket.write('150 Ok to send data.\r\n');

            const writeStream = fs.createWriteStream(realPath);
            await pipeDataTransfer(dataSocket, writeStream);
            try { socket.write('226 Transfer complete.\r\n'); } catch (e) {}
            this.log(`[数据传输成功] 上传成功: ${realPath}`);
        } catch (err) {
            try {
                socket.write(dataSocket
                    ? `451 File transfer aborted: ${err.message}.\r\n`
                    : `425 Can't open data connection: ${err.message}.\r\n`);
            } catch (e) {}
            this.log(`[数据传输错误] STOR 失败: ${err.message}`);
        }
    }

    /**
     * 获取文件大小 (SIZE)
     */
    handleSize(socket, session, arg) {
        const { realPath } = this.getRealPath(session, arg);
        try {
            const stat = fs.statSync(realPath);
            if (stat.isFile()) {
                socket.write(`213 ${stat.size}\r\n`);
            } else {
                socket.write('550 Not a regular file.\r\n');
            }
        } catch (err) {
            socket.write('550 File not found.\r\n');
        }
    }

    /**
     * 删除文件 (DELE)
     */
    handleDele(socket, session, arg) {
        const { realPath } = this.getRealPath(session, arg);
        try {
            fs.unlinkSync(realPath);
            socket.write('250 File deleted.\r\n');
            this.log(`[删除文件] 成功删除文件: ${realPath}`);
        } catch (err) {
            socket.write(`550 Action not taken: ${err.message}.\r\n`);
        }
    }

    /**
     * 新建文件夹 (MKD)
     */
    handleMkd(socket, session, arg) {
        const { virtualPath, realPath } = this.getRealPath(session, arg);
        try {
            fs.mkdirSync(realPath);
            socket.write(`257 "${virtualPath}" created.\r\n`);
            this.log(`[新建目录] 成功创建目录: ${realPath}`);
        } catch (err) {
            socket.write(`550 Action not taken: ${err.message}.\r\n`);
        }
    }

    /**
     * 删除空文件夹 (RMD)
     */
    handleRmd(socket, session, arg) {
        const { realPath } = this.getRealPath(session, arg);
        try {
            fs.rmdirSync(realPath);
            socket.write('250 Directory removed.\r\n');
            this.log(`[删除目录] 成功删除目录: ${realPath}`);
        } catch (err) {
            socket.write(`550 Action not taken: ${err.message}.\r\n`);
        }
    }
}

module.exports = FtpServerBackend;
