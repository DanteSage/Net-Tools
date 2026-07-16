/**
 * 批量执行 IPC 处理入口模块
 */
const fs = require('fs');
const { ipcMain } = require('electron');
const { cleanBackupOutput } = require('../utils/helpers');
const { executeTarget } = require('./executor');
const { writeUniqueBackupFile } = require('./backup-file');

// 保持稳定引用，确保执行器、暂停和停止始终操作同一次状态对象。
const batchExecutionState = { running: false, paused: false, shouldStop: false };

function createFailedResult(target, error) {
    const safeTarget = target && typeof target === 'object' ? target : {};
    const now = new Date().toISOString();
    return {
        name: safeTarget.name || safeTarget.host || '未知目标',
        host: safeTarget.host || '',
        type: safeTarget.type || '',
        status: 'failed',
        output: '',
        error: error instanceof Error ? error.message : String(error),
        timestamp: now,
        startTime: Date.now(),
        duration: 0
    };
}

function createSummary(results) {
    return {
        total: results.length,
        success: results.filter(result => result.status === 'success').length,
        failed: results.filter(result => result.status === 'failed').length
    };
}

/**
 * 注册批量执行相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerBatchHandlers(context, dependencies = {}) {
    const ipc = dependencies.ipcMain || ipcMain;
    const runTarget = dependencies.executeTarget || executeTarget;
    const fsModule = dependencies.fs || fs;
    const resolveBackupDir = dependencies.getBackupDir || (() => require('../config').getBackupDir());
    const writeFile = dependencies.writeFile
        || (fsModule.promises && typeof fsModule.promises.writeFile === 'function'
            ? fsModule.promises.writeFile.bind(fsModule.promises)
            : (filePath, content, options) => new Promise((resolve, reject) => {
                fsModule.writeFile(filePath, content, options, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            }));
    
    // 批量执行命令
    ipc.handle('batch:execute', async (event, { targets, commands, options = {} }) => {
        if (batchExecutionState.running) {
            return { success: false, error: '已有批量任务正在执行' };
        }

        const results = [];
        const executionState = batchExecutionState;
        Object.assign(executionState, { running: true, paused: false, shouldStop: false });
        const normalizedOptions = options && typeof options === 'object' ? options : {};

        const {
            parallel = true,
            parallelCount = 5,
            timeout = 30000,
            cmdDelay = 500,
            stopOnError = false,
            saveBackup = false,
            variables = {}
        } = normalizedOptions;
        const safeTargets = Array.isArray(targets) ? targets : [];
        const safeCommands = Array.isArray(commands) ? commands : [];
        const safeParallelCount = Math.max(1, Math.min(parseInt(parallelCount, 10) || 1, 100));

        const executionOptions = {
            timeout,
            cmdDelay,
            saveBackup,
            variables
        };

        const executeSafely = async (target) => {
            try {
                return await runTarget(target, safeCommands, executionOptions, executionState, context);
            } catch (error) {
                const failedResult = createFailedResult(target, error);
                const mainWindow = context.getMainWindow();
                if (!context.isQuitting() && mainWindow && !mainWindow.isDestroyed()) {
                    try { mainWindow.webContents.send('batch:progress', { ...failedResult }); } catch (_) {}
                }
                return failedResult;
            }
        };

        try {
            // 执行所有目标
            if (parallel && safeParallelCount > 1) {
                const chunks = [];
                for (let i = 0; i < safeTargets.length; i += safeParallelCount) {
                    chunks.push(safeTargets.slice(i, i + safeParallelCount));
                }

                for (const chunk of chunks) {
                    if (executionState.shouldStop) break;
                    // executeSafely 保证整块任务全部 settle 后才释放全局运行锁。
                    const chunkResults = await Promise.all(chunk.map(executeSafely));
                    results.push(...chunkResults);

                    if (stopOnError && chunkResults.some(result => result.status === 'failed')) {
                        break;
                    }
                }
            } else {
                for (const target of safeTargets) {
                    if (executionState.shouldStop) break;
                    const result = await executeSafely(target);
                    results.push(result);

                    if (stopOnError && result.status === 'failed') {
                        break;
                    }
                }
            }

            // 保存配置备份
            if (saveBackup) {
                try {
                    const backupDir = resolveBackupDir();
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const usedFileNames = new Set();
                    let savedBackupCount = 0;
                    for (const result of results) {
                        if (result.status === 'success' && result.output) {
                            try {
                                await writeUniqueBackupFile({
                                    backupDir,
                                    targetName: result.name || result.host,
                                    timestamp,
                                    content: cleanBackupOutput(result.output),
                                    writeFile,
                                    usedFileNames
                                });
                                savedBackupCount += 1;
                            } catch (error) {
                                console.error('保存单个配置备份失败:', error);
                            }
                        }
                    }
                    console.log(`[Backup] 已保存 ${savedBackupCount} 个配置备份`);
                } catch (e) {
                    console.error('保存配置备份失败:', e);
                }
            }

            return { success: true, results, summary: createSummary(results) };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                results,
                summary: createSummary(results)
            };
        } finally {
            Object.assign(executionState, { running: false, paused: false, shouldStop: false });
        }
    });

    // 暂停/恢复批量执行
    ipc.handle('batch:pause', (event, pause) => {
        batchExecutionState.paused = pause;
        return { success: true };
    });

    // 停止批量执行
    ipc.handle('batch:stop', () => {
        batchExecutionState.shouldStop = true;
        return { success: true };
    });
}

module.exports = {
    registerBatchHandlers
};
