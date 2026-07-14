/**
 * FTP 连接与文件管理模块 (原生 Socket 实现，零依赖)
 */
const fs = require('fs');
const net = require('net');
const { ipcMain } = require('electron');

class FtpClient {
    constructor() {
        this.socket = null;
        this.cmdQueue = [];
        this.buffer = '';
        this.onLog = null;
    }

    connect(config) {
        return new Promise((resolve, reject) => {
            this.socket = net.connect(config.port || 21, config.host);
            this.socket.setEncoding('utf8');

            let connected = false;

            const onConnectResponse = (code, text) => {
                if (code === 220) {
                    // 发送用户名
                    this.sendCmd(`USER ${config.username || 'anonymous'}`).then(res => {
                        if (res.code === 331) {
                            // 发送密码
                            return this.sendCmd(`PASS ${config.password || ''}`);
                        } else if (res.code === 230) {
                            return res;
                        } else {
                            throw new Error(res.text);
                        }
                    }).then(res => {
                        if (res.code === 230) {
                            // 登录成功，切换为二进制模式
                            return this.sendCmd('TYPE I');
                        } else {
                            throw new Error(res.text);
                        }
                    }).then(() => {
                        connected = true;
                        this.socket.removeListener('error', onEarlyError);
                        resolve();
                    }).catch(err => {
                        this.socket.destroy();
                        reject(err);
                    });
                } else {
                    this.socket.destroy();
                    reject(new Error(`服务器握手失败: ${code} ${text}`));
                }
            };

            const onEarlyError = (err) => {
                reject(err);
            };

            this.socket.once('error', onEarlyError);

            this.socket.on('data', (chunk) => {
                this.buffer += chunk;
                this.parseResponses();
            });

            this.socket.on('error', (err) => {
                console.error('FTP Control Socket Error:', err.message);
            });

            // 首个接收到的消息应当是 220
            this.cmdQueue.push({ resolve: (res) => onConnectResponse(res.code, res.text), reject });
        });
    }

    parseResponses() {
        while (true) {
            const idx = this.buffer.indexOf('\r\n');
            if (idx === -1) break;
            const line = this.buffer.substring(0, idx);
            this.buffer = this.buffer.substring(idx + 2);

            if (this.onLog) {
                this.onLog({ direction: 'recv', text: line });
            }

            const match = line.match(/^(\d{3})([ -])(.*)$/);
            if (match) {
                const code = parseInt(match[1]);
                const separator = match[2];
                const text = match[3];

                if (separator === ' ') {
                    const item = this.cmdQueue.shift();
                    if (item) {
                        item.resolve({ code, text });
                    }
                }
            }
        }
    }

    sendCmd(cmd) {
        return new Promise((resolve, reject) => {
            this.cmdQueue.push({ resolve, reject });
            if (this.onLog) {
                this.onLog({ direction: 'sent', text: cmd });
            }
            this.socket.write(cmd + '\r\n');
        });
    }

    // 针对传输指令（包含 150 启动、226 传输结束两阶段）的专属执行器
    sendTransferCmd(cmd) {
        return this.sendCmd(cmd).then(res => {
            if (res.code === 150 || res.code === 125) {
                return new Promise((resolve, reject) => {
                    this.cmdQueue.push({ resolve, reject });
                });
            }
            return res;
        });
    }

    passive() {
        return this.sendCmd('PASV').then(res => {
            if (res.code !== 227) {
                throw new Error(`进入被动模式失败: ${res.text}`);
            }
            const match = res.text.match(/\((\d+,\d+,\d+,\d+,\d+,\d+)\)/);
            if (!match) {
                throw new Error(`无法解析被动模式IP和端口: ${res.text}`);
            }
            const parts = match[1].split(',').map(x => parseInt(x));
            const host = parts.slice(0, 4).join('.');
            const port = (parts[4] << 8) + parts[5];
            return { host, port };
        });
    }

    size(remotePath) {
        return this.sendCmd(`SIZE ${remotePath}`).then(res => {
            if (res.code === 213) {
                return parseInt(res.text.trim());
            }
            return 0;
        }).catch(() => 0);
    }

    list(remotePath) {
        return this.passive().then(pasv => {
            return new Promise((resolve, reject) => {
                const dataSocket = net.connect(pasv.port, pasv.host);
                let listBuffer = Buffer.alloc(0);

                dataSocket.on('data', (chunk) => {
                    listBuffer = Buffer.concat([listBuffer, chunk]);
                });

                dataSocket.on('error', (err) => {
                    reject(err);
                });

                dataSocket.on('connect', () => {
                    this.sendTransferCmd(`LIST ${remotePath || ''}`).then(res => {
                        if (res.code !== 226 && res.code !== 250) {
                            return reject(new Error(`LIST 执行失败: ${res.text}`));
                        }
                        const rawText = listBuffer.toString('utf8');
                        const files = parseFtpList(rawText);
                        resolve(files);
                    }).catch(reject);
                });
            });
        });
    }

