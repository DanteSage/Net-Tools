/**
 * 对话框和文件系统 IPC 处理模块
 */
const fs = require('fs');
const { ipcMain, dialog, shell } = require('electron');
const { paths, getBackupDir, getOplogDir } = require('../config');
const { normalizeExternalUrl, normalizeOpenPath } = require('../utils/shell-validation');

function getAllowedOpenDirectories() {
    return [paths.config, getBackupDir(), getOplogDir()];
}

/**
 * 注册对话框和文件系统相关 IPC 处理程序
 */
function registerDialogHandlers(context) {
    const { getMainWindow } = context;

    // 选择私钥文件
    ipcMain.handle('dialog:selectFile', async (event, options) => {
        const mainWindow = getMainWindow();
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: options?.filters || [
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // 打开文件对话框
    ipcMain.handle('dialog:openFile', async (event, options) => {
        const mainWindow = getMainWindow();
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: options?.filters || [
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // 保存文件对话框
    ipcMain.handle('dialog:saveFile', async (event, options) => {
        const mainWindow = getMainWindow();
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: options?.defaultPath,
            filters: options?.filters || [
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled && result.filePath) {
            return result.filePath;
        }
        return null;
    });

    // 读取文件（支持 GBK 编码自动检测）
    ipcMain.handle('fs:readFile', async (event, filePath) => {
        try {
            const buffer = fs.readFileSync(filePath);
            
            // UTF-8 BOM
            if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                return buffer.slice(3).toString('utf8');
            }
            // UTF-16 LE BOM
            if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
                return buffer.slice(2).toString('utf16le');
            }
            // UTF-16 BE BOM
            if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
                const swapped = Buffer.alloc(buffer.length - 2);
                for (let i = 2; i < buffer.length - 1; i += 2) {
                    swapped[i - 2] = buffer[i + 1];
                    swapped[i - 1] = buffer[i];
                }
                return swapped.toString('utf16le');
            }
            
            // 尝试 UTF-8 解码
            const utf8Text = buffer.toString('utf8');
            if (utf8Text.includes('\uFFFD') || /[\x80-\xFF]/.test(utf8Text.slice(0, 100))) {
                try {
                    const iconv = require('iconv-lite');
                    const gbkText = iconv.decode(buffer, 'gbk');
                    if (/[\u4e00-\u9fa5]/.test(gbkText)) {
                        return gbkText;
                    }
                } catch (e) {}
            }
            
            return utf8Text;
        } catch (error) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
    });

    // 写入文件
    ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
        try {
            fs.writeFileSync(filePath, content, 'utf8');
            return { success: true };
        } catch (error) {
            throw new Error(`写入文件失败: ${error.message}`);
        }
    });

    // Shell 操作 - 打开路径
    ipcMain.handle('shell:openPath', async (event, filePath) => {
        const safePath = normalizeOpenPath(filePath, getAllowedOpenDirectories());
        return shell.openPath(safePath);
    });

    // Shell 操作 - 打开外部链接
    ipcMain.handle('shell:openExternal', async (event, url) => {
        const safeUrl = normalizeExternalUrl(url);
        return shell.openExternal(safeUrl);
    });

    // 获取应用路径信息
    ipcMain.handle('app:getPaths', async () => {
        return {
            logs: paths.logs,
            config: paths.config,
            backups: getBackupDir(),
            oplogs: getOplogDir(),
            userData: paths.userData
        };
    });
}

module.exports = { registerDialogHandlers };
