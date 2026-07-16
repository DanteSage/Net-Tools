/**
 * FTP 连接与文件管理模块 (原生 Socket 实现，零依赖)
 */
const fs = require('fs');
const net = require('net');
const { pipeline } = require('stream/promises');
const { ipcMain } = require('electron');

const DEFAULT_COMMAND_TIMEOUT = 15000;
const DEFAULT_DATA_IDLE_TIMEOUT = 30000;
const DEFAULT_TRANSFER_TIMEOUT = 10 * 60 * 1000;

function normalizeTimeout(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function destroyQuietly(resource) {
    if (!resource || typeof resource.destroy !== 'function' || resource.destroyed) return;
    try { resource.destroy(); } catch (_) {}
}

function collectReadable(stream, onChunk) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let settled = false;
        const cleanup = () => {
            stream.removeListener('data', handleData);
            stream.removeListener('end', handleEnd);
            stream.removeListener('error', handleError);
            stream.removeListener('close', handleClose);
        };
        const settle = (error, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve(value);
        };
        const handleData = (chunk) => {
            const buffer = Buffer.from(chunk);
            chunks.push(buffer);
            if (onChunk) onChunk(buffer);
        };
        const handleEnd = () => settle(null, Buffer.concat(chunks));
        const handleError = (error) => settle(error);
        const handleClose = () => {
            if (!stream.readableEnded) {
                settle(new Error('FTP 数据连接在接收完成前关闭'));
            }
        };

        stream.on('data', handleData);
        stream.once('end', handleEnd);
        stream.once('error', handleError);
        stream.once('close', handleClose);
    });
}

function endWritable(stream, data) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            stream.removeListener('finish', handleFinish);
            stream.removeListener('error', handleError);
            stream.removeListener('close', handleClose);
        };
        const settle = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve();
        };
        const handleFinish = () => settle();
        const handleError = (error) => settle(error);
        const handleClose = () => {
            if (!stream.writableFinished) {
                settle(new Error('FTP 数据连接在发送完成前关闭'));
            }
        };

        stream.once('finish', handleFinish);
        stream.once('error', handleError);
        stream.once('close', handleClose);
        try {
            stream.end(data);
        } catch (error) {
            settle(error);
        }
    });
}

class FtpClient {
    constructor(options = {}) {
        this.net = options.net || net;
        this.fs = options.fs || fs;
        this.commandTimeout = normalizeTimeout(options.commandTimeout, DEFAULT_COMMAND_TIMEOUT);
        this.dataIdleTimeout = normalizeTimeout(options.dataIdleTimeout, DEFAULT_DATA_IDLE_TIMEOUT);
        this.transferTimeout = normalizeTimeout(options.transferTimeout, DEFAULT_TRANSFER_TIMEOUT);
        this.socket = null;
        this.cmdQueue = [];
        this.buffer = '';
        this.onLog = null;
        this.onClose = null;
        this.operationTail = Promise.resolve();
    }

    async connect(config = {}) {
        if (this.socket) this.disconnect();
        this.buffer = '';
        this.commandTimeout = normalizeTimeout(config.commandTimeout || config.timeout, this.commandTimeout);

        let socket;
        try {
            socket = this.net.connect(config.port || 21, config.host);
            this.socket = socket;
            socket.setEncoding('utf8');
        } catch (error) {
            this.socket = null;
            throw error;
        }

        socket.on('data', (chunk) => {
            if (this.socket !== socket) return;
            this.buffer += chunk;
            this.parseResponses();
        });

        socket.on('error', (error) => {
            if (this.socket !== socket) return;
            console.error('FTP Control Socket Error:', error.message);
            this._failControl(error, socket, true);
        });

        socket.on('close', () => {
            if (this.socket !== socket) return;
            this._failControl(new Error('FTP 控制连接已关闭'), socket, false);
        });

        try {
            const greeting = await this._waitForResponse('FTP 服务器欢迎消息', this.commandTimeout, socket);
            if (greeting.code !== 220) {
                throw new Error(`服务器握手失败: ${greeting.code} ${greeting.text}`);
            }

            let response = await this.sendCmd(`USER ${config.username || 'anonymous'}`);
            if (response.code === 331) {
                response = await this.sendCmd(`PASS ${config.password || ''}`);
            }
            if (response.code !== 230) {
                throw new Error(response.text || 'FTP 登录失败');
            }

            response = await this.sendCmd('TYPE I');
            if (response.code >= 400) {
                throw new Error(response.text || 'FTP 二进制模式设置失败');
            }
        } catch (error) {
            this._failControl(error, socket, true);
            throw error;
        }
    }

