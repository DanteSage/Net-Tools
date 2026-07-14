/**
 * TFTP 服务端底层协议引擎 (tftp-server-backend)
 * 纯原生 Node.js 实现，不依赖任何第三方库
 * 支持 RFC 1350 (TFTP), RFC 2347 (Option Extension), RFC 2348 (Blocksize Option), RFC 2349 (Timeout & Transfer Size Options)
 */
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

class TftpServerBackend extends EventEmitter {
    constructor(options) {
        super();
        this.port = options.port || 69;
        this.host = options.host || '0.0.0.0';
        this.rootDirectory = options.rootDirectory || os.homedir();
        this.writable = options.writable !== undefined ? options.writable : true; // 允许写入 (WRQ)
        this.timeout = (options.timeout || 3) * 1000; // 毫秒
        this.retries = options.retries || 5;
        this.maxBlockSize = options.maxBlockSize || 1468; // 适配 MTU

        this.serverSocket = null;
        this.sessions = new Map(); // key -> session object
    }

    /**
     * 启动 TFTP 服务器
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.serverSocket = dgram.createSocket('udp4');

                this.serverSocket.on('error', (err) => {
                    this.log(`主套接字错误: ${err.message}`, 'error');
                    this.stop();
                    reject(err);
                });

                this.serverSocket.on('message', (msg, rinfo) => {
                    this.handleInitialRequest(msg, rinfo);
                });

                this.serverSocket.bind(this.port, this.host, () => {
                    this.log(`TFTP 服务端已成功启动，正在监听 ${this.host}:${this.port}`, 'success');
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 停止 TFTP 服务器
     */
    stop() {
        return new Promise((resolve) => {
            // 清理所有活跃会话
            for (const [key, session] of this.sessions.entries()) {
                this.cleanupSession(key, '服务器停止，传输中止');
            }
            this.sessions.clear();

            if (this.serverSocket) {
                try {
                    this.serverSocket.close(() => {
                        this.log('TFTP 服务端已完全关闭', 'info');
                        this.serverSocket = null;
                        resolve();
                    });
                } catch (e) {
                    this.serverSocket = null;
                    resolve();
                }
            } else {
                resolve();
            }
        });
    }

    /**
     * 记录日志
     */
    log(message, type = 'info') {
        this.emit('log', {
            time: new Date().toLocaleTimeString(),
            type,
            message
        });
    }

