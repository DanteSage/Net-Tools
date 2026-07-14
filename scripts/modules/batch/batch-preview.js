/**
 * 批量执行预览确认
 * @module batch/preview
 */

// ==================== 辅助函数 ====================

/**
 * 获取预览设备图标
 */
function getPreviewDeviceIcon(type) {
    const icons = {
        h3c: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        huawei: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        cisco: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        ruijie: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        juniper: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        linux: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>',
        default: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>'
    };
    return icons[type] || icons.default;
}

// ==================== 执行预览 ====================

/**
 * 显示执行预览确认
 */
function showExecutionPreview(data) {
    return new Promise((resolve) => {
        const { targets, commands, commandGroups, expansionInfo, options } = data;
        
        let modal = document.getElementById('execution-preview-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'execution-preview-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content preview-modal-v2">
                    <div class="preview-header-v2">
                        <div class="preview-title-area">
                            <div class="preview-icon">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                </svg>
                            </div>
                            <div>
                                <h3>执行预览</h3>
                                <p class="preview-subtitle">请确认以下执行信息</p>
                            </div>
                        </div>
                        <button class="btn btn-icon modal-close" id="preview-modal-close">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="preview-body-v2" id="preview-modal-body"></div>
                    <div class="preview-footer-v2">
                        <button class="btn btn-secondary" id="btn-preview-cancel">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                            取消
                        </button>
                        <button class="btn btn-success btn-execute-confirm" id="btn-preview-confirm">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            确认执行
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        const body = document.getElementById('preview-modal-body');
        
        const maxTargetsShow = 12;
        const maxCmdsPerGroup = 8;
        const iterations = expansionInfo.iterations || 1;
        const maxGroupsShow = iterations >= 10 ? 10 : iterations;
        const needDownload = iterations >= 10 || commands.length > 30;
        
        batchState.previewData = { targets, commands, commandGroups, expansionInfo, options };
        
        // 统计卡片数据
        const totalOps = targets.length * commands.length;
        const estimatedTime = Math.ceil(totalOps * (options.cmdDelay || 500) / 1000 / 60);
        
        // 未定义变量警告
        let warningHtml = '';
        if (expansionInfo.undefinedVars && expansionInfo.undefinedVars.length > 0) {
            warningHtml = `
                <div class="preview-warning-v2">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                    </svg>
                    <div>
                        <strong>未定义变量</strong>
                        <span>${expansionInfo.undefinedVars.join(', ')}</span>
                    </div>
                </div>
            `;
        }
        
        // 统计卡片
        const statsHtml = `
            <div class="preview-stats-grid">
                <div class="preview-stat-card">
                    <div class="stat-icon devices">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>
                        </svg>
                    </div>
                    <div class="stat-content">
                        <span class="stat-number">${targets.length}</span>
                        <span class="stat-label">目标设备</span>
                    </div>
                </div>
                <div class="preview-stat-card">
                    <div class="stat-icon commands">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                        </svg>
                    </div>
                    <div class="stat-content">
                        <span class="stat-number">${commands.length}</span>
                        <span class="stat-label">执行命令</span>
                    </div>
                </div>
                <div class="preview-stat-card">
                    <div class="stat-icon operations">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                        </svg>
                    </div>
                    <div class="stat-content">
                        <span class="stat-number">${totalOps}</span>
                        <span class="stat-label">总操作数</span>
                    </div>
                </div>
                <div class="preview-stat-card">
                    <div class="stat-icon time">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                        </svg>
                    </div>
                    <div class="stat-content">
                        <span class="stat-number">~${estimatedTime < 1 ? '<1' : estimatedTime}</span>
                        <span class="stat-label">预计分钟</span>
                    </div>
                </div>
            </div>
        `;
        
        // 目标设备列表
        const targetsList = targets.slice(0, maxTargetsShow).map(t => {
            const typeIcon = getPreviewDeviceIcon(t.type);
            const protocol = t.protocol === 'telnet' ? 'Telnet' : 'SSH';
            return `
                <div class="preview-target-item">
                    <div class="target-icon">${typeIcon}</div>
                    <div class="target-info">
                        <span class="target-name">${escapeHtml(t.name || t.host)}</span>
                        <span class="target-meta">${escapeHtml(t.host)} · ${protocol}</span>
                    </div>
                </div>
            `;
        }).join('');
        const moreTargets = targets.length > maxTargetsShow ? 
            `<div class="preview-more-hint">还有 ${targets.length - maxTargetsShow} 台设备...</div>` : '';
        
        // 命令预览
        let commandsHtml = '';
        if (expansionInfo.hasDefinedVars && iterations > 1) {
            const showGroups = Math.min(commandGroups.length, maxGroupsShow);
            commandsHtml = commandGroups.slice(0, showGroups).map((group, i) => `
                <div class="preview-cmd-group-v2">
                    <div class="cmd-group-header">
                        <span class="cmd-group-badge">迭代 ${i + 1}</span>
                        <span class="cmd-group-count">${group.length} 条命令</span>
                    </div>
                    <div class="cmd-group-body">
                        ${group.slice(0, maxCmdsPerGroup).map((cmd, j) => `
                            <div class="preview-cmd-line">
                                <span class="cmd-line-num">${j + 1}</span>
                                <code class="cmd-line-text">${escapeHtml(cmd)}</code>
                            </div>
                        `).join('')}
                        ${group.length > maxCmdsPerGroup ? `<div class="cmd-more-hint">... 还有 ${group.length - maxCmdsPerGroup} 条</div>` : ''}
                    </div>
                </div>
            `).join('');
            if (iterations > showGroups) {
                commandsHtml += `<div class="preview-iterations-more">还有 ${iterations - showGroups} 次迭代未显示</div>`;
            }
        } else {
            const showCmds = Math.min(commands.length, maxCmdsPerGroup * 2);
            commandsHtml = `
                <div class="preview-cmd-list-v2">
                    ${commands.slice(0, showCmds).map((cmd, i) => `
                        <div class="preview-cmd-line">
                            <span class="cmd-line-num">${i + 1}</span>
                            <code class="cmd-line-text">${escapeHtml(cmd)}</code>
                        </div>
                    `).join('')}
                    ${commands.length > showCmds ? `<div class="cmd-more-hint">... 还有 ${commands.length - showCmds} 条命令</div>` : ''}
                </div>
            `;
        }
        
        // 执行选项标签
        const optionTags = [];
        if (options.parallel) optionTags.push({ icon: '⚡', text: `并发 ${options.parallelCount}`, type: 'primary' });
        if (options.timeout) optionTags.push({ icon: '⏱', text: `超时 ${options.timeout / 1000}s`, type: 'default' });
        if (options.cmdDelay) optionTags.push({ icon: '⏸', text: `间隔 ${options.cmdDelay}ms`, type: 'default' });
        if (options.retryCount) optionTags.push({ icon: '🔄', text: `重试 ${options.retryCount}次`, type: 'default' });
        if (options.stopOnError) optionTags.push({ icon: '🛑', text: '失败停止', type: 'warning' });
        
        const optionsHtml = optionTags.length > 0 ? optionTags.map(tag => 
            `<span class="preview-option-tag ${tag.type}">${tag.icon} ${tag.text}</span>`
        ).join('') : '<span class="preview-option-tag default">默认配置</span>';
        
        // 下载按钮
        const downloadBtnHtml = needDownload ? `
            <button class="btn btn-sm btn-ghost" id="btn-download-preview">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                下载完整预览
            </button>
        ` : '';
        
        body.innerHTML = `
            ${warningHtml}
            ${statsHtml}
            
            <div class="preview-section-v2">
                <div class="section-header-v2">
                    <div class="section-title-v2">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>
                        </svg>
                        目标设备
                    </div>
                    <span class="section-badge">${targets.length} 台</span>
                </div>
                <div class="preview-targets-grid">${targetsList}${moreTargets}</div>
            </div>
            
            <div class="preview-section-v2">
                <div class="section-header-v2">
                    <div class="section-title-v2">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                        </svg>
                        执行命令
                    </div>
                    <div class="section-actions">
                        ${downloadBtnHtml}
                        <span class="section-badge">${commands.length} 条${expansionInfo.hasDefinedVars ? ` · ${iterations}次迭代` : ''}</span>
                    </div>
                </div>
                <div class="preview-commands-v2">${commandsHtml}</div>
            </div>
            
            <div class="preview-section-v2">
                <div class="section-header-v2">
                    <div class="section-title-v2">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                        </svg>
                        执行选项
                    </div>
                </div>
                <div class="preview-options-v2">${optionsHtml}</div>
            </div>
        `;
        
        modal.classList.add('active');
        
        const closeModal = (result) => {
            modal.classList.remove('active');
            resolve(result);
        };
        
        document.getElementById('preview-modal-close').onclick = () => closeModal(false);
        document.getElementById('btn-preview-cancel').onclick = () => closeModal(false);
        document.getElementById('btn-preview-confirm').onclick = () => closeModal(true);
        
        const downloadBtn = document.getElementById('btn-download-preview');
        if (downloadBtn) {
            downloadBtn.onclick = () => downloadFullPreview();
        }
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// ==================== 下载预览 ====================

/**
 * 下载完整预览
 */
function downloadFullPreview() {
    const data = batchState.previewData;
    if (!data) {
        showToast('预览数据不存在', 'error');
        return;
    }
    
    const { targets, commands, commandGroups, expansionInfo, options } = data;
    
    let content = '========== 批量执行预览 ==========\n';
    content += `生成时间: ${new Date().toLocaleString()}\n\n`;
    
    content += `========== 目标设备 (${targets.length} 台) ==========\n`;
    targets.forEach((t, i) => {
        content += `${i + 1}. ${t.name || t.host} (${t.host}:${t.port}) [${t.type}]\n`;
    });
    content += '\n';
    
    content += `========== 执行命令 (${commands.length} 条) ==========\n`;
    if (expansionInfo.hasDefinedVars) {
        content += `变量迭代: ${expansionInfo.iterations} 次\n\n`;
        commandGroups.forEach((group, i) => {
            content += `--- 第 ${i + 1} 次迭代 ---\n`;
            group.forEach(cmd => {
                content += `  ${cmd}\n`;
            });
            content += '\n';
        });
    } else {
        commands.forEach((cmd, i) => {
            content += `${i + 1}. ${cmd}\n`;
        });
    }
    content += '\n';
    
    content += '========== 执行选项 ==========\n';
    content += `并行执行: ${options.parallel ? '是' : '否'}\n`;
    if (options.parallel) content += `  并发数: ${options.parallelCount}\n`;
    if (options.timeout) content += `命令超时: ${options.timeout / 1000} 秒\n`;
    if (options.cmdDelay) content += `命令间隔: ${options.cmdDelay} 毫秒\n`;
    if (options.retryCount) content += `失败重试: ${options.retryCount} 次\n`;
    content += `失败停止: ${options.stopOnError ? '是' : '否'}\n`;
    content += '\n';
    
    content += '========== 执行统计 ==========\n';
    content += `目标设备: ${targets.length} 台\n`;
    content += `命令总数: ${commands.length} 条\n`;
    content += `总操作数: ${targets.length * commands.length} 次\n`;
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-preview-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('预览已下载', 'success');
}
