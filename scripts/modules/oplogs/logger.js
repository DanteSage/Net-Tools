/**
 * 操作日志模块 - 日志记录核心
 * @module oplogs/logger
 */

// ==================== 日志记录 ====================

/**
 * 切换日志记录状态
 */
async function toggleLogging() {
    const session = getActiveSession();
    if (!session) {
        showToast('请先连接一个设备', 'warning');
        return;
    }
    
    if (!session.connected) {
        showToast('当前会话未连接', 'warning');
        return;
    }
    
    if (session.logging) {
        await stopLogging(session);
    } else {
        startLogging(session);
    }
    
    updateLoggingButton();
}

/**
 * 开始记录日志
 */
function startLogging(session) {
    session.logging = true;
    session.logData = createOplog(session);
    const connTypeLabel = session.connectionType === 'serial' ? '串口' : 
                          (session.connectionType === 'telnet' ? 'Telnet' : 'SSH');
    session.logData.content = `=== 操作记录开始 ===\n时间: ${new Date().toLocaleString()}\n设备: ${session.deviceName}\n连接类型: ${connTypeLabel}\n${'='.repeat(40)}\n\n`;
    showToast('开始记录操作日志', 'success');
}

/**
 * 停止记录日志
 */
async function stopLogging(session) {
    if (!session.logData) return;
    
    session.logging = false;
    session.logData.endTime = new Date().toISOString();
    session.logData.content += `\n${'='.repeat(40)}\n=== 操作记录结束 ===\n时间: ${new Date().toLocaleString()}\n`;
    
    // 保存前清理日志内容
    session.logData.content = cleanLogContent(session.logData.content);
    
    const result = await window.api.oplog.save(session.logData);
    if (result.success) {
        showToast('操作日志已保存', 'success');
    } else {
        showToast('保存日志失败: ' + result.error, 'error');
    }
    
    session.logData = null;
}

/**
 * 更新日志记录按钮状态
 */
function updateLoggingButton() {
    const btn = document.getElementById('btn-toggle-logging');
    const statusSpan = document.getElementById('logging-status');
    const session = getActiveSession();
    
    if (session && session.logging) {
        btn.classList.add('recording');
        statusSpan.innerHTML = '<span class="recording-indicator"></span>记录中';
    } else {
        btn.classList.remove('recording');
        statusSpan.textContent = '记录日志';
    }
}

/**
 * 向日志追加数据
 */
function appendToLog(session, text) {
    if (session && session.logging && session.logData) {
        let cleanText = text
            // 移除 ANSI 转义序列
            .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
            // 移除其他 ANSI/VT100 控制序列
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[PX^_].*?\x1b\\/g, '')
            .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
            // 移除控制字符 (保留换行符、回车符和制表符)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // 移除设备分页提示符
            .replace(/\s*-+\s*More\s*-+\s*/gi, '')
            .replace(/\s*--More--\s*/g, '')
            .replace(/\s*<--- More --->\s*/g, '')
            // 移除华为分页提示
            .replace(/\s*---- More ----\s*/g, '')
            // 统一换行符处理
            .replace(/\r\n/g, '\n')      // Windows 换行 -> \n
            .replace(/\r/g, '\n');        // 单独的 \r 也转为 \n（某些设备只用 \r）
        
        session.logData.content += cleanText;
    }
}

/**
 * 清理最终日志内容 (保存前调用)
 */
function cleanLogContent(content) {
    return content
        // 移除行尾空格
        .replace(/[ \t]+$/gm, '')
        // 移除空白行（只包含空格或制表符的行）
        .replace(/^[ \t]*$/gm, '')
        // 移除连续空行（只保留一个）
        .replace(/\n{2,}/g, '\n')
        // 移除开头的空行
        .replace(/^\n+/, '')
        // 确保结尾只有一个换行
        .replace(/\n*$/, '\n');
}
