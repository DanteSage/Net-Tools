/**
 * SSH 连接处理模块
 */
const { ipcMain } = require('electron');
const { createSSHConfig } = require('./algorithms');
const { decodeChunk, encodeString, removeConnectionEncoding } = require('./encoding-manager');
const { createTerminalDataBuffer } = require('./terminal-data-buffer');
const { writeStreamWithBackpressure } = require('./stream-write-queue');

// SSH2 客户端
let ssh2;
try {
    ssh2 = require('ssh2');
} catch (e) {
    console.log('SSH2 module not installed yet');
}

/**
 * 注册 SSH 相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 * @param {Map} context.activeConnections - 活跃连接存储
 * @param {Function} context.getMainWindow - 获取主窗口函数
 * @param {Function} context.isQuitting - 检查是否正在退出
 */
function registerSSHHandlers(context, dependencies = {}) {
    const { activeConnections, getMainWindow, isQuitting } = context;
    const ipc = dependencies.ipcMain || ipcMain;
    const sshModule = dependencies.ssh2 || ssh2;
    const connectionLifecycles = new WeakMap();

    function getConnectionLifecycle(conn) {
        let lifecycle = connectionLifecycles.get(conn);
        if (!lifecycle) {
            lifecycle = {
                closeHandled: false,
                shellCleanup: null
            };
            connectionLifecycles.set(conn, lifecycle);
        }
        return lifecycle;
    }

    function notifySSHClose(connectionId, lifecycle, details = {}) {
        if (lifecycle.closeHandled) return;
        lifecycle.closeHandled = true;
        if (isQuitting()) return;

        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        try {
            mainWindow.webContents.send('ssh:close', {
                connectionId,
                ...details
            });
        } catch (e) {}
    }

    function cleanupSSHConnection(connectionId, conn, options = {}) {
        if (activeConnections.get(connectionId) !== conn) return false;

        const {
            error = null,
            notify = true,
            closeClient = false,
            closeDetails = {}
        } = options;
        const lifecycle = getConnectionLifecycle(conn);

        // Remove the owner first so synchronous end/close events cannot re-enter cleanup.
        activeConnections.delete(connectionId);
        if (!notify) lifecycle.closeHandled = true;

        if (typeof lifecycle.shellCleanup === 'function') {
            lifecycle.shellCleanup(error, { notify: false, closeConnection: false });
        } else {
            activeConnections.delete(`${connectionId}_shell`);
        }
        activeConnections.delete(`${connectionId}_sftp`);
        removeConnectionEncoding(connectionId);

        if (notify) {
            notifySSHClose(connectionId, lifecycle, {
                ...closeDetails,
                ...(error ? { error: error.message } : {})
            });
        }

        if (closeClient && typeof conn.end === 'function') {
            try { conn.end(); } catch (e) {}
        }
        return true;
    }

    async function writeToShell(connectionId, data) {
        const stream = activeConnections.get(`${connectionId}_shell`);
        if (!stream || stream.destroyed || stream.writable === false) {
            return { success: false, error: 'Shell不存在' };
        }

        try {
            const encodedData = encodeString(connectionId, data);
            await writeStreamWithBackpressure(stream, encodedData, { chunkSize: 16 * 1024 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    function resizeShell(connectionId, cols, rows) {
        const stream = activeConnections.get(`${connectionId}_shell`);
        if (!stream || typeof stream.setWindow !== 'function') return false;

        const safeCols = Math.max(2, Math.min(1000, Math.floor(Number(cols) || 80)));
        const safeRows = Math.max(1, Math.min(1000, Math.floor(Number(rows) || 24)));
        try {
            stream.setWindow(safeRows, safeCols, 0, 0);
            return true;
        } catch (error) {
            return false;
        }
    }

    // SSH连接测试
    ipc.handle('ssh:test', async (event, config) => {
        if (!sshModule) {
            return { success: false, error: 'SSH2 模块未安装' };
        }

        return new Promise((resolve) => {
            const conn = new sshModule.Client();
            const timeout = setTimeout(() => {
                conn.end();
                resolve({ success: false, error: '连接超时' });
            }, 5000);

            conn.on('ready', () => {
                clearTimeout(timeout);
                conn.end();
                resolve({ success: true, message: '连接成功' });
            });

            conn.on('error', (err) => {
                clearTimeout(timeout);
                resolve({ success: false, error: err.message });
            });

            const testConfig = createSSHConfig({ ...config, timeout: 5000 });
            conn.connect(testConfig);
        });
    });

    // SSH连接
    ipc.handle('ssh:connect', async (event, config) => {
        if (!sshModule) {
            return { success: false, error: 'SSH2 模块未安装，请运行 npm install' };
        }

        return new Promise((resolve) => {
            const conn = new sshModule.Client();
            const connectionId = `${config.host}_${Date.now()}`;
            let ready = false;
            let settled = false;
            let lastError = null;

            const settle = (result) => {
                if (settled) return false;
                settled = true;
                resolve(result);
                return true;
            };

            conn.once('ready', () => {
                if (settled) {
                    try { conn.end(); } catch (e) {}
                    return;
                }
                ready = true;
                conn.setNoDelay(true);
                getConnectionLifecycle(conn);
                activeConnections.set(connectionId, conn);
                settle({ success: true, connectionId });
            });

            conn.on('error', (err) => {
                lastError = err;
                if (!ready) {
                    settle({ success: false, error: err.message });
                    return;
                }
                cleanupSSHConnection(connectionId, conn, {
                    error: err,
                    closeClient: true
                });
            });

            conn.once('end', () => {
                if (!ready) {
                    settle({
                        success: false,
                        error: lastError ? lastError.message : '连接在建立完成前已关闭'
                    });
                    return;
                }
                cleanupSSHConnection(connectionId, conn, { error: lastError });
            });

            conn.once('close', () => {
                if (!ready) {
                    settle({
                        success: false,
                        error: lastError ? lastError.message : '连接在建立完成前已关闭'
                    });
                    return;
                }
                cleanupSSHConnection(connectionId, conn, { error: lastError });
            });

            const connectConfig = createSSHConfig(config);
            conn.connect(connectConfig);
        });
    });

    // SSH执行命令
    ipc.handle('ssh:execute', async (event, { connectionId, command }) => {
        const conn = activeConnections.get(connectionId);
        if (!conn) {
            return { success: false, error: '连接不存在或已断开' };
        }

        return new Promise((resolve) => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    resolve({ success: false, error: err.message });
                    return;
                }

                let stdout = '';
                let stderr = '';

                let settled = false;
                const settle = (result) => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                };
                const handleStreamError = (error) => {
                    settle({ success: false, error: error.message });
                    if (!stream.destroyed && typeof stream.destroy === 'function') {
                        try { stream.destroy(); } catch (_) {}
                    }
                };

                stream.once('error', handleStreamError);
                stream.on('close', (code) => {
                    settle({
                        success: true,
                        stdout,
                        stderr,
                        exitCode: code
                    });
                });

                stream.on('data', (data) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                stream.stderr.once('error', handleStreamError);
            });
        });
    });

    // SSH创建交互式Shell
    ipc.handle('ssh:shell', async (event, { connectionId, cols, rows }) => {
        const conn = activeConnections.get(connectionId);
        if (!conn) {
            return { success: false, error: '连接不存在或已断开' };
        }

        return new Promise((resolve) => {
            const windowOptions = {
                term: 'xterm-256color',
                cols: Math.max(2, Math.min(1000, Math.floor(Number(cols) || 120))),
                rows: Math.max(1, Math.min(1000, Math.floor(Number(rows) || 40)))
            };
            const shellOptions = {
                env: {
                    LANG: 'en_US.UTF-8',
                    LC_ALL: 'en_US.UTF-8',
                    TERM: 'xterm-256color'
                }
            };

            conn.shell(windowOptions, shellOptions, (err, stream) => {
                if (err) {
                    resolve({ success: false, error: err.message });
                    return;
                }
                if (activeConnections.get(connectionId) !== conn) {
                    if (stream && typeof stream.destroy === 'function') {
                        try { stream.destroy(); } catch (e) {}
                    } else if (stream && typeof stream.end === 'function') {
                        try { stream.end(); } catch (e) {}
                    }
                    resolve({ success: false, error: '连接不存在或已断开' });
                    return;
                }

                const shellId = `shell_${Date.now()}`;
                const outputBuffer = createTerminalDataBuffer((data) => {
                    if (isQuitting()) return;
                    const mainWindow = getMainWindow();
                    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
                    mainWindow.webContents.send('ssh:data', {
                        connectionId,
                        shellId,
                        data
                    });
                });

                let cleanedUp = false;
                const lifecycle = getConnectionLifecycle(conn);
                const cleanupShell = (error = null, cleanupOptions = {}) => {
                    if (cleanedUp) return;
                    cleanedUp = true;
                    const {
                        notify = true,
                        closeConnection = true
                    } = cleanupOptions;
                    if (error && !stream.destroyed && typeof stream.destroy === 'function') {
                        try { stream.destroy(); } catch (_) {}
                    }
                    outputBuffer.dispose(true);
                    if (activeConnections.get(`${connectionId}_shell`) === stream) {
                        activeConnections.delete(`${connectionId}_shell`);
                    }
                    if (lifecycle.shellCleanup === cleanupShell) {
                        lifecycle.shellCleanup = null;
                    }

                    if (closeConnection) {
                        cleanupSSHConnection(connectionId, conn, {
                            error,
                            notify,
                            closeClient: true,
                            closeDetails: { shellId }
                        });
                    } else if (notify) {
                        notifySSHClose(connectionId, lifecycle, {
                            shellId,
                            ...(error ? { error: error.message } : {})
                        });
                    }
                };

                stream.on('data', (chunk) => {
                    try {
                        const decodedText = decodeChunk(connectionId, chunk);
                        if (decodedText.length > 0) {
                            outputBuffer.push(decodedText);
                        }
                    } catch (e) { }
                });

                stream.once('error', (error) => cleanupShell(error));
                stream.on('close', () => cleanupShell());

                lifecycle.shellCleanup = cleanupShell;
                activeConnections.set(`${connectionId}_shell`, stream);
                resolve({ success: true, shellId });
            });
        });
    });

    // SSH写入数据到Shell
    ipc.handle('ssh:write', async (event, { connectionId, data }) => {
        return writeToShell(connectionId, data);
    });

    // Interactive input does not need a Promise round trip for every keypress.
    ipc.on('ssh:input', (event, { connectionId, data }) => {
        writeToShell(connectionId, data);
    });

    ipc.on('ssh:resize', (event, { connectionId, cols, rows }) => {
        resizeShell(connectionId, cols, rows);
    });

    // SSH断开连接
    ipc.handle('ssh:disconnect', async (event, { connectionId }) => {
        const conn = activeConnections.get(connectionId);
        if (conn) {
            cleanupSSHConnection(connectionId, conn, {
                notify: false,
                closeClient: true
            });
        }
        return { success: true };
    });

    // ==================== SFTP 可视化文件管理 ====================
    
    // 获取或缓存 SFTP 实例
    function getSftp(connectionId) {
        return new Promise((resolve, reject) => {
            const conn = activeConnections.get(connectionId);
            if (!conn) {
                return reject(new Error('SSH连接不存在或已断开'));
            }
            const cachedSftp = activeConnections.get(`${connectionId}_sftp`);
            if (cachedSftp) {
                return resolve(cachedSftp);
            }
            conn.sftp((err, sftp) => {
                if (err) {
                    return reject(err);
                }
                if (activeConnections.get(connectionId) !== conn) {
                    if (sftp && typeof sftp.end === 'function') {
                        try { sftp.end(); } catch (e) {}
                    }
                    return reject(new Error('SSH连接不存在或已断开'));
                }
                activeConnections.set(`${connectionId}_sftp`, sftp);
                resolve(sftp);
            });
        });
    }

    // SFTP 读取目录列表
    ipc.handle('sftp:list', async (event, { connectionId, path }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                const targetPath = path || '.';
                sftp.realpath(targetPath, (err, resolvedPath) => {
                    if (err) {
                        return resolve({ success: false, error: err.message });
                    }
                    sftp.readdir(resolvedPath, (err, list) => {
                        if (err) {
                            return resolve({ success: false, error: err.message });
                        }
                        const files = list.map(item => ({
                            name: item.filename,
                            isDirectory: (item.attrs.mode & 0o170000) === 0o040000,
                            size: item.attrs.size,
                            mtime: item.attrs.mtime * 1000,
                            permissions: item.attrs.mode
                        }));
                        resolve({ success: true, files, currentPath: resolvedPath });
                    });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 创建文件夹
    ipc.handle('sftp:mkdir', async (event, { connectionId, path }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.mkdir(path, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 删除文件夹
    ipc.handle('sftp:rmdir', async (event, { connectionId, path }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.rmdir(path, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 删除文件
    ipc.handle('sftp:delete', async (event, { connectionId, path }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.unlink(path, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 重命名或移动
    ipc.handle('sftp:rename', async (event, { connectionId, oldPath, newPath }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.rename(oldPath, newPath, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 上传文件
    ipc.handle('sftp:upload', async (event, { connectionId, localPath, remotePath }) => {
        try {
            const sftp = await getSftp(connectionId);
            const mainWindow = getMainWindow();
            return new Promise((resolve) => {
                sftp.fastPut(localPath, remotePath, {
                    step: (transferred, chunk, total) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('sftp:progress', {
                                connectionId,
                                direction: 'upload',
                                localPath,
                                remotePath,
                                transferred,
                                total
                            });
                        }
                    }
                }, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 下载文件
    ipc.handle('sftp:download', async (event, { connectionId, remotePath, localPath }) => {
        try {
            const sftp = await getSftp(connectionId);
            const mainWindow = getMainWindow();
            return new Promise((resolve) => {
                sftp.fastGet(remotePath, localPath, {
                    step: (transferred, chunk, total) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('sftp:progress', {
                                connectionId,
                                direction: 'download',
                                localPath,
                                remotePath,
                                transferred,
                                total
                            });
                        }
                    }
                }, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 读取文本内容
    ipc.handle('sftp:readText', async (event, { connectionId, path, encoding }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                sftp.readFile(path, (err, data) => {
                    if (err) return resolve({ success: false, error: err.message });
                    const iconv = require('iconv-lite');
                    const text = iconv.decode(data, encoding || 'utf8');
                    resolve({ success: true, content: text });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // SFTP 写入文本内容
    ipc.handle('sftp:writeText', async (event, { connectionId, path, content, encoding }) => {
        try {
            const sftp = await getSftp(connectionId);
            return new Promise((resolve) => {
                const iconv = require('iconv-lite');
                const data = iconv.encode(content, encoding || 'utf8');
                sftp.writeFile(path, data, (err) => {
                    if (err) return resolve({ success: false, error: err.message });
                    resolve({ success: true });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = {
    registerSSHHandlers,
    ssh2: () => ssh2
};
