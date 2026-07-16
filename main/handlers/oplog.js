/**
 * 操作日志 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const { 
    paths, saveSettings, 
    getOplogDir, setOplogDir, 
    getOplogSaveMd, setOplogSaveMd,
    ensureDirectories 
} = require('../config');
const { normalizeOpenPath } = require('../utils/shell-validation');

/**
 * 生成操作日志的 TXT 内容
 */
function generateOplogTxt(oplog) {
    const connTypeLabel = oplog.connectionType === 'serial' ? 'Console' : 
                          (oplog.connectionType === 'telnet' ? 'Telnet' : 'SSH');
    const startTime = new Date(oplog.startTime).toLocaleString('zh-CN');
    const endTime = oplog.endTime ? new Date(oplog.endTime).toLocaleString('zh-CN') : '进行中';
    
    let txt = `${'='.repeat(60)}\n`;
    txt += `操作日志 - ${oplog.deviceName}\n`;
    txt += `${'='.repeat(60)}\n`;
    txt += `设备名称: ${oplog.deviceName}\n`;
    txt += `设备类型: ${oplog.deviceType || '未知'}\n`;
    txt += `连接方式: ${connTypeLabel}\n`;
    txt += `开始时间: ${startTime}\n`;
    txt += `结束时间: ${endTime}\n`;
    txt += `${'='.repeat(60)}\n\n`;
    txt += oplog.content || '';
    
    return txt;
}

/**
 * 生成操作日志的 Markdown 内容
 */
function generateOplogMarkdown(oplog) {
    const connTypeLabel = oplog.connectionType === 'serial' ? 'Console' : 
                          (oplog.connectionType === 'telnet' ? 'Telnet' : 'SSH');
    const startTime = new Date(oplog.startTime).toLocaleString('zh-CN');
    const endTime = oplog.endTime ? new Date(oplog.endTime).toLocaleString('zh-CN') : '进行中';
    
    let md = `# 操作日志 - ${oplog.deviceName}\n\n`;
    md += `## 基本信息\n\n`;
    md += `| 属性 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 设备名称 | ${oplog.deviceName} |\n`;
    md += `| 设备类型 | ${oplog.deviceType || '未知'} |\n`;
    md += `| 连接方式 | ${connTypeLabel} |\n`;
    md += `| 开始时间 | ${startTime} |\n`;
    md += `| 结束时间 | ${endTime} |\n\n`;
    md += `## 操作内容\n\n`;
    md += '```\n';
    md += oplog.content || '';
    md += '\n```\n';
    
    return md;
}

/**
 * 解析操作日志文件元数据
 */
function parseOplogMeta(content, filename, stat) {
    const meta = {
        id: filename,
        filename: filename,
        deviceName: '未知设备',
        deviceType: 'default',
        connectionType: 'ssh',
        startTime: stat.birthtime.toISOString(),
        endTime: stat.mtime.toISOString(),
        contentSize: stat.size
    };
    
    const isMdFormat = filename.endsWith('.md');
    const lines = content.split('\n').slice(0, 15);
    
    for (const line of lines) {
        if (isMdFormat) {
            if (line.includes('| 设备名称 |')) {
                const match = line.match(/\| 设备名称 \| (.+?) \|/);
                if (match) meta.deviceName = match[1].trim();
            } else if (line.includes('| 设备类型 |')) {
                const match = line.match(/\| 设备类型 \| (.+?) \|/);
                if (match) meta.deviceType = match[1].trim().toLowerCase() || 'default';
            } else if (line.includes('| 连接方式 |')) {
                const match = line.match(/\| 连接方式 \| (.+?) \|/);
                if (match) {
                    const connType = match[1].trim();
                    meta.connectionType = connType === 'Console' ? 'serial' : 
                                          (connType === 'Telnet' ? 'telnet' : 'ssh');
                }
            } else if (line.includes('| 开始时间 |')) {
                const match = line.match(/\| 开始时间 \| (.+?) \|/);
                if (match) {
                    try { meta.startTime = new Date(match[1].trim()).toISOString(); } catch (e) {}
                }
            } else if (line.includes('| 结束时间 |')) {
                const match = line.match(/\| 结束时间 \| (.+?) \|/);
                if (match && match[1].trim() !== '进行中') {
                    try { meta.endTime = new Date(match[1].trim()).toISOString(); } catch (e) {}
                }
            }
        } else {
            if (line.startsWith('设备名称:')) {
                meta.deviceName = line.replace('设备名称:', '').trim();
            } else if (line.startsWith('设备类型:')) {
                meta.deviceType = line.replace('设备类型:', '').trim().toLowerCase() || 'default';
            } else if (line.startsWith('连接方式:')) {
                const connType = line.replace('连接方式:', '').trim();
                meta.connectionType = connType === 'Console' ? 'serial' : 
                                      (connType === 'Telnet' ? 'telnet' : 'ssh');
            } else if (line.startsWith('开始时间:')) {
                const timeStr = line.replace('开始时间:', '').trim();
                try { meta.startTime = new Date(timeStr).toISOString(); } catch (e) {}
            } else if (line.startsWith('结束时间:')) {
                const timeStr = line.replace('结束时间:', '').trim();
                if (timeStr !== '进行中') {
                    try { meta.endTime = new Date(timeStr).toISOString(); } catch (e) {}
                }
            }
        }
    }
    
    return meta;
}

