/**
 * 启动密码保护 IPC 处理模块
 */
const { ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 密码配置文件路径
const configDir = path.join(app.getPath('userData'), 'config');
const passwordFile = path.join(configDir, 'password.json');

/**
 * 确保配置目录存在
 */
function ensureConfigDir() {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
}

/**
 * 读取密码配置
 */
function readPasswordConfig() {
    try {
        if (fs.existsSync(passwordFile)) {
            return JSON.parse(fs.readFileSync(passwordFile, 'utf-8'));
        }
    } catch (e) {
        console.error('读取密码配置失败:', e);
    }
    return { enabled: false, password: null };
}

/**
 * 保存密码配置
 */
function savePasswordConfig(config) {
    try {
        ensureConfigDir();
        fs.writeFileSync(passwordFile, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.error('保存密码配置失败:', e);
        return false;
    }
}

/**
 * 注册密码保护相关 IPC 处理程序
 */
function registerPasswordHandlers() {
    // 检查是否启用了密码保护
    ipcMain.handle('password:isEnabled', async () => {
        const config = readPasswordConfig();
        return config.enabled && config.password;
    });

    // 验证密码
    ipcMain.handle('password:verify', async (event, inputPassword) => {
        const config = readPasswordConfig();
        if (!config.enabled || !config.password) {
            return { success: true };
        }
        
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                // 如果加密不可用，直接比较
                return { success: config.password === inputPassword };
            }
            
            const encrypted = Buffer.from(config.password, 'base64');
            const storedPassword = safeStorage.decryptString(encrypted);
            return { success: storedPassword === inputPassword };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 设置密码
    ipcMain.handle('password:set', async (event, newPassword) => {
        try {
            let encryptedPassword;
            
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(newPassword);
                encryptedPassword = encrypted.toString('base64');
            } else {
                // 如果加密不可用，存储原始密码（不推荐）
                encryptedPassword = newPassword;
            }
            
            const saved = savePasswordConfig({
                enabled: true,
                password: encryptedPassword
            });
            
            return { success: saved };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 修改密码
    ipcMain.handle('password:change', async (event, { oldPassword, newPassword }) => {
        // 先验证旧密码
        const config = readPasswordConfig();
        if (config.enabled && config.password) {
            try {
                let storedPassword;
                if (safeStorage.isEncryptionAvailable()) {
                    const encrypted = Buffer.from(config.password, 'base64');
                    storedPassword = safeStorage.decryptString(encrypted);
                } else {
                    storedPassword = config.password;
                }
                
                if (storedPassword !== oldPassword) {
                    return { success: false, error: '原密码错误' };
                }
            } catch (e) {
                return { success: false, error: '验证失败: ' + e.message };
            }
        }
        
        // 设置新密码
        try {
            let encryptedPassword;
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(newPassword);
                encryptedPassword = encrypted.toString('base64');
            } else {
                encryptedPassword = newPassword;
            }
            
            const saved = savePasswordConfig({
                enabled: true,
                password: encryptedPassword
            });
            
            return { success: saved };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 禁用密码保护
    ipcMain.handle('password:disable', async (event, currentPassword) => {
        const config = readPasswordConfig();
        
        // 验证当前密码
        if (config.enabled && config.password) {
            try {
                let storedPassword;
                if (safeStorage.isEncryptionAvailable()) {
                    const encrypted = Buffer.from(config.password, 'base64');
                    storedPassword = safeStorage.decryptString(encrypted);
                } else {
                    storedPassword = config.password;
                }
                
                if (storedPassword !== currentPassword) {
                    return { success: false, error: '密码错误' };
                }
            } catch (e) {
                return { success: false, error: '验证失败: ' + e.message };
            }
        }
        
        const saved = savePasswordConfig({ enabled: false, password: null });
        return { success: saved };
    });

    // 获取密码保护状态
    ipcMain.handle('password:getStatus', async () => {
        const config = readPasswordConfig();
        return {
            enabled: config.enabled && !!config.password,
            encryptionAvailable: safeStorage.isEncryptionAvailable()
        };
    });
}

/**
 * 检查是否需要密码验证（供主进程调用）
 */
function isPasswordRequired() {
    const config = readPasswordConfig();
    return config.enabled && !!config.password;
}

module.exports = { 
    registerPasswordHandlers,
    isPasswordRequired
};
