/**
 * 模板和变量管理 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { paths } = require('../config');

/**
 * 注册模板和变量相关 IPC 处理程序
 */
function registerTemplateHandlers() {
    const templatesFile = path.join(paths.config, 'templates.json');
    const variablesFile = path.join(paths.config, 'variables.json');

    // 获取所有模板
    ipcMain.handle('templates:getAll', async () => {
        if (fs.existsSync(templatesFile)) {
            return JSON.parse(fs.readFileSync(templatesFile, 'utf-8'));
        }
        return [];
    });

    // 保存模板
    ipcMain.handle('templates:save', async (event, templates) => {
        fs.writeFileSync(templatesFile, JSON.stringify(templates, null, 2));
        return true;
    });

    // 获取所有变量
    ipcMain.handle('variables:getAll', async () => {
        if (fs.existsSync(variablesFile)) {
            return JSON.parse(fs.readFileSync(variablesFile, 'utf-8'));
        }
        return [];
    });

    // 保存变量
    ipcMain.handle('variables:save', async (event, variables) => {
        fs.writeFileSync(variablesFile, JSON.stringify(variables, null, 2));
        return true;
    });
}

module.exports = { registerTemplateHandlers };
