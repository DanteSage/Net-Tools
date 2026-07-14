/**
 * 配置管理模块
 * 处理应用路径配置和设置管理
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// 基础路径配置
const paths = {
    logs: path.join(app.getPath('userData'), 'logs'),
    config: path.join(app.getPath('userData'), 'config'),
    defaultBackup: path.join(app.getPath('userData'), 'Configuration Backup'),
    defaultOplog: path.join(app.getPath('userData'), 'oplogs'),
    userData: app.getPath('userData')
};

// 设置文件路径
const settingsFile = path.join(paths.config, 'settings.json');

// 可配置的目录（运行时可修改）
let backupDir = paths.defaultBackup;
let oplogDir = paths.defaultOplog;
let oplogSaveMd = true;

/**
 * 加载设置
 */
function loadSettings() {
    try {
        if (fs.existsSync(settingsFile)) {
            const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            if (settings.backupDir && fs.existsSync(settings.backupDir)) {
                backupDir = settings.backupDir;
            }
            if (settings.oplogDir && fs.existsSync(settings.oplogDir)) {
                oplogDir = settings.oplogDir;
            }
            if (settings.oplogSaveMd !== undefined) {
                oplogSaveMd = settings.oplogSaveMd;
            }
        }
    } catch (e) {
        console.error('加载设置失败:', e);
    }
}

/**
 * 保存设置
 * @param {Object} settings - 要保存的设置
 * @returns {boolean}
 */
function saveSettings(settings) {
    try {
        let currentSettings = {};
        if (fs.existsSync(settingsFile)) {
            currentSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        }
        const newSettings = { ...currentSettings, ...settings };
        fs.writeFileSync(settingsFile, JSON.stringify(newSettings, null, 2));
        return true;
    } catch (e) {
        console.error('保存设置失败:', e);
        return false;
    }
}

/**
 * 确保必要的目录存在
 */
function ensureDirectories() {
    [paths.logs, paths.config, backupDir, oplogDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

/**
 * 获取备份目录
 */
function getBackupDir() {
    return backupDir;
}

/**
 * 设置备份目录
 */
function setBackupDir(dir) {
    backupDir = dir;
}

/**
 * 获取操作日志目录
 */
function getOplogDir() {
    return oplogDir;
}

/**
 * 设置操作日志目录
 */
function setOplogDir(dir) {
    oplogDir = dir;
}

/**
 * 获取是否保存为 MD 格式
 */
function getOplogSaveMd() {
    return oplogSaveMd;
}

/**
 * 设置是否保存为 MD 格式
 */
function setOplogSaveMd(value) {
    oplogSaveMd = value;
}

module.exports = {
    paths,
    loadSettings,
    saveSettings,
    ensureDirectories,
    getBackupDir,
    setBackupDir,
    getOplogDir,
    setOplogDir,
    getOplogSaveMd,
    setOplogSaveMd
};
