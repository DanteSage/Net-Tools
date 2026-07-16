const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 暴露安全的API到渲染进程
contextBridge.exposeInMainWorld('api', {
    // ==================== 设备管理 ====================
    devices: {
        getAll: () => ipcRenderer.invoke('devices:getAll'),
        save: (devices) => ipcRenderer.invoke('devices:save', devices)
    },

    // ==================== 设备分组 ====================
    groups: {
        getAll: () => ipcRenderer.invoke('groups:getAll'),
        save: (groups) => ipcRenderer.invoke('groups:save', groups)
    },

    // ==================== SSH连接 ====================
    ssh: {
        test: (config) => ipcRenderer.invoke('ssh:test', config),
        connect: (config) => ipcRenderer.invoke('ssh:connect', config),
        execute: (connectionId, command) => ipcRenderer.invoke('ssh:execute', { connectionId, command }),
        shell: (connectionId, cols, rows) => ipcRenderer.invoke('ssh:shell', { connectionId, cols, rows }),
        write: (connectionId, data) => ipcRenderer.invoke('ssh:write', { connectionId, data }),
        input: (connectionId, data) => ipcRenderer.send('ssh:input', { connectionId, data }),
        resize: (connectionId, cols, rows) => ipcRenderer.send('ssh:resize', { connectionId, cols, rows }),
        disconnect: (connectionId) => ipcRenderer.invoke('ssh:disconnect', { connectionId }),

        // 监听SSH数据
        onData: (callback) => {
            ipcRenderer.on('ssh:data', (event, data) => callback(data));
        },
        onClose: (callback) => {
            ipcRenderer.on('ssh:close', (event, data) => callback(data));
        },
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('ssh:data');
            ipcRenderer.removeAllListeners('ssh:close');
        }
    },

    // ==================== SFTP 可视化文件管理 ====================
    sftp: {
        list: (connectionId, path) => ipcRenderer.invoke('sftp:list', { connectionId, path }),
        mkdir: (connectionId, path) => ipcRenderer.invoke('sftp:mkdir', { connectionId, path }),
        rmdir: (connectionId, path) => ipcRenderer.invoke('sftp:rmdir', { connectionId, path }),
        delete: (connectionId, path) => ipcRenderer.invoke('sftp:delete', { connectionId, path }),
        rename: (connectionId, oldPath, newPath) => ipcRenderer.invoke('sftp:rename', { connectionId, oldPath, newPath }),
        download: (connectionId, remotePath, localPath) => ipcRenderer.invoke('sftp:download', { connectionId, remotePath, localPath }),
        upload: (connectionId, localPath, remotePath) => ipcRenderer.invoke('sftp:upload', { connectionId, localPath, remotePath }),
        readText: (connectionId, path, encoding) => ipcRenderer.invoke('sftp:readText', { connectionId, path, encoding }),
        writeText: (connectionId, path, content, encoding) => ipcRenderer.invoke('sftp:writeText', { connectionId, path, content, encoding }),
        onProgress: (callback) => {
            ipcRenderer.on('sftp:progress', (event, data) => callback(data));
        },
        removeProgressListener: () => {
            ipcRenderer.removeAllListeners('sftp:progress');
        }
    },

    // ==================== FTP 可视化文件管理 ====================
    ftp: {
        open: () => ipcRenderer.invoke('ftpClient:open'),
        test: (config) => ipcRenderer.invoke('ftp:test', config),
        connect: (config) => ipcRenderer.invoke('ftp:connect', config),
        list: (connectionId, path) => ipcRenderer.invoke('ftp:list', { connectionId, path }),
        mkdir: (connectionId, path) => ipcRenderer.invoke('ftp:mkdir', { connectionId, path }),
        rmdir: (connectionId, path) => ipcRenderer.invoke('ftp:rmdir', { connectionId, path }),
        delete: (connectionId, path) => ipcRenderer.invoke('ftp:delete', { connectionId, path }),
        rename: (connectionId, oldPath, newPath) => ipcRenderer.invoke('ftp:rename', { connectionId, oldPath, newPath }),
        download: (connectionId, remotePath, localPath) => ipcRenderer.invoke('ftp:download', { connectionId, remotePath, localPath }),
        upload: (connectionId, localPath, remotePath) => ipcRenderer.invoke('ftp:upload', { connectionId, localPath, remotePath }),
        disconnect: (connectionId) => ipcRenderer.invoke('ftp:disconnect', connectionId),
        readText: (connectionId, path, encoding) => ipcRenderer.invoke('ftp:readText', { connectionId, path, encoding }),
        writeText: (connectionId, path, content, encoding) => ipcRenderer.invoke('ftp:writeText', { connectionId, path, content, encoding }),
        onProgress: (callback) => {
            ipcRenderer.on('ftp:progress', (event, data) => callback(data));
        },
        removeProgressListener: () => {
            ipcRenderer.removeAllListeners('ftp:progress');
        }
    },

    // ==================== FTP 服务端 ====================
    ftpServer: {
        open: () => ipcRenderer.invoke('ftpServer:open')
    },

    // ==================== DHCP 服务端 ====================
    dhcpServer: {
        open: () => ipcRenderer.invoke('dhcpServer:open'),
        start: (config) => ipcRenderer.invoke('dhcpServer:start', config),
        stop: () => ipcRenderer.invoke('dhcpServer:stop'),
        onLog: (callback) => {
            ipcRenderer.on('dhcpServer:log', (event, logObj) => callback(logObj));
        },
        onLeases: (callback) => {
            ipcRenderer.on('dhcpServer:leases', (event, leases) => callback(leases));
        },
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('dhcpServer:log');
            ipcRenderer.removeAllListeners('dhcpServer:leases');
        }
    },

    // ==================== TFTP 服务端 ====================
    tftpServer: {
        open: () => ipcRenderer.invoke('tftpServer:open'),
        start: (config) => ipcRenderer.invoke('tftpServer:start', config),
        stop: () => ipcRenderer.invoke('tftpServer:stop'),
        selectDirectory: () => ipcRenderer.invoke('tftpServer:selectDirectory'),
        listFiles: (dirPath) => ipcRenderer.invoke('tftpServer:listFiles', dirPath),
        onLog: (callback) => {
            ipcRenderer.on('tftpServer:log', (event, logObj) => callback(logObj));
        },
        onTransfers: (callback) => {
            ipcRenderer.on('tftpServer:transfers', (event, transfers) => callback(transfers));
        },
        onCloseRequest: (callback) => {
            ipcRenderer.on('tftpServer:request-close', () => callback());
        },
        confirmClose: () => ipcRenderer.send('tftpServer:confirm-close'),
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('tftpServer:log');
            ipcRenderer.removeAllListeners('tftpServer:transfers');
            ipcRenderer.removeAllListeners('tftpServer:request-close');
        }
    },

    // ==================== Telnet 连接 ====================
    telnet: {
        connect: (config) => ipcRenderer.invoke('telnet:connect', config),
        write: (connectionId, data) => ipcRenderer.invoke('telnet:write', { connectionId, data }),
        input: (connectionId, data) => ipcRenderer.send('telnet:input', { connectionId, data }),
        resize: (connectionId, cols, rows) => ipcRenderer.send('telnet:resize', { connectionId, cols, rows }),
        disconnect: (connectionId) => ipcRenderer.invoke('telnet:disconnect', connectionId),
        test: (config) => ipcRenderer.invoke('telnet:test', config),

        onData: (callback) => {
            ipcRenderer.on('telnet:data', (event, data) => callback(data));
        },
        onError: (callback) => {
            ipcRenderer.on('telnet:error', (event, data) => callback(data));
        },
        onClose: (callback) => {
            ipcRenderer.on('telnet:close', (event, data) => callback(data));
        },
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('telnet:data');
            ipcRenderer.removeAllListeners('telnet:error');
            ipcRenderer.removeAllListeners('telnet:close');
        }
    },

    // ==================== 串口连接 ====================
    serial: {
        list: () => ipcRenderer.invoke('serial:list'),
        connect: (config) => ipcRenderer.invoke('serial:connect', config),
        write: (connectionId, data) => ipcRenderer.invoke('serial:write', { connectionId, data }),
        input: (connectionId, data) => ipcRenderer.send('serial:input', { connectionId, data }),
        disconnect: (connectionId) => ipcRenderer.invoke('serial:disconnect', { connectionId }),

        // 监听串口数据
        onData: (callback) => {
            ipcRenderer.on('serial:data', (event, data) => callback(data));
        },
        onError: (callback) => {
            ipcRenderer.on('serial:error', (event, data) => callback(data));
        },
        onClose: (callback) => {
            ipcRenderer.on('serial:close', (event, data) => callback(data));
        },
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('serial:data');
            ipcRenderer.removeAllListeners('serial:error');
            ipcRenderer.removeAllListeners('serial:close');
        }
    },

    // ==================== 批量执行 ====================
    batch: {
        execute: (params) => ipcRenderer.invoke('batch:execute', params),
        pause: (pause) => ipcRenderer.invoke('batch:pause', pause),
        stop: () => ipcRenderer.invoke('batch:stop'),

        onProgress: (callback) => {
            ipcRenderer.on('batch:progress', (event, data) => callback(data));
        },
        onDebug: (callback) => {
            ipcRenderer.on('batch:debug', (event, msg) => callback(msg));
        },
        removeProgressListener: () => {
            ipcRenderer.removeAllListeners('batch:progress');
            ipcRenderer.removeAllListeners('batch:debug');
        }
    },

    // ==================== 运行日志 ====================
    logs: {
        load: () => ipcRenderer.invoke('logs:load'),
        save: (logs) => ipcRenderer.invoke('logs:save', logs),
        clear: () => ipcRenderer.invoke('logs:clear'),
        export: (content) => ipcRenderer.invoke('logs:export', content)
    },

    // ==================== 命令模板 ====================
    templates: {
        getAll: () => ipcRenderer.invoke('templates:getAll'),
        save: (templates) => ipcRenderer.invoke('templates:save', templates)
    },

    // ==================== 定义变量 ====================
    variables: {
        getAll: () => ipcRenderer.invoke('variables:getAll'),
        save: (variables) => ipcRenderer.invoke('variables:save', variables)
    },

    // ==================== 备份管理 ====================
    backup: {
        create: (device, commands) => ipcRenderer.invoke('backup:create', { device, commands }),
        getAll: () => ipcRenderer.invoke('backup:getAll'),
        download: (fileName) => ipcRenderer.invoke('backup:download', fileName),
        delete: (fileName) => ipcRenderer.invoke('backup:delete', fileName),
        read: (fileName) => ipcRenderer.invoke('backup:read', fileName),
        getDir: () => ipcRenderer.invoke('backup:getDir'),
        setDir: (dir) => ipcRenderer.invoke('backup:setDir', dir),
        selectDir: () => ipcRenderer.invoke('backup:selectDir')
    },

    // ==================== 操作记录 ====================
    oplog: {
        save: (oplog) => ipcRenderer.invoke('oplog:save', oplog),
        getAll: () => ipcRenderer.invoke('oplog:getAll'),
        get: (id) => ipcRenderer.invoke('oplog:get', id),
        delete: (id) => ipcRenderer.invoke('oplog:delete', id),
        clearAll: () => ipcRenderer.invoke('oplog:clearAll'),
        // 目录和格式设置
        getDir: () => ipcRenderer.invoke('oplog:getDir'),
        setDir: (dir) => ipcRenderer.invoke('oplog:setDir', dir),
        selectDir: () => ipcRenderer.invoke('oplog:selectDir'),
        openDir: () => ipcRenderer.invoke('oplog:openDir'),
        getSettings: () => ipcRenderer.invoke('oplog:getSettings'),
        setSaveMd: (enabled) => ipcRenderer.invoke('oplog:setSaveMd', enabled)
    },

    // ==================== 对话框 ====================
    dialog: {
        selectFile: (options) => ipcRenderer.invoke('dialog:selectFile', options),
        openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
        saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options)
    },

    // ==================== 文件系统 ====================
    fs: {
        readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
        writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
        getPathForFile: (file) => webUtils.getPathForFile(file)
    },

    // ==================== Shell ====================
    shell: {
        openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
    },

    // ==================== Speed Test ====================
    speedtest: {
        open: () => ipcRenderer.invoke('speedtest:open')
    },

    // ==================== Port Scanner ====================
    portscanner: {
        open: () => ipcRenderer.invoke('portscanner:open')
    },

    // ==================== Ping Test ====================
    ping: {
        open: () => ipcRenderer.invoke('ping:open'),
        host: (host, port, timeout) => ipcRenderer.invoke('ping:host', host, port, timeout)
    },

    // ==================== Subnetting ====================
    subnetting: {
        open: () => ipcRenderer.invoke('subnetting:open')
    },

    // ==================== IPv6 Subnetting ====================
    ipv6Subnetting: {
        open: () => ipcRenderer.invoke('ipv6Subnetting:open')
    },

    // ==================== Traceroute ====================
    traceroute: {
        open: () => ipcRenderer.invoke('traceroute:open'),
        reverseDns: (ip) => ipcRenderer.invoke('traceroute:reverseDns', ip)
    },

    // ==================== Packet Capture ====================
    packetCapture: {
        open: () => ipcRenderer.invoke('packetCapture:open')
    },

    // ==================== Netcat (TCP 工具) ====================
    netcat: {
        open: () => ipcRenderer.invoke('netcat:open'),

        // 客户端
        clientConnect: (host, port, timeout) => ipcRenderer.invoke('netcat:client-connect', { host, port, timeout }),
        clientSend: (data, format, appendNewline) => ipcRenderer.invoke('netcat:client-send', { data, format, appendNewline }),
        clientDisconnect: () => ipcRenderer.invoke('netcat:client-disconnect'),
        onClientState: (callback) => ipcRenderer.on('netcat:client-state', (_, payload) => callback(payload)),
        onClientData: (callback) => ipcRenderer.on('netcat:client-data', (_, payload) => callback(payload)),

        // 服务端
        serverStart: (port, host) => ipcRenderer.invoke('netcat:server-start', { port, host }),
        serverStop: () => ipcRenderer.invoke('netcat:server-stop'),
        serverSend: (id, data, format, appendNewline) => ipcRenderer.invoke('netcat:server-send', { id, data, format, appendNewline }),
        serverKick: (id) => ipcRenderer.invoke('netcat:server-kick', { id }),
        onServerState: (callback) => ipcRenderer.on('netcat:server-state', (_, payload) => callback(payload)),
        onServerClient: (callback) => ipcRenderer.on('netcat:server-client', (_, payload) => callback(payload)),
        onServerData: (callback) => ipcRenderer.on('netcat:server-data', (_, payload) => callback(payload)),

        // Banner
        bannerGrab: (targets, timeout, concurrency, probe) => ipcRenderer.invoke('netcat:banner-grab', { targets, timeout, concurrency, probe }),
        bannerStop: () => ipcRenderer.invoke('netcat:banner-stop'),
        onBannerProgress: (callback) => ipcRenderer.on('netcat:banner-progress', (_, payload) => callback(payload))
    },

    // ==================== DNS Lookup (DNSPy 风格) ====================
    dns: {
        open: () => ipcRenderer.invoke('dns:open')
    },

    // ==================== TsharkAnalyzer (AI 网络分析) ====================
    tsharkAnalyzer: {
        open: () => ipcRenderer.invoke('tshark:open')
    },

    // ==================== BroadcastDetector (广播与环路检测) ====================
    broadcastDetector: {
        open: () => ipcRenderer.invoke('broadcastDetector:open'),
        checkVersion: (customPath) => ipcRenderer.invoke('broadcastDetector:checkVersion', customPath),
        browseTshark: () => ipcRenderer.invoke('broadcastDetector:browseTshark'),
        getInterfaces: () => ipcRenderer.invoke('broadcastDetector:getInterfaces'),
        start: (options) => ipcRenderer.invoke('broadcastDetector:start', options),
        stop: () => ipcRenderer.invoke('broadcastDetector:stop'),
        onPackets: (callback) => ipcRenderer.on('broadcastDetector:packets', (event, data) => callback(data)),
        onError: (callback) => ipcRenderer.on('broadcastDetector:error', (event, data) => callback(data)),
        onStopped: (callback) => ipcRenderer.on('broadcastDetector:stopped', (event, data) => callback(data)),
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('broadcastDetector:packets');
            ipcRenderer.removeAllListeners('broadcastDetector:error');
            ipcRenderer.removeAllListeners('broadcastDetector:stopped');
        }
    },

    // ==================== 连接历史 ====================
    history: {
        getAll: () => ipcRenderer.invoke('history:getAll'),
        add: (record) => ipcRenderer.invoke('history:add', record),
        clear: () => ipcRenderer.invoke('history:clear'),
        delete: (deviceId, timestamp) => ipcRenderer.invoke('history:delete', deviceId, timestamp)
    },

    // ==================== 密码加密 ====================
    crypto: {
        isAvailable: () => ipcRenderer.invoke('crypto:isAvailable'),
        encrypt: (password) => ipcRenderer.invoke('crypto:encrypt', password),
        decrypt: (encrypted) => ipcRenderer.invoke('crypto:decrypt', encrypted)
    },

    // ==================== 启动密码保护 ====================
    password: {
        isEnabled: () => ipcRenderer.invoke('password:isEnabled'),
        getStatus: () => ipcRenderer.invoke('password:getStatus'),
        set: (password) => ipcRenderer.invoke('password:set', password),
        change: (oldPassword, newPassword) => ipcRenderer.invoke('password:change', { oldPassword, newPassword }),
        disable: (currentPassword) => ipcRenderer.invoke('password:disable', currentPassword),
        verify: (password) => ipcRenderer.invoke('password:verify', password)
    },

    // ==================== 主题持久化 ====================
    theme: {
        get: () => ipcRenderer.invoke('theme:get'),
        save: (theme) => ipcRenderer.invoke('theme:save', theme)
    },

    // ==================== 应用控制 ====================
    app: {
        getPaths: () => ipcRenderer.invoke('app:getPaths'),
        onCloseRequest: (callback) => {
            ipcRenderer.on('app:close-request', () => callback());
        },
        confirmClose: (confirmed) => ipcRenderer.send('app:close-confirmed', confirmed)
    },

    // ==================== 连接统一控制 ====================
    connection: {
        setEncoding: (connectionId, encoding) => ipcRenderer.invoke('connection:setEncoding', { connectionId, encoding }),
        setTerminalOutputPaused: (connectionId, paused) => ipcRenderer.send('terminal:flow-control', {
            connectionId,
            paused: Boolean(paused)
        })
    },

    // ==================== AI 网络助手 ====================
    copilot: {
        getConfigStatus: () => ipcRenderer.invoke('copilot:getConfigStatus'),
        getConfig: () => ipcRenderer.invoke('copilot:getConfig'),
        saveConfig: (config) => ipcRenderer.invoke('copilot:saveConfig', config),
        chat: (params) => ipcRenderer.send('copilot:chat', params),
        abort: () => ipcRenderer.send('copilot:abort'),
        onChunk: (callback) => ipcRenderer.on('copilot:chunk', (event, chunk) => callback(chunk)),
        onEnd: (callback) => ipcRenderer.on('copilot:end', (event, messages) => callback(messages)),
        onError: (callback) => ipcRenderer.on('copilot:error', (event, err) => callback(err)),
        onGeneratingReport: (callback) => {
            ipcRenderer.on('copilot:generatingReport', (event) => callback());
        },
        // 智能代理 & 人工审核相关
        approveResponse: (requestId, approved) => ipcRenderer.invoke('copilot:approveResponse', { requestId, approved }),
        onApproveRequest: (callback) => {
            ipcRenderer.on('copilot:approveRequest', (event, data) => callback(data));
        },
        removeApproveRequestListener: () => {
            ipcRenderer.removeAllListeners('copilot:approveRequest');
        },
        onAgentStep: (callback) => {
            ipcRenderer.on('copilot:agentStep', (event, data) => callback(data));
        },
        removeAgentStepListener: () => {
            ipcRenderer.removeAllListeners('copilot:agentStep');
        },
        removeAllListeners: () => {
            ipcRenderer.removeAllListeners('copilot:chunk');
            ipcRenderer.removeAllListeners('copilot:end');
            ipcRenderer.removeAllListeners('copilot:error');
            ipcRenderer.removeAllListeners('copilot:generatingReport');
            ipcRenderer.removeAllListeners('copilot:approveRequest');
            ipcRenderer.removeAllListeners('copilot:agentStep');
        }
    },

    // ==================== 窗口控制（自定义标题栏） ====================
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        onMaximizedChange: (callback) => {
            ipcRenderer.on('window:maximized', (_, isMax) => callback(isMax));
        }
    },

    // ==================== 资产勘测 ====================
    reconnaissance: {
        getConfig: () => ipcRenderer.invoke('recon:getConfig'),
        saveConfig: (config) => ipcRenderer.invoke('recon:saveConfig', config),
        fofaSearch: (params) => ipcRenderer.invoke('recon:fofaSearch', params),
        startSubdomain: (params) => ipcRenderer.invoke('recon:startSubdomain', params),
        stopSubdomain: () => ipcRenderer.invoke('recon:stopSubdomain'),
        onSubdomainProgress: (callback) => {
            ipcRenderer.on('recon:subdomain-progress', (event, data) => callback(data));
        },
        removeSubdomainListeners: () => {
            ipcRenderer.removeAllListeners('recon:subdomain-progress');
        },
        startFingerprint: (params) => ipcRenderer.invoke('recon:startFingerprint', params),
        stopFingerprint: () => ipcRenderer.invoke('recon:stopFingerprint'),
        onFingerprintProgress: (callback) => {
            ipcRenderer.on('recon:fingerprint-progress', (event, data) => callback(data));
        },
        removeFingerprintListeners: () => {
            ipcRenderer.removeAllListeners('recon:fingerprint-progress');
        },
        startSnmpScan: (params) => ipcRenderer.invoke('recon:startSnmpInterfaceScan', params),
        stopSnmpScan: () => ipcRenderer.invoke('recon:stopSnmpScan'),
        onSnmpProgress: (callback) => {
            ipcRenderer.on('recon:snmp-progress', (event, data) => callback(data));
        },
        removeSnmpListeners: () => {
            ipcRenderer.removeAllListeners('recon:snmp-progress');
        },
        getPortTraffic: (params) => ipcRenderer.invoke('recon:getRealtimePortTraffic', params)
    }
});
