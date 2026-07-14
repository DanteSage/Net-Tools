/**
 * 设备管理 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { paths } = require('../config');

/**
 * 注册设备管理相关 IPC 处理程序
 */
function registerDeviceHandlers() {
    const devicesFile = path.join(paths.config, 'devices.json');
    const groupsFile = path.join(paths.config, 'groups.json');

    // 获取设备列表
    ipcMain.handle('devices:getAll', async () => {
        if (fs.existsSync(devicesFile)) {
            return JSON.parse(fs.readFileSync(devicesFile, 'utf-8'));
        }
        return [];
    });

    // 保存设备
    ipcMain.handle('devices:save', async (event, devices) => {
        fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2));
        return true;
    });

    // 获取分组
    ipcMain.handle('groups:getAll', async () => {
        if (fs.existsSync(groupsFile)) {
            return JSON.parse(fs.readFileSync(groupsFile, 'utf-8'));
        }
        return ['默认分组'];
    });

    // 保存分组
    ipcMain.handle('groups:save', async (event, groups) => {
        fs.writeFileSync(groupsFile, JSON.stringify(groups, null, 2));
        return true;
    });
}

module.exports = { registerDeviceHandlers };
