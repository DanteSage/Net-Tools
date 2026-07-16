/**
 * AI 网络助手 (Net Tools Copilot) 前端控制器
 */

// UI 状态
let copilotActiveSessionId = null;
let copilotMessages = [];
let copilotStreaming = false;
let currentRequestId = null;

// AI 多会话状态
let copilotChatSessions = [];
let copilotActiveChatSessionId = null;

// AI 当前交互轮次的执行步骤统计
let currentTurnCommandCount = 0;
let currentTurnQueryCount = 0;
let currentTurnWriteCount = 0;
let currentTurnCommands = [];

// DOM 元素引用
const copilotDom = {
    sessionList: null,
    statusDot: null,
    modelDisplay: null,
    clearChatBtn: null,
    chatHistory: null,
    welcomePane: null,
    input: null,
    sendBtn: null,
    charCount: null,
    
    // 多会话与停止按钮相关 DOM
    tabChats: null,
    tabDevices: null,
    panelChats: null,
    panelDevices: null,
    chatList: null,
    newChatBtn: null,
    activeDeviceBadge: null,
    activeDeviceName: null
};

// 缓存 API 配置状态
let copilotConfigured = false;

/**
 * 初始化 Copilot
 */
function initCopilot() {
    // 获取 DOM 引用
    copilotDom.sessionList = document.getElementById('copilot-session-list');
    copilotDom.statusDot = document.getElementById('copilot-status-dot');
    copilotDom.modelDisplay = document.getElementById('copilot-model-display');
    copilotDom.clearChatBtn = document.getElementById('btn-clear-chat');
    copilotDom.chatHistory = document.getElementById('copilot-chat-history');
    copilotDom.welcomePane = document.getElementById('copilot-welcome-pane');
    copilotDom.input = document.getElementById('copilot-input');
    copilotDom.sendBtn = document.getElementById('btn-copilot-send');
    copilotDom.charCount = document.getElementById('copilot-char-count');

    // 绑定事件
    if (copilotDom.clearChatBtn) {
        copilotDom.clearChatBtn.addEventListener('click', clearCopilotChat);
    }

    if (copilotDom.input) {
        // 自动调整高度
        copilotDom.input.addEventListener('input', () => {
            copilotDom.input.style.height = 'auto';
            copilotDom.input.style.height = Math.min(copilotDom.input.scrollHeight, 120) + 'px';
            
            // 字符数
            const len = copilotDom.input.value.length;
            if (copilotDom.charCount) {
                copilotDom.charCount.textContent = `${len}/2000`;
            }
        });

        // 快捷键发送
        copilotDom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.ctrlKey) {
                    e.preventDefault();
                    sendCopilotMessage();
                }
            }
        });
    }

    if (copilotDom.sendBtn) {
        copilotDom.sendBtn.addEventListener('click', sendCopilotMessage);
    }

    // 绑定建议卡片点击
    document.querySelectorAll('.copilot-suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            if (prompt && copilotDom.input) {
                copilotDom.input.value = prompt;
                copilotDom.input.dispatchEvent(new Event('input'));
                copilotDom.input.focus();
            }
        });
    });

    // 绑定提示词模板点击
    document.querySelectorAll('.template-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const templateType = chip.dataset.template;
            const selectedSession = getSelectedCopilotSession();
            const vendorText = selectedSession ? `${selectedSession.deviceType || '未知厂商'}` : '华为/思科等';
            
            let prompt = '';
            switch (templateType) {
                case 'decision-tree':
                    prompt = `请针对以下网络故障场景，为我绘制一个详细的【故障诊断决策树】排障流程图（推荐使用 Markdown 文本树或类似流程图形式输出），并提供每一步具体的排障命令和验证标准：\n\n1. 故障现象：[请在此替换具体故障，例如：OSPF 邻居卡在 EXSTART 状态]\n2. 设备厂商/类型：${vendorText}\n3. 排查前提条件：已获取控制台登录权限`;
                    break;
                case 'config-gen':
                    prompt = `请帮我编写并生成网络设备的标准配置脚本，并包含必要的命令解释与验证方法：\n\n1. 业务需求：[例如：配置双核心交换机链路聚合、划分 VLAN 并配置 Trunk 接口]\n2. 设备厂商/类型：${vendorText}\n3. 约束条件：[例如：聚合口使用 LACP 模式，聚合组 ID 为 1，允许 VLAN 10, 20 通行]`;
                    break;
                case 'translate':
                    prompt = `请帮我将以下配置命令翻译/转译到其他厂商的对应 CLI 语法，并说明主要技术参数差异：\n\n1. 原始配置与厂商：[例如：华为 VRP 配置静态默认路由]\n   \`\`\`\n   ip route-static 0.0.0.0 0.0.0.0 192.168.1.254\n   \`\`\`\n2. 目标厂商/系统：[例如：思科 IOS / 华三 Comware]`;
                    break;
                case 'analyze':
                    prompt = `我将为你提供一段网络设备命令的回显内容或日志信息，请帮我详细分析其中的潜在风险、异常状态并提供相应的修复或调优配置建议：\n\n1. 设备厂商/类型：${vendorText}\n2. 待诊断状态数据：\n   \`\`\`\n   [请在此粘贴您的 show/display 命令行回显或 syslog 报错日志]\n   \`\`\``;
                    break;
            }
            
            if (prompt && copilotDom.input) {
                copilotDom.input.value = prompt;
                copilotDom.input.dispatchEvent(new Event('input'));
                
                // 聚焦并移动光标到具体填写位置
                copilotDom.input.focus();
                
                // 自动选择具体修改位置的文本，方便用户输入
                let selectStart = -1;
                let selectEnd = -1;
                if (templateType === 'decision-tree') {
                    selectStart = prompt.indexOf('[请在此替换具体故障');
                    selectEnd = selectStart + '[请在此替换具体故障，例如：OSPF 邻居卡在 EXSTART 状态]'.length;
                } else if (templateType === 'config-gen') {
                    selectStart = prompt.indexOf('[例如：配置双核心交换机链路聚合');
                    selectEnd = selectStart + '[例如：配置双核心交换机链路聚合、划分 VLAN 并配置 Trunk 接口]'.length;
                } else if (templateType === 'translate') {
                    selectStart = prompt.indexOf('[例如：华为 VRP 配置静态默认路由]');
                    selectEnd = selectStart + '[例如：华为 VRP 配置静态默认路由]'.length;
                } else if (templateType === 'analyze') {
                    selectStart = prompt.indexOf('[请在此粘贴您的 show/display');
                    selectEnd = selectStart + '[请在此粘贴您的 show/display 命令行回显或 syslog 报错日志]'.length;
                }
                
                if (selectStart !== -1) {
                    copilotDom.input.setSelectionRange(selectStart, selectEnd);
                }
            }
        });
    });

    // 绑定 IPC 监听器
    window.api.copilot.onChunk((chunk) => {
        appendStreamingChunk(chunk);
    });

    window.api.copilot.onEnd((updatedMessages) => {
        finishStreaming(updatedMessages);
    });

    window.api.copilot.onError((err) => {
        handleStreamingError(err);
    });

    window.api.copilot.onGeneratingReport(() => {
        if (!currentAssistantBubbleId) return;
        const bubbleEl = document.getElementById(currentAssistantBubbleId);
        if (bubbleEl) {
            let statusText = '';
            if (currentTurnCommandCount > 0) {
                // 先提取每个指令的前两个单词作为分类标识 (Stem)
                const stems = currentTurnCommands.map(c => {
                    const parts = c.trim().split(/\s+/);
                    return `${parts[0]} ${parts[1] || ''}`.trim();
                });
                // 对 Stem 进行去重，防止输出重复的分类（如 "display interface 和 display interface"）
                const uniqueStems = [...new Set(stems)];
                // 取最多前两个独特的 Stem 用于展示
                const displayCmds = uniqueStems.slice(0, 2).map(c => `\`${c}\``);
                const cmdSummary = displayCmds.join(' 和 ');
                
                if (currentTurnWriteCount > 0 && currentTurnQueryCount > 0) {
                    statusText = `已成功执行 ${currentTurnQueryCount} 条诊断与 ${currentTurnWriteCount} 条配置指令，正在深度分析回显结果并编制诊断变更报告`;
                } else if (currentTurnWriteCount > 0) {
                    statusText = `已成功下发并执行 ${currentTurnWriteCount} 条配置变更指令，正在确认设备状态并编制配置报告`;
                } else {
                    const suffix = currentTurnCommandCount > 1 ? '等回显结果' : '的回显结果';
                    statusText = `已成功执行 ${currentTurnQueryCount} 条诊断查询指令，正在分析 ${cmdSummary} ${suffix}并编制诊断报告`;
                }
            } else {
                statusText = '已完成指令执行，正在分析回显数据并整理建议';
            }
            currentAssistantText = '[status]' + statusText;
            bubbleEl.innerHTML = markdownToHtml(currentAssistantText, getSelectedCopilotSession());
            scrollChatToBottom();
        }
    });

    // 绑定卡片上的按钮事件（由于卡片是动态生成的，采用事件代理）
    if (copilotDom.chatHistory) {
        copilotDom.chatHistory.addEventListener('click', async (e) => {
            const copyBtn = e.target.closest('.copilot-btn-copy');
            const execBtn = e.target.closest('.copilot-btn-execute');

            if (copyBtn) {
                const card = copyBtn.closest('.copilot-cmd-card');
                const code = card.querySelector('.copilot-cmd-body code').innerText;
                try {
                    await navigator.clipboard.writeText(code);
                    showToast('已复制到剪贴板', 'success');
                } catch (_) {
                    showToast('复制失败', 'error');
                }
            }

            if (execBtn) {
                const card = execBtn.closest('.copilot-cmd-card');
                const code = card.querySelector('.copilot-cmd-body code').innerText;
                executeCommandOnSession(code);
            }
        });
    }

    // 初始化多会话与停止按钮相关的 DOM 引用
    copilotDom.tabChats = document.getElementById('tab-copilot-chats');
    copilotDom.tabDevices = document.getElementById('tab-copilot-devices');
    copilotDom.panelChats = document.getElementById('copilot-panel-chats');
    copilotDom.panelDevices = document.getElementById('copilot-panel-devices');
    copilotDom.chatList = document.getElementById('copilot-chat-list');
    copilotDom.newChatBtn = document.getElementById('btn-copilot-new-chat');
    copilotDom.activeDeviceBadge = document.getElementById('copilot-active-device-badge');
    copilotDom.activeDeviceName = document.getElementById('copilot-active-device-name');

    // 绑定 Tab 切换事件
    if (copilotDom.tabChats && copilotDom.tabDevices) {
        copilotDom.tabChats.addEventListener('click', () => {
            copilotDom.tabChats.classList.add('active');
            copilotDom.tabDevices.classList.remove('active');
            copilotDom.panelChats.classList.add('active');
            copilotDom.panelDevices.classList.remove('active');
            copilotDom.panelDevices.style.display = 'none';
        });

        copilotDom.tabDevices.addEventListener('click', () => {
            copilotDom.tabDevices.classList.add('active');
            copilotDom.tabChats.classList.remove('active');
            copilotDom.panelDevices.classList.add('active');
            copilotDom.panelDevices.style.display = 'flex';
            copilotDom.panelChats.classList.remove('active');
        });
    }

    if (copilotDom.newChatBtn) {
        copilotDom.newChatBtn.addEventListener('click', async () => {
            if (copilotStreaming) {
                const confirmed = await showConfirm({
                    title: '确认新建对话',
                    message: '当前对话正在生成中，新建对话将中止生成。确定要继续吗？',
                    confirmText: '确定新建',
                    type: 'warning'
                });
                if (!confirmed) return;
                abortStreaming();
            }
            createNewChatSession();
        });
    }

    // 加载会话历史
    loadChatSessions();

    // ==================== 智能排障与指令审批模态框绑定 ====================
    const approvalModal = document.getElementById('copilot-approval-modal');
    const closeApprovalBtn = document.getElementById('copilot-approval-modal-close');
    const rejectBtn = document.getElementById('btn-reject-approval');
    const confirmBtn = document.getElementById('btn-confirm-approval');

    const handleApprovalClose = async (approved) => {
        if (approvalModal) approvalModal.classList.remove('active');
        const requestId = currentRequestId;
        currentRequestId = null;
        if (!requestId) return;

        try {
            const response = await window.api.copilot.approveResponse(requestId, approved);
            if (approved && !response?.success) {
                showToast(response?.error || '审批请求已失效，命令未执行', 'warning');
            }
        } catch (_) {
            if (approved) {
                showToast('审批提交失败，命令未执行', 'error');
            }
        }
    };

    if (closeApprovalBtn) {
        closeApprovalBtn.addEventListener('click', () => handleApprovalClose(false));
    }
    if (rejectBtn) {
        rejectBtn.addEventListener('click', () => handleApprovalClose(false));
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => handleApprovalClose(true));
    }

    // 监听主进程的审批请求
    window.api.copilot.onApproveRequest(({ requestId, connectionId, command }) => {
        currentRequestId = requestId;
        
        let deviceName = '当前终端';
        if (typeof state !== 'undefined' && state.sessions) {
            for (const session of state.sessions.values()) {
                if (session.connectionId === connectionId) {
                    deviceName = `${session.deviceName} (${session.deviceType})`;
                    break;
                }
            }
        }
        
        const deviceEl = document.getElementById('approval-device-name');
        const cmdTextEl = document.getElementById('approval-command-text');
        
        if (deviceEl) deviceEl.textContent = deviceName;
        if (cmdTextEl) cmdTextEl.textContent = command;
        
        if (approvalModal) {
            approvalModal.classList.add('active');
        }
    });

    if (typeof window.api.copilot.onApprovalExpired === 'function') {
        window.api.copilot.onApprovalExpired(({ requestId, reason }) => {
            if (!requestId || currentRequestId !== requestId) return;

            currentRequestId = null;
            if (approvalModal) approvalModal.classList.remove('active');
            if (reason === 'timeout') {
                showToast('指令审批已超时，命令未执行', 'warning');
            }
        });
    }

    // 监听 Agent 执行状态并展示到聊天气泡中
    window.api.copilot.onAgentStep((step) => {
        if (!copilotDom.chatHistory) return;

        if (step.status === 'executing') {
            // 累计当前轮次的命令
            currentTurnCommandCount++;
            currentTurnCommands.push(step.command);
            if (step.isWrite) {
                currentTurnWriteCount++;
            } else {
                currentTurnQueryCount++;
            }

            // 设置当前选中的终端 session 为已被 AI 接管的状态，并打印黄色警告
            const selectedSession = getSelectedCopilotSession();
            if (selectedSession && !selectedSession.aiTakeover) {
                selectedSession.aiTakeover = true;
                if (selectedSession.terminal) {
                    selectedSession.terminal.write('\r\n\x1b[33m--- [⚠️ 当前终端已被 AI 智能助手接管进行诊断配置，请勿输入指令] ---\x1b[0m\r\n');
                }
                // 同步添加终端区域的蓝色光晕
                if (typeof getActiveSession === 'function' && getActiveSession()?.id === selectedSession.id) {
                    const termContainer = document.getElementById('terminal-container');
                    if (termContainer) {
                        termContainer.classList.add('ai-takeover-active');
                    }
                }
            }

            // 隐藏思考占位
            const thinkingBubble = document.getElementById(currentAssistantBubbleId);
            if (thinkingBubble && currentAssistantText === '正在思考中...') {
                thinkingBubble.innerHTML = '';
                currentAssistantText = '';
            }

            const stepDiv = document.createElement('div');
            stepDiv.className = 'copilot-agent-step-log';
            stepDiv.id = `step-log-${step.id || step.command.replace(/[^a-zA-Z0-9]/g, '-')}`;
            
            const logIcon = step.isWrite ? '⚙️' : '🔍';
            const logType = step.isWrite ? '配置变更' : '诊断查询';
            
            stepDiv.innerHTML = `
                <div style="font-size: 12.5px; color: var(--accent-color, #3b82f6); margin: 0; padding: 4px 12px; background: rgba(59, 130, 246, 0.08); border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
                    <span>${logIcon} <b>${logType}</b>：<code>${escapeHtml(step.command)}</code></span>
                    <span class="step-status-spinner" style="font-size: 11.5px; opacity: 0.8;">等待回显...</span>
                </div>
            `;
            copilotDom.chatHistory.appendChild(stepDiv);
            scrollChatToBottom();
        } else if (step.status === 'completed') {
            const stepDiv = document.getElementById(`step-log-${step.id || step.command.replace(/[^a-zA-Z0-9]/g, '-')}`);
            if (stepDiv) {
                const statusEl = stepDiv.querySelector('.step-status-spinner');
                const container = stepDiv.querySelector('div');
                
                if (step.success === false) {
                    if (statusEl) {
                        if (step.errorType === 'rejected') {
                            statusEl.textContent = '已拒绝';
                            statusEl.style.color = 'var(--warning-color, #f59e0b)';
                        } else {
                            statusEl.textContent = '执行失败';
                            statusEl.style.color = 'var(--danger-color, #ef4444)';
                        }
                    }
                    if (container) {
                        if (step.errorType === 'rejected') {
                            container.style.backgroundColor = 'rgba(245, 158, 11, 0.06)';
                        } else {
                            container.style.backgroundColor = 'rgba(239, 68, 68, 0.06)';
                        }
                    }
                } else {
                    if (statusEl) {
                        statusEl.textContent = '执行成功';
                        statusEl.style.color = 'var(--success-color, #10b981)';
                    }
                    if (container) {
                        container.style.backgroundColor = 'rgba(16, 185, 129, 0.06)';
                    }
                }
            }
        }
    });
}

