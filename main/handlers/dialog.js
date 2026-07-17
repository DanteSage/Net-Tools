/**
 * 对话框和文件系统 IPC 处理模块
 */
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const { paths, getBackupDir, getOplogDir } = require('../config');
const { normalizeExternalUrl, normalizeOpenPath } = require('../utils/shell-validation');
const {
    assertTrustedMainFrame,
    buildOpenDialogOptions,
    buildSaveDialogOptions,
    registerTextFileDialogHandlers
} = require('../utils/dialog-file-access');

const MAIN_ENTRY_PATH = path.join(__dirname, '..', '..', 'index.html');

function getAllowedOpenDirectories() {
    return [paths.config, getBackupDir(), getOplogDir()];
}

/**
 * 注册对话框和文件系统相关 IPC 处理程序
 */
function registerDialogHandlers(context, dependencies = {}) {
    const { getMainWindow } = context;
    const ipc = dependencies.ipcMain || ipcMain;
    const dialogApi = dependencies.dialog || dialog;
    const shellApi = dependencies.shell || shell;

    ipc.handle('dialog:selectFile', async (event, options) => {
        const mainWindow = getMainWindow();
        assertTrustedMainFrame(event, mainWindow, MAIN_ENTRY_PATH);
        const result = await dialogApi.showOpenDialog(mainWindow, buildOpenDialogOptions(options));

        if (!result.canceled && result.filePaths.length > 0) {
            assertTrustedMainFrame(event, getMainWindow(), MAIN_ENTRY_PATH);
            return result.filePaths[0];
        }
        return null;
    });

    ipc.handle('dialog:openFile', async (event, options) => {
        const mainWindow = getMainWindow();
        assertTrustedMainFrame(event, mainWindow, MAIN_ENTRY_PATH);
        const result = await dialogApi.showOpenDialog(mainWindow, buildOpenDialogOptions(options));

        if (!result.canceled && result.filePaths.length > 0) {
            assertTrustedMainFrame(event, getMainWindow(), MAIN_ENTRY_PATH);
            return result.filePaths[0];
        }
        return null;
    });

    ipc.handle('dialog:saveFile', async (event, options) => {
        const mainWindow = getMainWindow();
        assertTrustedMainFrame(event, mainWindow, MAIN_ENTRY_PATH);
        const result = await dialogApi.showSaveDialog(mainWindow, buildSaveDialogOptions(options));

        if (!result.canceled && result.filePath) {
            assertTrustedMainFrame(event, getMainWindow(), MAIN_ENTRY_PATH);
            return result.filePath;
        }
        return null;
    });

    registerTextFileDialogHandlers({
        ipcMain: ipc,
        dialog: dialogApi,
        getMainWindow,
        trustedEntryPath: MAIN_ENTRY_PATH,
        fs: dependencies.fs,
        crypto: dependencies.crypto
    });

    ipc.handle('shell:openPath', async (event, filePath) => {
        const safePath = normalizeOpenPath(filePath, getAllowedOpenDirectories());
        return shellApi.openPath(safePath);
    });

    ipc.handle('shell:openExternal', async (event, url) => {
        const safeUrl = normalizeExternalUrl(url);
        return shellApi.openExternal(safeUrl);
    });

    ipc.handle('app:getPaths', async () => {
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