    _notifyClose(error, socket) {
        if (typeof this.onClose !== 'function') return;
        try { this.onClose(error, socket); } catch (_) {}
    }

    _rejectPending(error) {
        const pending = this.cmdQueue.splice(0);
        for (const item of pending) {
            try { item.reject(error); } catch (_) {}
        }
    }

    _failControl(error, socket = this.socket, shouldDestroy = true) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (socket && this.socket && this.socket !== socket) return;

        const wasCurrent = !socket || this.socket === socket;
        if (wasCurrent) this.socket = null;
        this.buffer = '';
        this._rejectPending(normalizedError);
        if (wasCurrent) this._notifyClose(normalizedError, socket);
        if (shouldDestroy) destroyQuietly(socket);
    }

    _createResponseWaiter(label, timeout, socket = this.socket) {
        let timer = null;
        let timeoutDuration = normalizeTimeout(timeout, this.commandTimeout);
        let settled = false;
        let fulfill;
        let fail;
        const promise = new Promise((resolve, reject) => {
            fulfill = (response) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve(response);
            };
            fail = (error) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                reject(error);
            };
        });
        const item = { resolve: fulfill, reject: fail, fulfill };
        const scheduleTimeout = (nextTimeout = timeoutDuration) => {
            if (settled) return;
            timeoutDuration = normalizeTimeout(nextTimeout, timeoutDuration);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                this._failControl(new Error(`${label}响应超时`), socket, true);
            }, timeoutDuration);
        };
        scheduleTimeout();
        this.cmdQueue.push(item);
        return {
            item,
            promise,
            refreshTimeout: () => scheduleTimeout(),
            setTimeout: (nextTimeout) => scheduleTimeout(nextTimeout)
        };
    }

    _waitForResponse(label, timeout, socket = this.socket) {
        if (!socket || socket.destroyed) {
            return Promise.reject(new Error('FTP 控制连接不存在或已断开'));
        }
        return this._createResponseWaiter(label, timeout, socket).promise;
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
        const socket = this.socket;
        if (!socket || socket.destroyed || socket.writable === false) {
            return Promise.reject(new Error('FTP 控制连接不存在或已断开'));
        }
        const verb = String(cmd).split(/\s+/, 1)[0] || '命令';
        const { promise } = this._createResponseWaiter(`FTP ${verb}`, this.commandTimeout, socket);
        if (this.onLog) this.onLog({ direction: 'sent', text: cmd });
        try {
            socket.write(cmd + '\r\n');
        } catch (error) {
            this._failControl(error, socket, true);
        }
        return promise;
    }

    // 针对传输指令（包含 150 启动、226 传输结束两阶段）的专属执行器
    sendTransferCmd(cmd) {
        const socket = this.socket;
        if (!socket || socket.destroyed || socket.writable === false) {
            return Promise.reject(new Error('FTP 控制连接不存在或已断开'));
        }
        const verb = String(cmd).split(/\s+/, 1)[0] || '传输命令';
        const waiter = this._createResponseWaiter(
            `FTP ${verb}`,
            this.transferTimeout,
            socket
        );
        const { item, promise } = waiter;
        item.resolve = (response) => {
            if (response.code === 150 || response.code === 125) {
                // 同一 TCP 数据块可能连续携带 150/125 与 226，必须同步回队。
                this.cmdQueue.unshift(item);
                return;
            }
            item.fulfill(response);
        };
        if (this.onLog) this.onLog({ direction: 'sent', text: cmd });
        try {
            socket.write(cmd + '\r\n');
        } catch (error) {
            this._failControl(error, socket, true);
        }
        promise.refreshTimeout = waiter.refreshTimeout;
        promise.setResponseTimeout = waiter.setTimeout;
        return promise;
    }

    _runExclusive(operation) {
        const run = this.operationTail.then(() => operation());
        this.operationTail = run.catch(() => {});
        return run;
    }

    _runDataTransfer(pasv, command, operation) {
        return new Promise((resolve, reject) => {
            const controlSocket = this.socket;
            const resources = new Set();
            let dataSocket = null;
            let connected = false;
            let commandStarted = false;
            let finalResponseReceived = false;
            let settled = false;
            let transferTimer = null;
            let controlCompletion = null;

            const track = (resource) => {
                if (resource) resources.add(resource);
                return resource;
            };
            const cleanup = () => {
                if (transferTimer) clearTimeout(transferTimer);
                if (dataSocket && typeof dataSocket.setTimeout === 'function') {
                    try { dataSocket.setTimeout(0); } catch (_) {}
                }
                for (const resource of resources) destroyQuietly(resource);
            };
            const refreshTransferTimeout = () => {
                if (transferTimer) clearTimeout(transferTimer);
                transferTimer = setTimeout(() => {
                    fail(new Error(`FTP ${String(command).split(/\s+/, 1)[0]} 传输无进度超时`));
                }, this.transferTimeout);
                if (controlCompletion && typeof controlCompletion.refreshTimeout === 'function') {
                    controlCompletion.refreshTimeout();
                }
            };
            const fail = (error) => {
                if (settled) return;
                settled = true;
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                cleanup();
                const canPreserveControl = !commandStarted
                    || finalResponseReceived
                    || normalizedError.preserveControlConnection === true;
                if (!canPreserveControl) {
                    // 命令已发送但数据侧先失败时，关闭控制连接以避免迟到响应错配。
                    this._failControl(normalizedError, controlSocket, true);
                }
                reject(normalizedError);
            };
            const succeed = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            refreshTransferTimeout();

            try {
                dataSocket = track(this.net.connect(pasv.port, pasv.host));
                if (typeof dataSocket.setTimeout === 'function') {
                    dataSocket.setTimeout(this.dataIdleTimeout);
                }
                dataSocket.once('timeout', () => fail(new Error('FTP 数据连接空闲超时')));
                dataSocket.on('error', fail);
                dataSocket.on('data', refreshTransferTimeout);
                dataSocket.on('drain', refreshTransferTimeout);
                dataSocket.once('close', () => {
                    if (!connected) fail(new Error('FTP 数据连接在建立前关闭'));
                });
                dataSocket.once('connect', () => {
                    connected = true;
                    refreshTransferTimeout();
                    let dataCompletion;
                    let validatedControl;
                    try {
                        controlCompletion = this.sendTransferCmd(command);
                        validatedControl = controlCompletion.then((response) => {
                            finalResponseReceived = true;
                            if (response.code !== 226 && response.code !== 250) {
                                const error = new Error(
                                    `${String(command).split(/\s+/, 1)[0]} 执行失败: ${response.text}`
                                );
                                error.preserveControlConnection = true;
                                throw error;
                            }
                            return response;
                        });
                        commandStarted = true;
                        dataCompletion = Promise.resolve().then(() => operation(
                            dataSocket,
                            track,
                            refreshTransferTimeout
                        ));
                    } catch (error) {
                        fail(error);
                        return;
                    }

                    dataCompletion.then(
                        () => {
                            if (controlCompletion && typeof controlCompletion.setResponseTimeout === 'function') {
                                controlCompletion.setResponseTimeout(this.commandTimeout);
                            }
                        },
                        () => {}
                    );
                    Promise.all([validatedControl, dataCompletion])
                        .then(([, value]) => succeed(value))
                        .catch(fail);
                });
            } catch (error) {
                fail(error);
            }
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
        return this._runExclusive(() => this._list(remotePath));
    }

    async _list(remotePath) {
        const pasv = await this.passive();
        const listBuffer = await this._runDataTransfer(
            pasv,
            `LIST ${remotePath || ''}`,
            (dataSocket) => collectReadable(dataSocket)
        );
        return parseFtpList(listBuffer.toString('utf8'));
    }

    download(remotePath, localPath, onProgress) {
        return this._runExclusive(() => this._download(remotePath, localPath, onProgress));
    }

    async _download(remotePath, localPath, onProgress) {
        const totalSize = await this.size(remotePath);
        const pasv = await this.passive();
        await this._runDataTransfer(pasv, `RETR ${remotePath}`, (dataSocket, track) => {
            const fileStream = track(this.fs.createWriteStream(localPath));
            let transferred = 0;
            dataSocket.on('data', (chunk) => {
                transferred += chunk.length;
                if (onProgress) onProgress(transferred, totalSize);
            });
            return pipeline(dataSocket, fileStream);
        });
    }

    upload(localPath, remotePath, onProgress) {
        return this._runExclusive(() => this._upload(localPath, remotePath, onProgress));
    }

    async _upload(localPath, remotePath, onProgress) {
        const total = this.fs.statSync(localPath).size;
        const pasv = await this.passive();
        await this._runDataTransfer(pasv, `STOR ${remotePath}`, (dataSocket, track, touch) => {
            const fileStream = track(this.fs.createReadStream(localPath));
            let transferred = 0;
            fileStream.on('data', (chunk) => {
                transferred += chunk.length;
                touch();
                if (onProgress) onProgress(transferred, total);
            });
            return pipeline(fileStream, dataSocket);
        });
    }

    mkdir(path) {
        return this._runExclusive(() => this.sendCmd(`MKD ${path}`).then(res => {
            if (res.code === 257 || res.code === 250) return { success: true };
            throw new Error(res.text);
        }));
    }

    rmdir(path) {
        return this._runExclusive(() => this.sendCmd(`RMD ${path}`).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        }));
    }

    delete(path) {
        return this._runExclusive(() => this.sendCmd(`DELE ${path}`).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        }));
    }

    rename(oldPath, newPath) {
        return this._runExclusive(() => this.sendCmd(`RNFR ${oldPath}`).then(res => {
            if (res.code === 350) {
                return this.sendCmd(`RNTO ${newPath}`);
            }
            throw new Error(res.text);
        }).then(res => {
            if (res.code === 250) return { success: true };
            throw new Error(res.text);
        }));
    }

    readText(remotePath, encoding) {
        return this._runExclusive(() => this._readText(remotePath, encoding));
    }

    async _readText(remotePath, encoding) {
        const pasv = await this.passive();
        const content = await this._runDataTransfer(
            pasv,
            `RETR ${remotePath}`,
            (dataSocket) => collectReadable(dataSocket)
        );
        const iconv = require('iconv-lite');
        return iconv.decode(content, encoding || 'utf8');
    }

    writeText(remotePath, content, encoding) {
        return this._runExclusive(() => this._writeText(remotePath, content, encoding));
    }

    async _writeText(remotePath, content, encoding) {
        const pasv = await this.passive();
        const iconv = require('iconv-lite');
        const buffer = iconv.encode(content, encoding || 'utf8');
        await this._runDataTransfer(
            pasv,
            `STOR ${remotePath}`,
            (dataSocket, track, touch) => {
                touch();
                return endWritable(dataSocket, buffer).then(() => touch());
            }
        );
    }

    disconnect() {
        const socket = this.socket;
        if (socket) {
            this._failControl(new Error('FTP 连接已断开'), socket, true);
        } else {
            this._rejectPending(new Error('FTP 连接已断开'));
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
function registerFTPHandlers(context, dependencies = {}) {
    const { activeConnections, getMainWindow } = context;
    const ipc = dependencies.ipcMain || ipcMain;
    const createClient = dependencies.createClient || (() => new FtpClient(dependencies.clientOptions));

    // FTP 连接测试
    ipc.handle('ftp:test', async (event, config) => {
        const client = createClient();
        try {
            await client.connect(config);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        } finally {
            client.disconnect();
        }
    });

    // FTP 正式连接
    ipc.handle('ftp:connect', async (event, config) => {
        const client = createClient();
        const connectionId = `ftp_${config.host}_${Date.now()}`;
        
        client.onLog = (logData) => {
            try {
                if (event && event.sender && !event.sender.isDestroyed()) {
                    event.sender.send(`ftp:log:${connectionId}`, logData);
                }
            } catch (e) {}
        };
        client.onClose = (error) => {
            if (activeConnections.get(connectionId) === client) {
                activeConnections.delete(connectionId);
                const { removeConnectionEncoding } = require('./encoding-manager');
                removeConnectionEncoding(connectionId);
                try {
                    if (event && event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('ftp:disconnected', {
                            connectionId,
                            error: error && error.message ? error.message : 'FTP 控制连接已断开'
                        });
                    }
                } catch (_) {}
            }
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
    ipc.handle('ftp:list', async (event, { connectionId, path }) => {
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
    ipc.handle('ftp:mkdir', async (event, { connectionId, path }) => {
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
    ipc.handle('ftp:rmdir', async (event, { connectionId, path }) => {
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
    ipc.handle('ftp:delete', async (event, { connectionId, path }) => {
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
    ipc.handle('ftp:rename', async (event, { connectionId, oldPath, newPath }) => {
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
    ipc.handle('ftp:upload', async (event, { connectionId, localPath, remotePath }) => {
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
    ipc.handle('ftp:download', async (event, { connectionId, remotePath, localPath }) => {
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
    ipc.handle('ftp:readText', async (event, { connectionId, path, encoding }) => {
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
    ipc.handle('ftp:writeText', async (event, { connectionId, path, content, encoding }) => {
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
    ipc.handle('ftp:disconnect', async (event, connectionId) => {
        const client = activeConnections.get(connectionId);
        if (client) {
            client.onClose = null;
            client.disconnect();
            activeConnections.delete(connectionId);
            const { removeConnectionEncoding } = require('./encoding-manager');
            removeConnectionEncoding(connectionId);
        }
        return { success: true };
    });
}

module.exports = { FtpClient, registerFTPHandlers };
