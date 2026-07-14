/**
 * 加密功能 IPC 处理模块
 */
const { ipcMain, safeStorage } = require('electron');

/**
 * 注册加密相关 IPC 处理程序
 */
function registerCryptoHandlers() {

    // 检查是否支持加密
    ipcMain.handle('crypto:isAvailable', async () => {
        return safeStorage.isEncryptionAvailable();
    });

    // 加密密码
    ipcMain.handle('crypto:encrypt', async (event, password) => {
        if (!safeStorage.isEncryptionAvailable()) {
            return { success: false, error: '加密不可用' };
        }
        try {
            const encrypted = safeStorage.encryptString(password);
            return { success: true, data: encrypted.toString('base64') };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 解密密码
    ipcMain.handle('crypto:decrypt', async (event, encryptedBase64) => {
        if (!safeStorage.isEncryptionAvailable()) {
            return { success: false, error: '解密不可用' };
        }
        try {
            const encrypted = Buffer.from(encryptedBase64, 'base64');
            const decrypted = safeStorage.decryptString(encrypted);
            return { success: true, data: decrypted };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { registerCryptoHandlers };
