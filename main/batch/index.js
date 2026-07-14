/**
 * 批量执行 IPC 处理入口模块
 */
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { cleanBackupOutput } = require('../utils/helpers');
const { getBackupDir } = require('../config');
const { executeTarget } = require('./executor');

// 批量执行状态
let batchExecutionState = { running: false, paused: false, shouldStop: false };

/**
 * 注册批量执行相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerBatchHandlers(context) {
    
    // 批量执行命令
    ipcMain.handle('batch:execute', async (event, { targets, commands, options = {} }) => {
        const results = [];
        batchExecutionState = { running: true, paused: false, shouldStop: false };
        
        const {
            parallel = true,
            parallelCount = 5,
            timeout = 30000,
            cmdDelay = 500,
            stopOnError = false,
            saveBackup = false,
            variables = {}
        } = options;
        
        const executionOptions = {
            timeout,
            cmdDelay,
            saveBackup,
            variables
        };
        
        // 执行所有目标
        if (parallel && parallelCount > 1) {
            // 并行执行
            const chunks = [];
            for (let i = 0; i < targets.length; i += parallelCount) {
                chunks.push(targets.slice(i, i + parallelCount));
            }
            
            for (const chunk of chunks) {
                if (batchExecutionState.shouldStop) break;
                
                const chunkResults = await Promise.all(
                    chunk.map(target => executeTarget(target, commands, executionOptions, batchExecutionState, context))
                );
                results.push(...chunkResults);
                
                if (stopOnError && chunkResults.some(r => r.status === 'failed')) {
                    break;
                }
            }
        } else {
            // 串行执行
            for (const target of targets) {
                if (batchExecutionState.shouldStop) break;
                
                const result = await executeTarget(target, commands, executionOptions, batchExecutionState, context);
                results.push(result);
                
                if (stopOnError && result.status === 'failed') {
                    break;
                }
            }
        }
        
        batchExecutionState.running = false;
        
        // 保存配置备份
        if (saveBackup) {
            try {
                const backupDir = getBackupDir();
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                for (const result of results) {
                    if (result.status === 'success' && result.output) {
                        const backupFileName = `${result.name || result.host}_${timestamp}.txt`;
                        const cleanedOutput = cleanBackupOutput(result.output);
                        fs.writeFileSync(
                            path.join(backupDir, backupFileName),
                            cleanedOutput,
                            'utf-8'
                        );
                    }
                }
                console.log(`[Backup] 已保存 ${results.filter(r => r.status === 'success').length} 个配置备份`);
            } catch (e) {
                console.error('保存配置备份失败:', e);
            }
        }
        
        return { 
            success: true, 
            results,
            summary: {
                total: results.length,
                success: results.filter(r => r.status === 'success').length,
                failed: results.filter(r => r.status === 'failed').length
            }
        };
    });

    // 暂停/恢复批量执行
    ipcMain.handle('batch:pause', (event, pause) => {
        batchExecutionState.paused = pause;
        return { success: true };
    });

    // 停止批量执行
    ipcMain.handle('batch:stop', () => {
        batchExecutionState.shouldStop = true;
        return { success: true };
    });
}

module.exports = {
    registerBatchHandlers
};
