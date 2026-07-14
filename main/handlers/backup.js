/**
 * 备份功能 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog } = require('electron');
const { paths, saveSettings, getBackupDir, setBackupDir, ensureDirectories } = require('../config');

/**
 * 注册备份相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerBackupHandlers(context) {
    const { getMainWindow } = context;

    // 创建备份
    ipcMain.handle('backup:create', async (event, { device, commands }) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `${device.name || device.host}_${timestamp}.txt`;
        return { success: true, fileName: backupFileName };
    });

    // 获取所有备份
    ipcMain.handle('backup:getAll', async () => {
        const backupDir = getBackupDir();
        const files = fs.readdirSync(backupDir)
            .map(f => {
                const stat = fs.statSync(path.join(backupDir, f));
                return {
                    name: f,
                    size: stat.size,
                    created: stat.birthtime
                };
            })
            .sort((a, b) => b.created - a.created);
        return files;
    });

    // 获取备份目录路径
    ipcMain.handle('backup:getDir', async () => {
        return getBackupDir();
    });

    // 设置备份目录
    ipcMain.handle('backup:setDir', async (event, newDir) => {
        if (!newDir) {
            setBackupDir(paths.defaultBackup);
            saveSettings({ backupDir: paths.defaultBackup });
            ensureDirectories();
            return { success: true, path: getBackupDir() };
        }
        
        try {
            if (!fs.existsSync(newDir)) {
                fs.mkdirSync(newDir, { recursive: true });
            }
            setBackupDir(newDir);
            saveSettings({ backupDir: newDir });
            return { success: true, path: getBackupDir() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 选择备份目录
    ipcMain.handle('backup:selectDir', async () => {
        const mainWindow = getMainWindow();
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: '选择配置备份存储目录',
            defaultPath: getBackupDir()
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            const newDir = result.filePaths[0];
            setBackupDir(newDir);
            saveSettings({ backupDir: newDir });
            return { success: true, path: newDir };
        }
        return { success: false };
    });

    // 下载备份文件
    ipcMain.handle('backup:download', async (event, fileName) => {
        const mainWindow = getMainWindow();
        const backupDir = getBackupDir();
        const safeFileName = path.basename(fileName);
        const sourcePath = path.join(backupDir, safeFileName);
        
        if (!fs.existsSync(sourcePath)) {
            return { success: false, error: '文件不存在' };
        }
        
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: safeFileName,
            filters: [
                { name: '文本文件', extensions: ['txt'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled) {
            fs.copyFileSync(sourcePath, result.filePath);
            return { success: true, path: result.filePath };
        }
        return { success: false };
    });

    // 删除备份文件
    ipcMain.handle('backup:delete', async (event, fileName) => {
        const backupDir = getBackupDir();
        const safeFileName = path.basename(fileName);
        const filePath = path.join(backupDir, safeFileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return { success: true };
        }
        return { success: false };
    });

    // 读取备份文件内容
    ipcMain.handle('backup:read', async (event, fileName) => {
        const backupDir = getBackupDir();
        const safeFileName = path.basename(fileName);
        const filePath = path.join(backupDir, safeFileName);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        return null;
    });
}

module.exports = { registerBackupHandlers };