    /**
     * 广播当前的传输进度列表
     */
    broadcastTransfers() {
        const transferList = Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            filename: s.filename,
            client: s.clientStr,
            type: s.type === 'RRQ' ? 'download' : 'upload',
            bytesTransferred: s.bytesTransferred,
            totalBytes: s.totalBytes,
            progress: s.totalBytes ? Math.min(100, Math.round((s.bytesTransferred / s.totalBytes) * 100)) : 0,
            status: s.status,
            error: s.errorMsg || ''
        }));
        this.emit('transfers', transferList);
    }

    /**
     * 路径安全性校验 (防目录穿越)
     */
    getRealPath(filename) {
        // 替换反斜杠，去除可能的 UNC 路径前缀
        let safeFilename = filename.replace(/\\/g, '/');
        if (safeFilename.startsWith('/')) {
            safeFilename = safeFilename.substring(1);
        }

        // 标准化绝对物理路径
        const resolvedPath = path.normalize(path.join(this.rootDirectory, safeFilename));
        
        // 校验路径是否以根目录路径开头
        const relative = path.relative(this.rootDirectory, resolvedPath);
        const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);
        
        return {
            isSafe: (relative === '' || isSafe),
            realPath: resolvedPath
        };
    }

    /**
     * 解析请求包 (RRQ/WRQ)
     */
    parseRequest(msg) {
        let offset = 2;

        const readNullTerminatedString = () => {
            const start = offset;
            while (offset < msg.length && msg[offset] !== 0) {
                offset++;
            }
            if (offset >= msg.length) return null;
            const str = msg.toString('utf8', start, offset);
            offset++; // 跳过 null 字节
            return str;
        };

        const filename = readNullTerminatedString();
        if (filename === null) return null;

        const mode = readNullTerminatedString();
        if (mode === null) return null;

        // 解析选项 (RFC 2347)
        const options = {};
        while (offset < msg.length) {
            const optName = readNullTerminatedString();
            if (!optName) break;
            const optValue = readNullTerminatedString();
            if (optValue === null) break;
            options[optName.toLowerCase()] = optValue;
        }

        return { filename, mode: mode.toLowerCase(), options };
    }

    /**
     * 处理收到的初始请求 (监听在端口 69)
     */
    handleInitialRequest(msg, rinfo) {
        if (msg.length < 4) return;
        const opcode = msg.readUInt16BE(0);

        if (opcode !== 1 && opcode !== 2) {
            // 非法操作码
            this.sendRawError(rinfo, 4, 'Illegal TFTP operation');
            return;
        }

        const parsed = this.parseRequest(msg);
        if (!parsed) {
            this.sendRawError(rinfo, 4, 'Malformed request packet');
            return;
        }

        const { filename, mode, options } = parsed;
        const typeStr = opcode === 1 ? 'RRQ' : 'WRQ';
        const clientStr = `${rinfo.address}:${rinfo.port}`;

        this.log(`[请求] 来自 ${clientStr} 的 ${typeStr} 请求: "${filename}" (模式: ${mode})`, 'info');

        // 安全审计：防路径穿越
        const { isSafe, realPath } = this.getRealPath(filename);
        if (!isSafe) {
            this.log(`[安全审计] 拒绝来自 ${clientStr} 试图访问根目录外的路径: "${filename}"`, 'error');
            this.sendRawError(rinfo, 2, 'Access violation: Path out of root directory');
            return;
        }

        // 读写权限与文件状态验证
        if (opcode === 1) { // RRQ 读
            if (!fs.existsSync(realPath)) {
                this.log(`[RRQ 错误] 文件不存在: "${realPath}"`, 'error');
                this.sendRawError(rinfo, 1, 'File not found');
                return;
            }
            try {
                const stat = fs.statSync(realPath);
                if (stat.isDirectory()) {
                    this.log(`[RRQ 错误] 请求的路径是文件夹: "${realPath}"`, 'error');
                    this.sendRawError(rinfo, 2, 'Access violation: Is a directory');
                    return;
                }
            } catch (err) {
                this.sendRawError(rinfo, 0, err.message);
                return;
            }
        } else { // WRQ 写
            if (!this.writable) {
                this.log(`[WRQ 错误] 上传请求被拒绝，当前服务端配置为“只读”`, 'error');
                this.sendRawError(rinfo, 2, 'Access violation: Write transfers are disabled');
                return;
            }
            // 确保父目录存在
            const parentDir = path.dirname(realPath);
            if (!fs.existsSync(parentDir)) {
                this.log(`[WRQ 错误] 目标目录不存在: "${parentDir}"`, 'error');
                this.sendRawError(rinfo, 1, 'Directory not found');
                return;
            }
        }

        // 创建新会话
        const sessionKey = `${rinfo.address}:${rinfo.port}`;
        if (this.sessions.has(sessionKey)) {
            // 如果旧传输还存在，先清理
            this.cleanupSession(sessionKey, '新会话请求到来，强行覆盖');
        }

        const sessionSocket = dgram.createSocket('udp4');
        const session = {
            id: sessionKey,
            type: typeStr,
            filename,
            realPath,
            clientRinfo: rinfo,
            clientStr,
            socket: sessionSocket,
            fd: null,
            fileOffset: 0,
            bytesTransferred: 0,
            totalBytes: 0,
            blksize: 512, // 默认 512
            timeout: this.timeout, // 毫秒
            blockNum: 0,
            lastPacket: null, // 缓存上个发出的包用于重传
            retransmitCount: 0,
            timer: null,
            status: 'transferring',
            optionsNegotiated: {}
        };

        // 协商参数选项
        let oackNeeded = false;
        if (options.blksize) {
            const reqBlk = parseInt(options.blksize);
            if (!isNaN(reqBlk) && reqBlk >= 8 && reqBlk <= 65464) {
                // 限制在 maxBlockSize 内
                session.blksize = Math.min(reqBlk, this.maxBlockSize);
                session.optionsNegotiated['blksize'] = String(session.blksize);
                oackNeeded = true;
            }
        }

        if (options.timeout) {
            const reqTo = parseInt(options.timeout);
            if (!isNaN(reqTo) && reqTo >= 1 && reqTo <= 255) {
                session.timeout = reqTo * 1000;
                session.optionsNegotiated['timeout'] = String(reqTo);
                oackNeeded = true;
            }
        }

        if (options.tsize) {
            if (opcode === 1) { // RRQ
                try {
                    const stat = fs.statSync(realPath);
                    session.totalBytes = stat.size;
                    session.optionsNegotiated['tsize'] = String(session.totalBytes);
                    oackNeeded = true;
                } catch (_) {}
            } else { // WRQ
                const reqSz = parseInt(options.tsize);
                if (!isNaN(reqSz)) {
                    session.totalBytes = reqSz;
                    session.optionsNegotiated['tsize'] = String(reqSz);
                    oackNeeded = true;
                }
            }
        }

        // 打开文件描述符
        try {
            if (opcode === 1) {
                session.fd = fs.openSync(realPath, 'r');
                const stat = fs.fstatSync(session.fd);
                session.totalBytes = stat.size;
            } else {
                session.fd = fs.openSync(realPath, 'w');
            }
        } catch (err) {
            this.log(`[文件访问错误] 无法打开文件 "${realPath}": ${err.message}`, 'error');
            this.sendRawError(rinfo, 2, `Access violation: ${err.message}`);
            sessionSocket.close();
            return;
        }

        this.sessions.set(sessionKey, session);

        // 设置会话 socket 接收回调
        sessionSocket.on('message', (msg, remoteInfo) => {
            // 校验客户端端口和地址是否正确
            if (remoteInfo.address !== rinfo.address || remoteInfo.port !== rinfo.port) {
                // 发送 ERROR 5
                this.sendSocketError(sessionSocket, remoteInfo, 5, 'Unknown transfer ID');
                return;
            }
            this.handleSessionMessage(session, msg);
        });

        sessionSocket.on('error', (err) => {
            this.handleSessionError(session, `套接字错误: ${err.message}`);
        });

        // 绑定到随机空闲端口
        sessionSocket.bind(0, this.host, () => {
            this.log(`[会话创建] ${clientStr} -> 临时端口 ${sessionSocket.address().port}`, 'info');

            if (oackNeeded) {
                // 发送 OACK
                this.sendOack(session);
            } else {
                if (opcode === 1) {
                    // RRQ: 发送第一块 DATA 1
                    session.blockNum = 1;
                    this.sendNextDataBlock(session);
                } else {
                    // WRQ: 发送 ACK 0
                    session.blockNum = 0;
                    this.sendAck(session, 0);
                }
            }
            this.broadcastTransfers();
        });
    }

    /**
     * 处理活跃传输会话发来的报文
     */
    handleSessionMessage(session, msg) {
        if (msg.length < 4) return;
        const opcode = msg.readUInt16BE(0);

        if (opcode === 5) {
            // 收到客户端发来的 ERROR 报文，终止传输
            const errCode = msg.readUInt16BE(2);
            let errMsg = '';
            try {
                errMsg = msg.toString('utf8', 4, msg.length - 1);
            } catch (_) {}
            this.handleSessionError(session, `客户端报错 (代码 ${errCode}): ${errMsg}`);
            return;
        }

        // 重置重传计数
        session.retransmitCount = 0;

        if (session.type === 'RRQ') {
            // 读请求：等待客户端 ACK
            if (opcode !== 4) {
                this.sendSocketError(session.socket, session.clientRinfo, 4, 'Illegal TFTP operation for RRQ session');
                return;
            }

            const blockAck = msg.readUInt16BE(2);

            // 如果是对当前块的 ACK (或选项协商时的 ACK 0)
            if (blockAck === session.blockNum) {
                this.clearTimeoutTimer(session);

                // 计算进度
                if (session.blockNum > 0) {
                    // 确认了上一块，已传输数增加
                    const lastSentSize = session.lastPacket.length - 4; // DATA 包含 4 字节头部
                    session.bytesTransferred += lastSentSize;
                }

                // 判断是否传输结束
                // 如果最后发出的数据块大小小于协商的 blksize，则说明传输已经完全结束
                if (session.lastPacket && (session.lastPacket.length - 4) < session.blksize && session.blockNum > 0) {
                    this.completeSession(session);
                    return;
                }

                // 发送下一个块
                session.blockNum = (session.blockNum + 1) & 0xFFFF; // 循环增加 (16位)
                this.sendNextDataBlock(session);

            } else {
                // 收到历史块的 ACK，可能是重传或延迟，静默忽略，依赖超时重传
            }

        } else {
            // 写请求：等待客户端发来 DATA
            if (opcode !== 3) {
                this.sendSocketError(session.socket, session.clientRinfo, 4, 'Illegal TFTP operation for WRQ session');
                return;
            }

            const blockNum = msg.readUInt16BE(2);
            const nextExpectedBlock = (session.blockNum + 1) & 0xFFFF;

            if (blockNum === nextExpectedBlock) {
                this.clearTimeoutTimer(session);

                const dataLength = msg.length - 4;
                // 写入数据
                try {
                    fs.writeSync(session.fd, msg, 4, dataLength, null);
                } catch (err) {
                    this.sendSocketError(session.socket, session.clientRinfo, 3, `Disk full or write error: ${err.message}`);
                    this.handleSessionError(session, `磁盘写入错误: ${err.message}`);
                    return;
                }

                session.bytesTransferred += dataLength;
                session.blockNum = blockNum;

                // 回复 ACK
                this.sendAck(session, blockNum, (err) => {
                    if (err) {
                        this.handleSessionError(session, `发送 ACK 失败: ${err.message}`);
                        return;
                    }
                    // 判断是否接收完毕
                    if (dataLength < session.blksize) {
                        this.completeSession(session);
                    } else {
                        this.startTimeoutTimer(session);
                    }
                });

                this.broadcastTransfers();

            } else if (blockNum === session.blockNum) {
                // 客户端没有收到我们的 ACK 重新发送了这一块，重发上一个 ACK
                this.clearTimeoutTimer(session);
                if (session.lastPacket) {
                    session.socket.send(session.lastPacket, session.clientRinfo.port, session.clientRinfo.address);
                }
                this.startTimeoutTimer(session);
            } else {
                // 其他异常块，忽略
            }
        }
    }

    /**
     * 发送下一个 DATA 数据块
     */
    sendNextDataBlock(session) {
        const buf = Buffer.alloc(session.blksize);
        let bytesRead = 0;
        try {
            bytesRead = fs.readSync(session.fd, buf, 0, session.blksize, null);
        } catch (err) {
            this.sendSocketError(session.socket, session.clientRinfo, 2, `File read error: ${err.message}`);
            this.handleSessionError(session, `文件读取错误: ${err.message}`);
            return;
        }

        const dataPacket = Buffer.alloc(4 + bytesRead);
        dataPacket.writeUInt16BE(3, 0); // Opcode 3 (DATA)
        dataPacket.writeUInt16BE(session.blockNum, 2); // Block Number
        buf.copy(dataPacket, 4, 0, bytesRead);

        session.lastPacket = dataPacket;

        session.socket.send(dataPacket, session.clientRinfo.port, session.clientRinfo.address, (err) => {
            if (err) {
                this.handleSessionError(session, `发送数据块失败: ${err.message}`);
                return;
            }
            this.broadcastTransfers();
            this.startTimeoutTimer(session);
        });
    }

    /**
     * 发送 ACK 响应包
     */
    sendAck(session, blockNum, callback) {
        const ackPacket = Buffer.alloc(4);
        ackPacket.writeUInt16BE(4, 0); // Opcode 4 (ACK)
        ackPacket.writeUInt16BE(blockNum, 2);

        session.lastPacket = ackPacket;
        session.socket.send(ackPacket, session.clientRinfo.port, session.clientRinfo.address, callback);
    }

    /**
     * 发送 OACK 选项协商响应
     */
    sendOack(session) {
        const buffers = [];
        buffers.push(Buffer.from([0, 6])); // Opcode 6 (OACK)

        for (const [name, val] of Object.entries(session.optionsNegotiated)) {
            buffers.push(Buffer.from(name + '\0', 'utf8'));
            buffers.push(Buffer.from(val + '\0', 'utf8'));
        }

        const oackPacket = Buffer.concat(buffers);
        session.lastPacket = oackPacket;

        session.socket.send(oackPacket, session.clientRinfo.port, session.clientRinfo.address, (err) => {
            if (err) {
                this.handleSessionError(session, `发送 OACK 失败: ${err.message}`);
                return;
            }
            this.startTimeoutTimer(session);
        });
    }

    /**
     * 开启超时重传计时器
     */
    startTimeoutTimer(session) {
        this.clearTimeoutTimer(session);
        session.timer = setTimeout(() => {
            this.handleSessionTimeout(session);
        }, session.timeout);
    }

    /**
     * 清除超时计时器
     */
    clearTimeoutTimer(session) {
        if (session.timer) {
            clearTimeout(session.timer);
            session.timer = null;
        }
    }

    /**
     * 超时重传处理
     */
    handleSessionTimeout(session) {
        session.retransmitCount++;
        if (session.retransmitCount > this.retries) {
            this.sendSocketError(session.socket, session.clientRinfo, 0, 'Transfer timed out');
            this.handleSessionError(session, `传输超时，重试达到最大次数 (${this.retries}次)`);
            return;
        }

        this.log(`[超时重传] 向 ${session.clientStr} 重新发送第 ${session.blockNum} 块/协商包 (${session.retransmitCount}/${this.retries})`, 'warning');
        if (session.lastPacket) {
            session.socket.send(session.lastPacket, session.clientRinfo.port, session.clientRinfo.address, (err) => {
                if (err) {
                    this.handleSessionError(session, `重传数据失败: ${err.message}`);
                    return;
                }
                this.startTimeoutTimer(session);
            });
        }
    }

    /**
     * 会话传输顺利完成
     */
    completeSession(session) {
        this.log(`[传输成功] ${session.type === 'RRQ' ? '下载' : '上传'} 完成: "${session.filename}" (共 ${session.bytesTransferred} 字节)`, 'success');
        
        session.status = 'completed';
        this.cleanupSession(session.id);
    }

    /**
     * 会话遭遇错误终止
     */
    handleSessionError(session, errorMsg) {
        this.log(`[传输中断] ${session.type === 'RRQ' ? '下载' : '上传'} "${session.filename}" 失败: ${errorMsg}`, 'error');
        
        session.status = 'error';
        session.errorMsg = errorMsg;

        // 如果是上传且发生错误，清理只写了一半的文件以保持磁盘干净
        if (session.type === 'WRQ' && session.realPath && fs.existsSync(session.realPath)) {
            try {
                // 关闭文件描述符再删
                if (session.fd !== null) {
                    fs.closeSync(session.fd);
                    session.fd = null;
                }
                fs.unlinkSync(session.realPath);
            } catch (_) {}
        }

        this.cleanupSession(session.id);
    }

    /**
     * 清理会话占用的资源 (fd, socket, timer)
     */
    cleanupSession(key, logReason = '') {
        const session = this.sessions.get(key);
        if (!session) return;

        this.clearTimeoutTimer(session);

        // 关闭文件描述符
        if (session.fd !== null) {
            try {
                fs.closeSync(session.fd);
            } catch (_) {}
            session.fd = null;
        }

        // 关闭临时套接字
        if (session.socket) {
            try {
                session.socket.close();
            } catch (_) {}
        }

        if (logReason) {
            this.log(`[会话清理] 清理 "${session.filename}" 会话: ${logReason}`, 'info');
        }

        // 如果不是异常结束的进度保留，则从列表中删除以防积压，但我们可以保留状态一小段时间以给 UI 反馈，也可以直接移除。
        // 为了 UI 可以展示“已完成”或“错误”状态，我们在 sessions 中保留该项目，但关闭 socket 和 fd，并设置在 5 秒后从 Map 中彻底删除。
        if (session.status === 'completed' || session.status === 'error') {
            this.broadcastTransfers();
            this.sessions.delete(key); // 可以直接删除，或者延迟删除。
            // 这里我们直接删除，前端在渲染列表时通过收到的同步更新维持列表，也可以设置延迟删除以供渲染
            setTimeout(() => {
                this.broadcastTransfers();
            }, 3000);
        } else {
            this.sessions.delete(key);
            this.broadcastTransfers();
        }
    }

    /**
     * 主端口直接发送错误报文
     */
    sendRawError(rinfo, code, message) {
        const sock = dgram.createSocket('udp4');
        this.sendSocketError(sock, rinfo, code, message, () => {
            sock.close();
        });
    }

    /**
     * 指定套接字发送错误报文
     */
    sendSocketError(socket, rinfo, code, message, callback) {
        const msgBuf = Buffer.from(message, 'utf8');
        const packet = Buffer.alloc(4 + msgBuf.length + 1);
        packet.writeUInt16BE(5, 0); // Opcode 5 (ERROR)
        packet.writeUInt16BE(code, 2); // Error code
        msgBuf.copy(packet, 4);
        packet[4 + msgBuf.length] = 0; // null-terminated

        socket.send(packet, rinfo.port, rinfo.address, callback);
    }
}

module.exports = TftpServerBackend;