    download(remotePath, localPath, onProgress) {
        return this.size(remotePath).then(totalSize => {
            return this.passive().then(pasv => {
                return new Promise((resolve, reject) => {
                    const dataSocket = net.connect(pasv.port, pasv.host);
                    const fileStream = fs.createWriteStream(localPath);
                    
                    let transferred = 0;

                    dataSocket.on('data', (chunk) => {
                        transferred += chunk.length;
                        if (onProgress) {
                            onProgress(transferred, totalSize);
                        }
                    });

                    dataSocket.pipe(fileStream);

                    dataSocket.on('error', (err) => {
                        fileStream.destroy();
                        reject(err);
                    });

                    dataSocket.on('connect', () => {
                        this.sendTransferCmd(`RETR ${remotePath}`).then(res => {
                            if (res.code !== 226 && res.code !== 250) {
                                fileStream.destroy();
                                return reject(new Error(`RETR 执行失败: ${res.text}`));
                            }
                            resolve();
                        }).catch(err => {
                            fileStream.destroy();
                            reject(err);
                        });
                    });
                });
            });
        });
    }

    upload(localPath, remotePath, onProgress) {
        return this.passive().then(pasv => {
            return new Promise((resolve, reject) => {
                const stat = fs.statSync(localPath);
                const total = stat.size;
                const dataSocket = net.connect(pasv.port, pasv.host);
                const fileStream = fs.createReadStream(localPath);
                
                let transferred = 0;

                fileStream.on('data', (chunk) => {
                    transferred += chunk.length;
                    if (onProgress) {
                        onProgress(transferred, total);
                    }
                });

                fileStream.pipe(dataSocket);

                dataSocket.on('error', (err) => {
                    fileStream.destroy();
                    reject(err);
                });

                dataSocket.on('connect', () => {
                    this.sendTransferCmd(`STOR ${remotePath}`).then(res => {
                        if (res.code !== 226 && res.code !== 250) {
                            fileStream.destroy();
                            return reject(new Error(`STOR 执行失败: ${res.text}`));
                        }
                        resolve();
                    }).catch(err => {
                        fileStream.destroy();
                        reject(err);
                    });
                });
            });
        });
    }

    mkdir(path) {
        return this.sendCmd(`MKD ${path}`).then(res => {
            if (res.code === 257 || res.code === 250) return { success: true };
            throw new Error(res.text);
        });
    }

    rmdir(path) {
        return this.sendCmd(`RMD ${path}`).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        });
    }

    delete(path) {
        return this.sendCmd(`DELE ${path}`).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        });
    }

    rename(oldPath, newPath) {
        return this.sendCmd(`RNFR ${oldPath}`).then(res => {
            if (res.code === 350) {
                return this.sendCmd(`RNTO ${newPath}`);
            }
            throw new Error(res.text);
        }).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        });
    }

    readText(remotePath, encoding) {
        return this.passive().then(pasv => {
            return new Promise((resolve, reject) => {
                const dataSocket = net.connect(pasv.port, pasv.host);
                let listBuffer = Buffer.alloc(0);

                dataSocket.on('data', (chunk) => {
                    listBuffer = Buffer.concat([listBuffer, chunk]);
                });

                dataSocket.on('error', (err) => {
                    reject(err);
                });

                dataSocket.on('connect', () => {
                    this.sendTransferCmd(`RETR ${remotePath}`).then(res => {
                        if (res.code !== 226 && res.code !== 250) {
                            return reject(new Error(`RETR 失败: ${res.text}`));
                        }
                        const iconv = require('iconv-lite');
                        const text = iconv.decode(listBuffer, encoding || 'utf8');
                        resolve(text);
                    }).catch(err => {
                        reject(err);
                    });
                });
            });
        });
    }

    writeText(remotePath, content, encoding) {
        return this.passive().then(pasv => {
            return new Promise((resolve, reject) => {
                const dataSocket = net.connect(pasv.port, pasv.host);
                
                dataSocket.on('error', (err) => {
                    reject(err);
                });

                dataSocket.on('connect', () => {
                    this.sendTransferCmd(`STOR ${remotePath}`).then(res => {
                        if (res.code !== 226 && res.code !== 250) {
                            return reject(new Error(`STOR 失败: ${res.text}`));
                        }
                        resolve();
                    }).catch(err => {
                        reject(err);
                    });

                    // 写入文本内容并关闭数据连接，告诉服务器传输已结束
                    const iconv = require('iconv-lite');
                    const buf = iconv.encode(content, encoding || 'utf8');
                    dataSocket.write(buf, () => {
                        dataSocket.end();
                    });
                });
            });
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}

/**
 * UNIX and MSDOS directory listing parser
 */
function parseFtpList(rawText) {
    const lines = rawText.split(/\r?\n/).filter(line => line.trim());
    const files = [];
    
    for (const line of lines) {
        // Unix style: drwxr-xr-x   2 root     root         4096 Jun  1 14:00 name
        const unixMatch = line.match(/^([d-])[rwx-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}|[A-Za-z]{3}\s+\d+\s+\d{4})\s+(.+)$/);
        if (unixMatch) {
            const isDirectory = unixMatch[1] === 'd';
            const size = parseInt(unixMatch[2]);
            const name = unixMatch[4].trim();
            if (name !== '.' && name !== '..') {
                files.push({
                    name,
                    isDirectory,
                    size,
                    mtime: Date.now()
                });
            }
            continue;
        }
        
        // MSDOS style: 06-01-26  02:00PM       <DIR>          foldername
        const dosMatch = line.match(/^(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}[AP]M)\s+(<DIR>|\d+)\s+(.+)$/i);
        if (dosMatch) {
            const isDirectory = dosMatch[3] === '<DIR>';
            const size = isDirectory ? 0 : parseInt(dosMatch[3]);
            const name = dosMatch[4].trim();
            if (name !== '.' && name !== '..') {
                files.push({
                    name,
                    isDirectory,
                    size,
                    mtime: Date.now()
                });
            }
            continue;
        }
        
        // Fallback split
        const parts = line.split(/\s+/);
        if (parts.length > 0) {
            const name = parts[parts.length - 1];
            if (name !== '.' && name !== '..') {
                files.push({
                    name,
                    isDirectory: line.toLowerCase().includes('<dir>') || line.startsWith('d'),
                    size: 0,
                    mtime: Date.now()
                });
            }
        }
    }
    return files;
}

