/**
 * 运行日志 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog } = require('electron');
const { paths } = require('../config');

const runtimeLogFile = path.join(paths.logs, 'runtime-logs.log');
const MAX_RUNTIME_LOGS = 1000;

/**
 * 解析日志行
 */
function parseLogLine(line) {
    const match = line.match(/^\[(.+?)\] \[(.+?)\] \[(.+?)\] (.+?)(?:\s\|\|\|\s(.+))?$/);
    if (match) {
        return {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            timestamp: match[1],
            level: match[2],
            title: match[3],
            message: match[4],
            details: match[5] || null
        };
    }
    return null;
}

/**
 * 格式化日志行
 */
function formatLogLine(log) {
    let line = `[${log.timestamp}] [${log.level}] [${log.title}] ${log.message}`;
    if (log.details) {
        line += ` ||| ${log.details}`;
    }
    return line;
}

/**
 * 注册运行日志相关 IPC 处理程序
 */
function registerLogHandlers(context) {
    const { getMainWindow } = context;

    // 加载运行日志
    ipcMain.handle('logs:load', async () => {
        try {
            if (fs.existsSync(runtimeLogFile)) {
                const data = fs.readFileSync(runtimeLogFile, 'utf-8');
                const lines = data.split('\n').filter(line => line.trim());
                const logs = [];
                for (const line of lines) {
                    const log = parseLogLine(line);
                    if (log) logs.push(log);
                }
                return logs;
            }
        } catch (error) {
            console.error('[日志] 加载运行日志失败:', error);
        }
        return [];
    });

    // 保存运行日志
    ipcMain.handle('logs:save', async (event, logs) => {
        try {
            const trimmedLogs = logs.slice(0, MAX_RUNTIME_LOGS);
            const content = trimmedLogs.map(formatLogLine).join('\n');
            fs.writeFileSync(runtimeLogFile, content, 'utf-8');
            return { success: true };
        } catch (error) {
            console.error('[日志] 保存运行日志失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 清空运行日志
    ipcMain.handle('logs:clear', async () => {
        try {
            if (fs.existsSync(runtimeLogFile)) {
                fs.unlinkSync(runtimeLogFile);
            }
            return { success: true };
        } catch (error) {
            console.error('[日志] 清空运行日志失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 导出运行日志
    ipcMain.handle('logs:export', async (event, content) => {
        const mainWindow = getMainWindow();
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: `runtime-logs-${new Date().toISOString().slice(0, 10)}.txt`,
            filters: [
                { name: '文本文件', extensions: ['txt'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (!result.canceled) {
            fs.writeFileSync(result.filePath, content, 'utf-8');
            return { success: true, path: result.filePath };
        }
        return { success: false };
    });
}

module.exports = { registerLogHandlers };
