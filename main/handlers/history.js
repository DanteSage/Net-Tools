/**
 * 连接历史 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { paths } = require('../config');

const historyFile = path.join(paths.config, 'connection-history.json');
const MAX_HISTORY = 20;

/**
 * 注册连接历史相关 IPC 处理程序
 */
function registerHistoryHandlers() {

    // 获取连接历史
    ipcMain.handle('history:getAll', async () => {
        if (fs.existsSync(historyFile)) {
            try {
                return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch (e) {
                return [];
            }
        }
        return [];
    });

    // 添加连接历史
    ipcMain.handle('history:add', async (event, record) => {
        let history = [];
        if (fs.existsSync(historyFile)) {
            try {
                history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch (e) {}
        }
        
        // 移除相同设备的旧记录
        history = history.filter(h => h.deviceId !== record.deviceId);
        
        // 添加新记录到开头
        history.unshift({
            ...record,
            timestamp: new Date().toISOString()
        });
        
        // 限制历史记录数量
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }
        
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        return true;
    });

    // 清空连接历史
    ipcMain.handle('history:clear', async () => {
        if (fs.existsSync(historyFile)) {
            fs.unlinkSync(historyFile);
        }
        return true;
    });

    // 删除单条历史记录
    ipcMain.handle('history:delete', async (event, deviceId, timestamp) => {
        let history = [];
        if (fs.existsSync(historyFile)) {
            try {
                history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch (e) {}
        }
        
        history = history.filter(h => !(h.deviceId === deviceId && h.timestamp === timestamp));
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        return true;
    });
}

module.exports = { registerHistoryHandlers };