/**
 * 注册所有 FTP IPC 处理程序
 */
function registerFTPHandlers(context) {
    const { activeConnections, getMainWindow } = context;

    // FTP 连接测试
    ipcMain.handle('ftp:test', async (event, config) => {
        const client = new FtpClient();
        try {
            await client.connect(config);
            client.disconnect();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 正式连接
    ipcMain.handle('ftp:connect', async (event, config) => {
        const client = new FtpClient();
        const connectionId = `ftp_${config.host}_${Date.now()}`;
        
        client.onLog = (logData) => {
            try {
                if (event && event.sender && !event.sender.isDestroyed()) {
                    event.sender.send(`ftp:log:${connectionId}`, logData);
                }
            } catch (e) {}
        };

        try {
            await client.connect(config);
            activeConnections.set(connectionId, client);
            return { success: true, connectionId };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 读取目录
    ipcMain.handle('ftp:list', async (event, { connectionId, path }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            const files = await client.list(path);
            return { success: true, files, currentPath: path || '/' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 新建文件夹
    ipcMain.handle('ftp:mkdir', async (event, { connectionId, path }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            await client.mkdir(path);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 删除文件夹
    ipcMain.handle('ftp:rmdir', async (event, { connectionId, path }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            await client.rmdir(path);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 删除文件
    ipcMain.handle('ftp:delete', async (event, { connectionId, path }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            await client.delete(path);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 重命名
    ipcMain.handle('ftp:rename', async (event, { connectionId, oldPath, newPath }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            await client.rename(oldPath, newPath);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 上传文件
    ipcMain.handle('ftp:upload', async (event, { connectionId, localPath, remotePath }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        const sender = event.sender;
        try {
            await client.upload(localPath, remotePath, (transferred, total) => {
                if (sender && !sender.isDestroyed()) {
                    sender.send('ftp:progress', {
                        connectionId,
                        direction: 'upload',
                        localPath,
                        remotePath,
                        transferred,
                        total
                    });
                }
            });
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 下载文件
    ipcMain.handle('ftp:download', async (event, { connectionId, remotePath, localPath }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        const sender = event.sender;
        try {
            await client.download(remotePath, localPath, (transferred, total) => {
                if (sender && !sender.isDestroyed()) {
                    sender.send('ftp:progress', {
                        connectionId,
                        direction: 'download',
                        localPath,
                        remotePath,
                        transferred,
                        total
                    });
                }
            });
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 读取文本内容
    ipcMain.handle('ftp:readText', async (event, { connectionId, path, encoding }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            const content = await client.readText(path, encoding);
            return { success: true, content };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 写入文本内容
    ipcMain.handle('ftp:writeText', async (event, { connectionId, path, content, encoding }) => {
        const client = activeConnections.get(connectionId);
        if (!client) return { success: false, error: 'FTP 连接不存在' };
        try {
            await client.writeText(path, content, encoding);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // FTP 断开连接
    ipcMain.handle('ftp:disconnect', async (event, connectionId) => {
        const client = activeConnections.get(connectionId);
        if (client) {
            client.disconnect();
            activeConnections.delete(connectionId);
            const { removeConnectionEncoding } = require('./encoding-manager');
            removeConnectionEncoding(connectionId);
        }
        return { success: true };
    });
}

module.exports = { registerFTPHandlers };