/**
 * 注册操作日志相关 IPC 处理程序
 */
function registerOplogHandlers(context) {
    const { getMainWindow } = context;

    // 保存操作记录
    ipcMain.handle('oplog:save', async (event, oplog) => {
        try {
            const oplogDir = getOplogDir();
            const safeDeviceName = String(oplog.deviceName).replace(/[<>:"\/\\|?*]/g, '_');
            const timestamp = new Date(oplog.startTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
            
            let filename, content;
            if (getOplogSaveMd()) {
                filename = `${safeDeviceName}_${timestamp}.md`;
                content = generateOplogMarkdown(oplog);
            } else {
                filename = `${safeDeviceName}_${timestamp}.txt`;
                content = generateOplogTxt(oplog);
            }
            
            const filepath = path.join(oplogDir, filename);
            fs.writeFileSync(filepath, content, 'utf8');
            
            return { success: true, filename };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 获取所有操作记录
    ipcMain.handle('oplog:getAll', async () => {
        try {
            const oplogDir = getOplogDir();
            if (!fs.existsSync(oplogDir)) {
                return [];
            }
            const files = fs.readdirSync(oplogDir)
                .filter(f => f.endsWith('.txt') || f.endsWith('.md'))
                .map(f => {
                    const filepath = path.join(oplogDir, f);
                    const stat = fs.statSync(filepath);
                    const content = fs.readFileSync(filepath, 'utf8');
                    return parseOplogMeta(content, f, stat);
                })
                .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
            return files;
        } catch (error) {
            console.error('Error loading oplogs:', error);
            return [];
        }
    });

    // 获取单个操作记录
    ipcMain.handle('oplog:get', async (event, id) => {
        try {
            const oplogDir = getOplogDir();
            const filepath = path.join(oplogDir, id);
            if (fs.existsSync(filepath)) {
                const content = fs.readFileSync(filepath, 'utf8');
                const stat = fs.statSync(filepath);
                const meta = parseOplogMeta(content, id, stat);
                meta.content = content;
                return meta;
            }
            return null;
        } catch (error) {
            return null;
        }
    });

    // 删除操作记录
    ipcMain.handle('oplog:delete', async (event, id) => {
        try {
            const oplogDir = getOplogDir();
            const filepath = path.join(oplogDir, id);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 清空所有操作记录
    ipcMain.handle('oplog:clearAll', async () => {
        try {
            const oplogDir = getOplogDir();
            if (fs.existsSync(oplogDir)) {
                const files = fs.readdirSync(oplogDir)
                    .filter(f => f.endsWith('.txt') || f.endsWith('.md'));
                for (const f of files) {
                    fs.unlinkSync(path.join(oplogDir, f));
                }
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 获取操作日志目录
    ipcMain.handle('oplog:getDir', async () => {
        return getOplogDir();
    });

    // 获取操作日志设置
    ipcMain.handle('oplog:getSettings', async () => {
        return {
            dir: getOplogDir(),
            saveMd: getOplogSaveMd(),
            defaultDir: paths.defaultOplog
        };
    });

    // 设置操作日志目录
    ipcMain.handle('oplog:setDir', async (event, newDir) => {
        if (!newDir) {
            setOplogDir(paths.defaultOplog);
            saveSettings({ oplogDir: paths.defaultOplog });
            ensureDirectories();
            return { success: true, path: getOplogDir() };
        }
        
        try {
            if (!fs.existsSync(newDir)) {
                fs.mkdirSync(newDir, { recursive: true });
            }
            setOplogDir(newDir);
            saveSettings({ oplogDir: newDir });
            return { success: true, path: getOplogDir() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 选择操作日志目录
    ipcMain.handle('oplog:selectDir', async () => {
        const mainWindow = getMainWindow();
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: '选择操作日志存储目录',
            defaultPath: getOplogDir()
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            const newDir = result.filePaths[0];
            setOplogDir(newDir);
            saveSettings({ oplogDir: newDir });
            return { success: true, path: newDir };
        }
        return { success: false };
    });

    // 设置是否保存 MD 格式
    ipcMain.handle('oplog:setSaveMd', async (event, enabled) => {
        setOplogSaveMd(!!enabled);
        saveSettings({ oplogSaveMd: getOplogSaveMd() });
        return { success: true, saveMd: getOplogSaveMd() };
    });

    // 打开操作日志目录
    ipcMain.handle('oplog:openDir', async () => {
        const oplogDir = getOplogDir();
        const safePath = normalizeOpenPath(oplogDir, [oplogDir]);
        return shell.openPath(safePath);
    });
}

module.exports = { registerOplogHandlers };