/**
 * 刷新页面状态 (从导航触发)
 */
async function refreshCopilotPage() {
    // 检查配置状态
    await checkCopilotConfig();
    
    // 更新活动会话
    updateSidebarSessions();
}

/**
 * 检查 API Key 配置状态
 */
async function checkCopilotConfig() {
    try {
        const status = await window.api.copilot.getConfigStatus();
        copilotConfigured = status.configured;
        
        if (copilotDom.statusDot && copilotDom.modelDisplay) {
            if (status.configured) {
                copilotDom.statusDot.classList.add('active');
                copilotDom.modelDisplay.textContent = `已就绪: ${status.model || 'gpt-3.5-turbo'}`;
                
                // 移除任何已有的警告横幅
                const existingBanner = document.getElementById('copilot-warning-banner');
                if (existingBanner) existingBanner.remove();
            } else {
                copilotDom.statusDot.classList.remove('active');
                copilotDom.modelDisplay.textContent = 'API Key 未配置';
                showConfigWarning();
            }
        }
    } catch (e) {
        console.error('检查配置失败:', e);
    }
}

/**
 * 显示未配置 API 密钥的警告横幅
 */
function showConfigWarning() {
    if (document.getElementById('copilot-warning-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'copilot-warning-banner';
    banner.className = 'copilot-warning-banner';
    banner.innerHTML = `
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>⚠️ 未检测到 AI 密钥配置</span>
        </div>
        <div style="font-size: 12.5px; opacity: 0.85; margin-bottom: 12px; line-height: 1.5; text-align: center;">
            智能助手需要配置 API 密钥与模型。请前往“设置 -> 模型”或点击下方按钮进行配置。
        </div>
        <button class="btn btn-primary btn-sm" id="btn-go-settings-from-copilot" style="margin: 0 auto; display: block;">立即去配置</button>
    `;

    // 插入到消息历史头部或欢迎页中
    if (copilotDom.chatHistory) {
        copilotDom.chatHistory.insertBefore(banner, copilotDom.chatHistory.firstChild);
        
        document.getElementById('btn-go-settings-from-copilot')?.addEventListener('click', () => {
            const settingsNavItem = document.querySelector('.nav-item[data-page="settings"]');
            if (settingsNavItem) {
                settingsNavItem.click();
                // 立即切换目标设置分区
                if (typeof window.switchSettingsSection === 'function') {
                    window.switchSettingsSection('ai');
                }
                // 延迟 150ms 再次确认切换，防范任何可能的异步 DOM 状态覆盖
                setTimeout(() => {
                    if (typeof window.switchSettingsSection === 'function') {
                        window.switchSettingsSection('ai');
                    } else {
                        const modelSectionBtn = document.querySelector('.settings-nav-item[data-section="ai"]');
                        if (modelSectionBtn) {
                            modelSectionBtn.click();
                        }
                    }
                }, 150);
            }
        });
    }
}

/**
 * 更新侧边栏终端会话列表
 */
function updateSidebarSessions() {
    if (!copilotDom.sessionList) return;

    // 获取所有已连接的终端会话
    const connectedSessions = [];
    if (typeof state !== 'undefined' && state.sessions) {
        for (const session of state.sessions.values()) {
            if (session.connectionId) {
                connectedSessions.push(session);
            }
        }
    }

    if (connectedSessions.length === 0) {
        copilotDom.sessionList.innerHTML = '<div class="copilot-empty-sessions">暂无活动终端连接</div>';
        copilotActiveSessionId = null;
        updateCardsTargetState();
        return;
    }

    // 自动选择：如果未选过，或者所选会话已被关闭
    const stillExists = connectedSessions.some(s => s.id === copilotActiveSessionId);
    if (!stillExists) {
        // 优先选择当前活动终端 session
        if (state.activeSessionId && state.sessions.has(state.activeSessionId)) {
            copilotActiveSessionId = state.activeSessionId;
        } else {
            copilotActiveSessionId = connectedSessions[0].id;
        }
    }

    // 渲染列表
    copilotDom.sessionList.innerHTML = connectedSessions.map(session => {
        const activeClass = session.id === copilotActiveSessionId ? 'active' : '';
        const devType = session.deviceType || '未知厂商';
        const connType = session.connectionType || 'ssh';
        return `
            <div class="copilot-session-item ${activeClass}" data-session-id="${session.id}">
                <div class="copilot-session-info">
                    <span class="copilot-session-name" title="${escapeHtml(session.deviceName)}">${escapeHtml(session.deviceName)}</span>
                    <div class="copilot-session-meta">
                        <span class="copilot-device-badge">${devType}</span>
                        <span>${connType.toUpperCase()}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // 绑定点击事件
    copilotDom.sessionList.querySelectorAll('.copilot-session-item').forEach(item => {
        item.addEventListener('click', () => {
            copilotActiveSessionId = item.dataset.sessionId;
            copilotDom.sessionList.querySelectorAll('.copilot-session-item').forEach(el => {
                el.classList.toggle('active', el.dataset.sessionId === copilotActiveSessionId);
            });
            // 当切换设备时，更新现有的命令卡片目标信息
            updateCardsTargetState();
        });
    });

    updateCardsTargetState();
}

/**
 * 更新现有消息卡片上的目标设备信息和按钮可用状态
 */
function updateCardsTargetState() {
    const selectedSession = getSelectedCopilotSession();
    
    // 更新顶部栏设备关联 Badge
    if (copilotDom.activeDeviceBadge && copilotDom.activeDeviceName) {
        if (selectedSession) {
            copilotDom.activeDeviceName.textContent = `${selectedSession.deviceName} (${selectedSession.deviceType})`;
            copilotDom.activeDeviceBadge.style.display = 'inline-flex';
        } else {
            copilotDom.activeDeviceBadge.style.display = 'none';
        }
    }

    // 获取所有卡片
    const cards = document.querySelectorAll('.copilot-cmd-card');
    cards.forEach(card => {
        const targetEl = card.querySelector('.copilot-cmd-target');
        const execBtn = card.querySelector('.copilot-btn-execute');
        
        if (selectedSession) {
            if (targetEl) targetEl.textContent = `目标设备: ${selectedSession.deviceName} (${selectedSession.deviceType})`;
            if (execBtn) {
                execBtn.removeAttribute('disabled');
                execBtn.textContent = '写入终端并执行';
            }
        } else {
            if (targetEl) targetEl.textContent = '未选中活动设备';
            if (execBtn) {
                execBtn.setAttribute('disabled', 'true');
                execBtn.textContent = '请先在左侧选择活动终端';
            }
        }
    });
}

/**
 * 获取当前选中的会话对象
 */
function getSelectedCopilotSession() {
    if (!copilotActiveSessionId || typeof state === 'undefined' || !state.sessions) return null;
    return state.sessions.get(copilotActiveSessionId) || null;
}

/**
 * 发送消息
 */
async function sendCopilotMessage() {
    if (copilotStreaming) {
        abortStreaming();
        return;
    }

    if (!copilotDom.input) return;

    const query = copilotDom.input.value.trim();
    if (!query) return;

    // 重置当前轮次的步骤与指令统计
    currentTurnCommandCount = 0;
    currentTurnQueryCount = 0;
    currentTurnWriteCount = 0;
    currentTurnCommands = [];

    // 清理输入框
    copilotDom.input.value = '';
    copilotDom.input.dispatchEvent(new Event('input'));

    // 检查配置
    if (!copilotConfigured) {
        showToast('请先配置 API Key', 'warning');
        return;
    }

    // 隐藏欢迎面板
    if (copilotDom.welcomePane) {
        copilotDom.welcomePane.style.display = 'none';
    }

    // 添加用户消息
    appendUserBubble(query);

    // 构建上下文
    const selectedSession = getSelectedCopilotSession();
    let systemPrompt = '你是一个资深网络专家，专注于为用户提供网络配置脚本的编写与排错建议。如果需要生成网络设备的配置或排错命令，务必放入 Markdown 代码块中，并指定语言为对应设备的品牌类型（例如 \`\`\`h3c\`\`\`、\`\`\`huawei\`\`\`、\`\`\`cisco\`\`\` 等），以便系统能够正确识别为对应的配置脚本。';
    if (selectedSession) {
        const devType = (selectedSession.deviceType || 'config').toLowerCase();
        systemPrompt = `你是一个资深网络专家，专注于为用户提供网络配置脚本的编写与排错建议。\n当前正在操作的目标设备为：\n- 设备名称: ${selectedSession.deviceName}\n- 厂商/设备类型: ${devType}\n- 连接协议: ${selectedSession.connectionType}\n请默认使用适合该设备的 CLI 指令语法进行配置输出。如果需要生成配置命令，务必放入 Markdown 代码块中，并将代码块语言指定为该设备的厂商类型，即 \`\`\`${devType}\`\`\`，以便系统能够正确识别为对应的配置脚本。`;
    }

    copilotMessages.push({ role: 'user', content: query });

    // 自动根据首条提问重命名会话标题
    const activeSession = copilotChatSessions.find(s => s.id === copilotActiveChatSessionId);
    if (activeSession && activeSession.title === '新对话' && activeSession.messages.length === 1) {
        let title = query.substring(0, 15).trim();
        if (query.length > 15) title += '...';
        activeSession.title = title || '新对话';
        renderChatSessionsList();
    }
    saveChatSessions();

    // 显示 AI 正在输入的消息泡
    appendAssistantBubble('正在思考中...');
    copilotStreaming = true;
    setControlsDisabled(true);

    // 调用 IPC 发送请求
    window.api.copilot.chat({
        messages: copilotMessages,
        systemPrompt: systemPrompt,
        connectionId: selectedSession ? selectedSession.connectionId : null,
        deviceType: selectedSession ? selectedSession.deviceType : null
    });
}

/**
 * 禁用/启用输入与发送控件
 */
function setControlsDisabled(disabled) {
    if (copilotDom.input) copilotDom.input.disabled = disabled;
    if (disabled) {
        updateSendButtonState(true);
    } else {
        updateSendButtonState(false);
        if (copilotDom.sendBtn) copilotDom.sendBtn.disabled = false;
    }
}

/**
 * 添加用户消息气泡
 */
function appendUserBubble(text) {
    if (!copilotDom.chatHistory) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'copilot-message user';
    msgDiv.innerHTML = `
        <div class="copilot-avatar">U</div>
        <div class="copilot-bubble">${escapeHtml(text)}</div>
    `;
    copilotDom.chatHistory.appendChild(msgDiv);
    scrollChatToBottom();
}

/**
 * 添加 AI 消息气泡（空或带默认文字，供 streaming 追加）
 */
let currentAssistantBubbleId = null;
let currentAssistantText = '';

function appendAssistantBubble(initialText) {
    if (!copilotDom.chatHistory) return;

    // 清除上个流式 bubble id 的指向
    currentAssistantBubbleId = 'assistant-bubble-' + Date.now();
    currentAssistantText = initialText;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'copilot-message assistant';
    msgDiv.innerHTML = `
        <div class="copilot-avatar">AI</div>
        <div class="copilot-bubble" id="${currentAssistantBubbleId}">
            ${markdownToHtml(initialText, getSelectedCopilotSession())}
        </div>
    `;
    copilotDom.chatHistory.appendChild(msgDiv);
    scrollChatToBottom();
}

/**
 * 追加流式文本
 */
function appendStreamingChunk(chunk) {
    if (!currentAssistantBubbleId) return;

    if (currentAssistantText === '正在思考中...' || currentAssistantText === '正在生成报告中...' || currentAssistantText.startsWith('[status]')) {
        currentAssistantText = '';
    }

    currentAssistantText += chunk;
    const bubbleEl = document.getElementById(currentAssistantBubbleId);
    if (bubbleEl) {
        bubbleEl.innerHTML = markdownToHtml(currentAssistantText, getSelectedCopilotSession());
        scrollChatToBottom();
    }
}

/**
 * 结束流式传输
 */
function finishStreaming(updatedMessages) {
    copilotStreaming = false;
    setControlsDisabled(false);

    // 释放所有终端的 AI 接管状态
    releaseAllAiTakeovers(false);

    if (updatedMessages && Array.isArray(updatedMessages)) {
        copilotMessages = updatedMessages;
    } else if (currentAssistantText) {
        copilotMessages.push({ role: 'assistant', content: currentAssistantText });
    }

    // 同步到当前的会话中并保存
    const activeSession = copilotChatSessions.find(s => s.id === copilotActiveChatSessionId);
    if (activeSession) {
        activeSession.messages = [...copilotMessages];
    }
    saveChatSessions();

    currentAssistantBubbleId = null;
    currentAssistantText = '';
    if (copilotDom.input) copilotDom.input.focus();
}

/**
 * 发生错误时处理
 */
function handleStreamingError(err) {
    copilotStreaming = false;
    setControlsDisabled(false);

    // 释放所有终端的 AI 接管状态
    releaseAllAiTakeovers(true);

    const bubbleEl = document.getElementById(currentAssistantBubbleId);
    if (bubbleEl) {
        bubbleEl.innerHTML = `<span style="color: var(--danger-color, #ef4444);">❌ 出错：${escapeHtml(err)}</span>`;
    }

    currentAssistantBubbleId = null;
    currentAssistantText = '';
}

/**
 * 执行指令到远程终端
 */
async function executeCommandOnSession(code) {
    const session = getSelectedCopilotSession();
    if (!session) {
        showToast('未选择活动终端会话，无法写入指令', 'warning');
        return;
    }

    if (!session.connectionId) {
        showToast('所选会话未建立连接', 'warning');
        return;
    }

    try {
        // 调用全局 sendToSession 写入命令
        if (typeof sendToSession === 'function') {
            // 在命令末尾加上换行，确保执行
            await sendToSession(session, code + '\n');
            showToast(`已成功写入终端并执行 (${session.deviceName})`, 'success');
        } else {
            showToast('写入终端失败: 未检测到终端写入接口', 'error');
        }
    } catch (e) {
        showToast('执行时出错: ' + e.message, 'error');
    }
}

/**
 * 清除聊天对话
 */
function clearCopilotChat() {
    copilotMessages = [];
    
    // 清空当前激活会话的历史记录
    const activeSession = copilotChatSessions.find(s => s.id === copilotActiveChatSessionId);
    if (activeSession) {
        activeSession.messages = [];
        activeSession.title = '新对话';
        saveChatSessions();
        renderChatSessionsList();
    }

    if (copilotDom.chatHistory) {
        // 先保留欢迎面板，其余清空
        copilotDom.chatHistory.innerHTML = '';
        if (copilotDom.welcomePane) {
            copilotDom.welcomePane.style.display = 'flex';
            copilotDom.chatHistory.appendChild(copilotDom.welcomePane);
        }
    }
    // 重新检测配置
    checkCopilotConfig();
}

/**
 * 滚动聊天记录到底部
 */
function scrollChatToBottom() {
    if (copilotDom.chatHistory) {
        copilotDom.chatHistory.scrollTop = copilotDom.chatHistory.scrollHeight;
    }
}

/**
 * Markdown 转 HTML 解析器 (支持生成命令预览卡片)
 */
function markdownToHtml(text, selectedSession) {
    if (!text) return '';

    if (text === '正在思考中...') {
        return `正在思考中<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>`;
    }

    if (text === '正在生成报告中...') {
        return `正在分析数据，正在生成报告/文档<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>`;
    }

    if (text.startsWith('[status]')) {
        const statusContent = text.slice(8);
        return `<div class="copilot-status-message">
            <span>${parseInlineMarkdown(statusContent)}</span>
            <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>`;
    }

    if (text.startsWith('[status-aborted]')) {
        const statusContent = text.slice(16);
        return `<div class="copilot-status-message aborted" style="color: var(--text-secondary, #94a3b8); font-style: italic; display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--warning-color, #f59e0b)" style="flex-shrink: 0; display: inline-block;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>${parseInlineMarkdown(statusContent)}</span>
        </div>`;
    }

    const lines = text.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeContent = [];
    let codeLang = '';
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // 处理代码块
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                inCodeBlock = false;
                const joinedCode = codeContent.join('\n');
                const targetText = selectedSession ? `目标设备: ${selectedSession.deviceName} (${selectedSession.deviceType})` : '未选中活动设备';
                const hasSession = !!selectedSession;
                const escapedCode = escapeHtml(joinedCode);

                html += `
<div class="copilot-cmd-card">
    <div class="copilot-cmd-header">
        <span class="copilot-cmd-title">${(codeLang || 'config').toUpperCase()} 配置脚本</span>
        <span class="copilot-cmd-target">${targetText}</span>
    </div>
    <pre class="copilot-cmd-body"><code>${escapedCode}</code></pre>
    <div class="copilot-cmd-footer">
        <button class="copilot-btn-copy btn btn-secondary btn-sm" style="margin-right: 8px;">复制</button>
        <button class="copilot-btn-execute btn btn-primary btn-sm" ${hasSession ? '' : 'disabled'}>写入终端并执行</button>
    </div>
</div>`;
                codeContent = [];
                codeLang = '';
            } else {
                inCodeBlock = true;
                codeLang = line.trim().slice(3).trim();
            }
            continue;
        }

        if (inCodeBlock) {
            codeContent.push(line);
            continue;
        }

        // 处理无序列表
        const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
        if (listMatch) {
            if (!inList) {
                html += '<ul>';
                inList = true;
            }
            html += `<li>${parseInlineMarkdown(listMatch[1])}</li>`;
            continue;
        } else if (inList) {
            html += '</ul>';
            inList = false;
        }

        // 处理标题
        if (line.startsWith('### ')) {
            html += `<h3>${parseInlineMarkdown(line.slice(4))}</h3>`;
        } else if (line.startsWith('## ')) {
            html += `## ${parseInlineMarkdown(line.slice(3))} ##`; // 使用 h2
            html = html.replace(/## (.*) ##/g, '<h2>$1</h2>');
        } else if (line.startsWith('# ')) {
            html += `<h1>${parseInlineMarkdown(line.slice(2))}</h1>`;
        } else if (line.trim() === '') {
            html += '<p></p>';
        } else {
            html += `<p>${parseInlineMarkdown(line)}</p>`;
        }
    }

    if (inCodeBlock && codeContent.length > 0) {
        // 未闭合的代码块 (在流式接收中)
        const targetText = selectedSession ? `目标设备: ${selectedSession.deviceName} (${selectedSession.deviceType})` : '未选中活动设备';
        html += `
<div class="copilot-cmd-card">
    <div class="copilot-cmd-header">
        <span class="copilot-cmd-title">${(codeLang || 'config').toUpperCase()} 配置脚本 (生成中...)</span>
        <span class="copilot-cmd-target">${targetText}</span>
    </div>
    <pre class="copilot-cmd-body"><code>${escapeHtml(codeContent.join('\n'))}</code></pre>
</div>`;
    }

    if (inList) {
        html += '</ul>';
    }

    // 清理空段落
    html = html.replace(/<p><\/p>/g, '');

    return html;
}

/**
 * 行内 Markdown 解析
 */
function parseInlineMarkdown(text) {
    let html = escapeHtml(text);
    // 加粗
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
}

/**
 * 一键 AI 诊断终端回显内容
 * @param {string} content - 提取的终端文本内容 (选择的文本或最后的缓冲区)
 * @param {string} deviceName - 设备名称
 * @param {string} deviceType - 设备厂商/型号
 * @param {boolean} isSelection - 是否是用户选中的文本
 * @param {string} sessionId - 会话ID
 */
async function diagnoseTerminalContent(content, deviceName, deviceType, isSelection, sessionId) {
    // 1. 切换页面到 AI 助手 (aicopilot)
    const copilotNavItem = document.querySelector('.nav-item[data-page="aicopilot"]');
    if (copilotNavItem) {
        copilotNavItem.click();
    }
    
    // 2. 检查 AI 配置状态
    await checkCopilotConfig();
    
    // 3. 关联对应的会话为活动会话，并刷新侧边栏
    if (sessionId) {
        copilotActiveSessionId = sessionId;
        updateSidebarSessions();
    }
    
    // 4. 构建提示词
    const sourceDesc = isSelection ? '用户选中' : '最近 150 行';
    const prompt = `这是设备 ${deviceName} (${deviceType}) 的终端回显内容 (${sourceDesc})，请帮我分析诊断该设备状态、是否存在异常及对应的排错/配置建议：\n\n\`\`\`\n${content.trim()}\n\`\`\``;
    
    // 5. 填入输入框，刷新高度，并发送
    if (copilotDom.input) {
        copilotDom.input.value = prompt;
        // 自动调整高度
        copilotDom.input.style.height = 'auto';
        copilotDom.input.style.height = Math.min(copilotDom.input.scrollHeight, 120) + 'px';
        
        if (copilotDom.charCount) {
            copilotDom.charCount.textContent = `${prompt.length}/2000`;
        }
        
        if (!copilotConfigured) {
            showToast('AI 助手 API Key 未配置，请先在“设置 -> 高级设置”中配置 API 密钥', 'warning');
            return;
        }
        
        // 延迟确保 UI 状态已就绪，然后触发发送
        setTimeout(() => {
            sendCopilotMessage();
        }, 150);
    }
}

/**
 * 从 localStorage 加载会话历史
 */
function loadChatSessions() {
    try {
        const stored = localStorage.getItem('copilot_chat_sessions');
        if (stored) {
            copilotChatSessions = JSON.parse(stored);
        }
    } catch (e) {
        console.error('加载 AI 会话失败:', e);
    }
    
    if (!copilotChatSessions || copilotChatSessions.length === 0) {
        createNewChatSession();
    } else {
        // 选择第一个会话
        copilotActiveChatSessionId = copilotChatSessions[0].id;
        copilotMessages = copilotChatSessions[0].messages;
        renderChatHistory();
    }
    renderChatSessionsList();
}

/**
 * 保存会话历史到 localStorage
 */
function saveChatSessions() {
    try {
        localStorage.setItem('copilot_chat_sessions', JSON.stringify(copilotChatSessions));
    } catch (e) {
        console.error('保存 AI 会话失败:', e);
    }
}

/**
 * 新建 AI 对话会话
 */
function createNewChatSession() {
    const newSession = {
        id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: '新对话',
        messages: [],
        createdTime: Date.now()
    };
    
    copilotChatSessions.unshift(newSession);
    copilotActiveChatSessionId = newSession.id;
    copilotMessages = newSession.messages;
    
    saveChatSessions();
    renderChatSessionsList();
    renderChatHistory();
}

/**
 * 删除 AI 对话会话
 */
async function deleteChatSession(sessionId, event) {
    if (event) event.stopPropagation(); // 阻止切换会话事件
    
    const session = copilotChatSessions.find(s => s.id === sessionId);
    const title = session ? session.title : '该对话';
    
    const confirmed = await showConfirm({
        title: '确认删除对话',
        message: `确定要永久删除对话“${title}”吗？删除后将无法恢复。`,
        confirmText: '确认删除',
        type: 'danger'
    });
    if (!confirmed) return;
    
    const isDeletingActive = copilotActiveChatSessionId === sessionId;
    
    // 如果删除的是当前正在生成的会话，中止它！
    if (isDeletingActive && copilotStreaming) {
        abortStreaming();
    }
    
    copilotChatSessions = copilotChatSessions.filter(s => s.id !== sessionId);
    
    if (isDeletingActive) {
        if (copilotChatSessions.length > 0) {
            copilotActiveChatSessionId = copilotChatSessions[0].id;
            copilotMessages = copilotChatSessions[0].messages;
        } else {
            createNewChatSession();
            return;
        }
    }
    
    saveChatSessions();
    renderChatSessionsList();
    
    // 只有删除当前激活的会话时，才需要重新渲染聊天历史，防止破坏其他会话中进行中的流式生成
    if (isDeletingActive) {
        renderChatHistory();
    }
}

/**
 * 切换 AI 对话会话
 */
async function switchChatSession(sessionId) {
    const session = copilotChatSessions.find(s => s.id === sessionId);
    if (!session) return;
    
    // 如果当前正在流式输出，给出确认弹窗
    if (copilotStreaming) {
        const confirmed = await showConfirm({
            title: '确认切换对话',
            message: '当前对话正在生成中，切换对话将中止生成。确定要切换吗？',
            confirmText: '确定切换',
            type: 'warning'
        });
        if (!confirmed) return;
        
        abortStreaming();
    }
    
    copilotActiveChatSessionId = sessionId;
    copilotMessages = session.messages;
    
    renderChatSessionsList();
    renderChatHistory();
}

/**
 * 渲染 AI 会话历史列表
 */
function renderChatSessionsList() {
    if (!copilotDom.chatList) return;
    
    if (copilotChatSessions.length === 0) {
        copilotDom.chatList.innerHTML = '<div class="copilot-empty-sessions">暂无对话记录</div>';
        return;
    }
    
    copilotDom.chatList.innerHTML = copilotChatSessions.map(session => {
        const activeClass = session.id === copilotActiveChatSessionId ? 'active' : '';
        return `
            <div class="copilot-chat-item ${activeClass}" data-chat-id="${session.id}">
                <div class="copilot-chat-item-info">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                    </svg>
                    <span class="copilot-chat-item-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
                </div>
                <button class="copilot-chat-item-delete" title="删除对话" data-chat-id="${session.id}">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
    
    // 绑定事件
    copilotDom.chatList.querySelectorAll('.copilot-chat-item').forEach(item => {
        item.addEventListener('click', () => {
            const chatId = item.dataset.chatId;
            if (chatId !== copilotActiveChatSessionId) {
                switchChatSession(chatId);
            }
        });
    });
    
    copilotDom.chatList.querySelectorAll('.copilot-chat-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const chatId = btn.dataset.chatId;
            deleteChatSession(chatId, e);
        });
    });
}

/**
 * 重新渲染对话框气泡历史
 */
function renderChatHistory() {
    if (!copilotDom.chatHistory) return;
    
    copilotDom.chatHistory.innerHTML = '';
    
    if (copilotMessages.length === 0) {
        if (copilotDom.welcomePane) {
            copilotDom.welcomePane.style.display = 'flex';
            copilotDom.chatHistory.appendChild(copilotDom.welcomePane);
        }
    } else {
        if (copilotDom.welcomePane) {
            copilotDom.welcomePane.style.display = 'none';
        }
        
        copilotMessages.forEach(msg => {
            if (msg.role === 'user') {
                appendUserBubble(msg.content);
            } else if (msg.role === 'assistant') {
                if (msg.content) {
                    appendAssistantBubbleToDom(msg.content);
                }
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    msg.tool_calls.forEach(toolCall => {
                        if (toolCall.function && toolCall.function.name === 'execute_command') {
                            let command = '';
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                command = args.command;
                            } catch(e) {
                                command = toolCall.function.arguments || '';
                            }

                            // 查找该 toolCall 对应的 tool 执行结果
                            const toolResponse = copilotMessages.find(m => m.role === 'tool' && m.tool_call_id === toolCall.id);
                            
                            // 渲染这个步骤卡片
                            appendSavedAgentStep(toolCall.id, command, toolResponse);
                        }
                    });
                }
            }
        });
    }
}

/**
 * 渲染已保存的 AI 回复气泡到 DOM
 */
function appendAssistantBubbleToDom(text) {
    if (!copilotDom.chatHistory) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'copilot-message assistant';
    msgDiv.innerHTML = `
        <div class="copilot-avatar">AI</div>
        <div class="copilot-bubble">
            ${markdownToHtml(text, getSelectedCopilotSession())}
        </div>
    `;
    copilotDom.chatHistory.appendChild(msgDiv);
    scrollChatToBottom();
}

function isSavedCopilotCommandReadOnly(command) {
    if (typeof command !== 'string') return false;

    const normalized = command.trim().toLowerCase();
    if (!normalized || /[^\S ]|[\u0000-\u001f\u007f;&|><`$\\]/.test(normalized)) return false;

    const firstToken = normalized.split(/ +/, 1)[0];
    return ['show', 'display', 'ping', 'traceroute'].includes(firstToken);
}

/**
 * 渲染保存下来的 Agent 执行步骤卡片
 */
function appendSavedAgentStep(id, command, toolResponse) {
    if (!copilotDom.chatHistory) return;

    const stepDiv = document.createElement('div');
    stepDiv.className = 'copilot-agent-step-log';
    stepDiv.id = `step-log-${id}`;

    const isWrite = !isSavedCopilotCommandReadOnly(command);

    const logIcon = isWrite ? '⚙️' : '🔍';
    const logType = isWrite ? '配置变更' : '诊断查询';

    let statusText = '等待回显...';
    let statusColor = 'opacity: 0.8;';
    let bgColor = 'rgba(59, 130, 246, 0.08);';

    if (toolResponse) {
        const content = toolResponse.content || '';
        if (content.startsWith('Error: Command execution rejected by user.')) {
            statusText = '已拒绝';
            statusColor = 'color: var(--warning-color, #f59e0b);';
            bgColor = 'background: rgba(245, 158, 11, 0.06);';
        } else if (content.startsWith('Error')) {
            statusText = '执行失败';
            statusColor = 'color: var(--danger-color, #ef4444);';
            bgColor = 'background: rgba(239, 68, 68, 0.06);';
        } else {
            statusText = '执行成功';
            statusColor = 'color: var(--success-color, #10b981);';
            bgColor = 'background: rgba(16, 185, 129, 0.06);';
        }
    }

    stepDiv.innerHTML = `
        <div style="font-size: 12.5px; color: var(--accent-color, #3b82f6); margin: 0; padding: 4px 12px; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; ${bgColor}">
            <span>${logIcon} <b>${logType}</b>：<code>${escapeHtml(command)}</code></span>
            <span class="step-status-spinner" style="font-size: 11.5px; ${statusColor}">${statusText}</span>
        </div>
    `;
    copilotDom.chatHistory.appendChild(stepDiv);
    scrollChatToBottom();
}

/**
 * 更新发送/停止按钮的显示状态
 */
function updateSendButtonState(isStreaming) {
    if (!copilotDom.sendBtn) return;
    
    if (isStreaming) {
        copilotDom.sendBtn.innerHTML = `
            停止
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
        `;
        copilotDom.sendBtn.classList.add('stop');
        copilotDom.sendBtn.disabled = false;
    } else {
        copilotDom.sendBtn.innerHTML = `
            发送
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
        `;
        copilotDom.sendBtn.classList.remove('stop');
    }
}

/**
 * 释放所有被 AI 接管的终端状态并写入提示信息
 */
function releaseAllAiTakeovers(isError = false) {
    if (typeof state !== 'undefined' && state.sessions) {
        for (const session of state.sessions.values()) {
            if (session.aiTakeover) {
                session.aiTakeover = false;
                if (session.terminal) {
                    if (isError) {
                        session.terminal.write('\r\n\x1b[31m--- [❌ AI 智能助手接管已终止/出错，终端已恢复自主操作] ---\x1b[0m\r\n');
                    } else {
                        session.terminal.write('\r\n\x1b[32m--- [✅ AI 智能助手接管结束，终端已恢复自主操作] ---\x1b[0m\r\n');
                    }
                }
            }
        }
    }
    // 同步移除终端区域的蓝色光晕
    const termContainer = document.getElementById('terminal-container');
    if (termContainer) {
        termContainer.classList.remove('ai-takeover-active');
    }
}

/**
 * 主动中止当前的流式生成
 */
function abortStreaming() {
    if (!copilotStreaming) return;
    
    // 中止时，先释放接管并输出红色提示
    releaseAllAiTakeovers(true);
    
    if (window.api && window.api.copilot && typeof window.api.copilot.abort === 'function') {
        window.api.copilot.abort();
    }
    
    // 如果当前处于状态展示或正在思考/生成报告阶段，则转换为已中止的静态状态信息，避免永久处于“正在分析...”和闪烁等待状态
    if (currentAssistantText.startsWith('[status]')) {
        let statusContent = currentAssistantText.slice(8);
        statusContent = statusContent.replace(/正在(?:深度)?分析.*并编制.*报告/g, '分析并生成报告已被手动终止');
        statusContent = statusContent.replace(/正在确认设备状态并编制配置报告/g, '配置确认已被手动终止');
        statusContent = statusContent.replace(/正在分析回显数据并整理建议/g, '数据分析已终止');
        statusContent = statusContent.replace(/\s*\.\.\.\s*$/, '');
        currentAssistantText = '[status-aborted]' + statusContent;
    } else if (currentAssistantText === '正在思考中...' || currentAssistantText === '正在生成报告中...' || !currentAssistantText) {
        currentAssistantText = '[status-aborted]已手动终止生成';
    } else {
        currentAssistantText += '\n\n*(已手动终止生成)*';
    }

    if (currentAssistantBubbleId) {
        const bubbleEl = document.getElementById(currentAssistantBubbleId);
        if (bubbleEl) {
            bubbleEl.innerHTML = markdownToHtml(currentAssistantText, getSelectedCopilotSession());
        }
    }
    
    finishStreaming();
    showToast('已停止生成', 'info');
}

// 暴露接口到 window 供全局路由和主入口调用
window.initCopilot = initCopilot;
window.refreshCopilotPage = refreshCopilotPage;
window.diagnoseTerminalContent = diagnoseTerminalContent;
