/**
 * AI 网络助手 (Net Tools Copilot) 主进程模块
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { app, ipcMain, safeStorage } = require('electron');

let contextGlobal = null;
const pendingApprovals = new Map();
const disabledPagingConnections = new Set();
let activeHttpRequest = null;
let isAborted = false;

const READ_ONLY_COMMAND_PREFIXES = new Set(['show', 'display', 'ping', 'traceroute']);
const UNSAFE_COMMAND_SYNTAX = /[^\S ]|[\u0000-\u001f\u007f;&|><`$\\]/;

// 提示符匹配正则 (支持 Cisco/Ruijie 的 > 或 #，Huawei/H3C 的 ] 或 >，支持接口名中的 / 和 :)
const PROMPT_REGEX = /(?:[A-Za-z0-9_./:\-]+\s*(\([A-Za-z0-9_./:\-]+\))?\s*[#>]|\[[A-Za-z0-9_./:\-]+\])$/;

// 定义 OpenAI 工具 Schema
const tools = [
    {
        type: 'function',
        function: {
            name: 'execute_command',
            description: '在当前选中的网络设备（如路由器、交换机）终端上执行一条 CLI 命令行指令，并返回设备的回显输出。',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: '要执行的命令行指令，例如 "show ip ospf neighbor" 或 "display ip interface brief"'
                    },
                    is_write_command: {
                        type: 'boolean',
                        description: '该命令是否会修改设备配置（写入/变更操作）。只读查询类命令（以 show, display, ping, traceroute 等开头）为 false；修改配置类命令（以 configure, system-view, set, undo, no, shutdown 等开头）为 true；无法确定时必须为 true。'
                    }
                },
                required: ['command', 'is_write_command']
            }
        }
    }
];

/**
 * 获取 AI 配置文件路径
 */
function getConfigPath() {
    return path.join(app.getPath('userData'), 'tshark-analyzer-config.json');
}

/**
 * 加载并解密 AI 配置
 */
function loadAiConfig() {
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.apiKey_encrypted && safeStorage.isEncryptionAvailable()) {
                try {
                    config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKey_encrypted, 'base64'));
                } catch (_) {}
            }
            return {
                apiUrl: config.apiUrl || '',
                apiKey: config.apiKey || '',
                model: config.model || ''
            };
        }
    } catch (_) {}
    return { apiUrl: '', apiKey: '', model: '' };
}

/**
 * 保存 AI 配置到配置文件
 */
function saveAiConfig(config) {
    try {
        const configPath = getConfigPath();
        const configToSave = {
            apiUrl: config.apiUrl || '',
            model: config.model || '',
            tsharkPath: ''
        };
        
        // 保留原有的 tsharkPath 配置
        if (fs.existsSync(configPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                configToSave.tsharkPath = existing.tsharkPath || '';
            } catch (_) {}
        }
        
        if (config.apiKey) {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(config.apiKey);
                configToSave.apiKey_encrypted = encrypted.toString('base64');
            } else {
                configToSave.apiKey = config.apiKey;
            }
        } else {
            configToSave.apiKey = '';
            configToSave.apiKey_encrypted = '';
        }
        
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('保存 AI 配置失败:', e);
        return false;
    }
}

/**
 * 仅用于界面风险标记，不得作为是否需要审批的授权依据。
 */
function isCommandPotentiallyWrite(command, suggestedIsWrite) {
    if (suggestedIsWrite === true) return true;

    if (typeof command !== 'string') return true;

    const cmd = command.trim().toLowerCase();
    if (!cmd || UNSAFE_COMMAND_SYNTAX.test(cmd)) return true;

    const firstToken = cmd.split(/ +/, 1)[0];
    return !READ_ONLY_COMMAND_PREFIXES.has(firstToken);
}

function isApprovalGranted(value) {
    return value === true;
}

/**
 * 获取屏蔽分页的命令
 */
function getDisablePagingCommand(deviceType) {
    const type = (deviceType || '').toLowerCase();
    if (type.includes('h3c')) {
        return 'screen-length disable';
    } else if (type.includes('huawei')) {
        return 'screen-length 0 temporary';
    } else if (type.includes('cisco') || type.includes('ruijie')) {
        return 'terminal length 0';
    } else if (type.includes('juniper')) {
        return 'set cli screen-length 0';
    }
    return null;
}

/**
 * 封装底层的单条原生指令执行与回显捕获
 */
function runRawCommand(stream, connectionType, connectionId, command) {
    return new Promise((resolve) => {
        let output = '';
        let timeoutTimer = null;

        const onData = (chunk) => {
            const dataStr = chunk.toString();
            output += dataStr;

            const trimmed = output.trim();
            const lines = trimmed.split('\n');
            const lastLine = lines[lines.length - 1]?.trim() || '';

            if (PROMPT_REGEX.test(lastLine)) {
                cleanup();
                resolve({ success: true, output });
            }
        };

        const cleanup = () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            try {
                stream.removeListener('data', onData);
            } catch (e) {}
        };

        stream.on('data', onData);

        // 5秒超时
        timeoutTimer = setTimeout(() => {
            cleanup();
            resolve({ success: true, output: output + '\n(AI Warning: Command timed out waiting for prompt, output may be incomplete)' });
        }, 5000);

        try {
            const { encodeString } = require('../connections/encoding-manager');
            const dataToWrite = encodeString ? encodeString(connectionId, command + '\n') : (command + '\n');
            
            if (connectionType === 'ssh' || connectionType === 'telnet' || connectionType === 'serial') {
                stream.write(dataToWrite);
            }
        } catch (err) {
            cleanup();
            resolve({ success: false, error: '数据写入设备失败: ' + err.message });
        }
    });
}

/**
 * 在活跃的物理设备终端连接上执行一条命令并捕获回显输出（支持自动静默禁用分页）
 */
async function executeCommandOnActiveConnection(context, connectionId, command, deviceType) {
    if (!context) {
        return { success: false, error: '主进程上下文未初始化' };
    }

    let stream = null;
    let connectionType = '';

    if (context.activeConnections && context.activeConnections.has(`${connectionId}_shell`)) {
        stream = context.activeConnections.get(`${connectionId}_shell`);
        connectionType = 'ssh';
    } else if (context.activeTelnetConnections && context.activeTelnetConnections.has(connectionId)) {
        stream = context.activeTelnetConnections.get(connectionId);
        connectionType = 'telnet';
    } else if (context.activeSerialPorts && context.activeSerialPorts.has(connectionId)) {
        stream = context.activeSerialPorts.get(connectionId);
        connectionType = 'serial';
    }

    if (!stream) {
        return { success: false, error: '目标设备连接不存在或已断开' };
    }

    // 1. 静默发送屏蔽分页符命令 (如果该会话尚未执行过禁用分页，且该设备厂商有对应命令)
    if (!disabledPagingConnections.has(connectionId)) {
        const disablePagingCmd = getDisablePagingCommand(deviceType);
        if (disablePagingCmd) {
            try {
                await runRawCommand(stream, connectionType, connectionId, disablePagingCmd);
                disabledPagingConnections.add(connectionId);
            } catch (_) {
                // 静默执行，即使失败也继续执行主命令
            }
        }
    }

    // 2. 执行主命令并返回结果
    return await runRawCommand(stream, connectionType, connectionId, command);
}

/**
 * 向渲染进程发送审核指令请求，阻塞并等待用户决策
 */
function requestUserApproval(context, connectionId, command) {
    return new Promise((resolve) => {
        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        pendingApprovals.set(requestId, { resolve });

        const mainWindow = context.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
            resolve(false);
            return;
        }

        mainWindow.webContents.send('copilot:approveRequest', {
            requestId,
            connectionId,
            command
        });
    });
}

/**
 * 递归/多轮处理工具调用的逻辑
 */
/**
 * 实际调用大模型接口，支持工具注册与流式流解析 (异步 Promise 版本)
 */
function callLLM(event, messages, systemPrompt, config) {
    return new Promise((resolve) => {
        let endpointUrl = (config.apiUrl || 'https://api.openai.com/v1/chat/completions').trim();
        try {
            const _u = new URL(endpointUrl);
            if (!_u.pathname.includes('chat/completions')) {
                if (_u.pathname === '/' || _u.pathname === '') {
                    endpointUrl = endpointUrl.replace(/\/$/, '') + '/v1/chat/completions';
                } else {
                    endpointUrl = endpointUrl.replace(/\/$/, '') + '/chat/completions';
                }
            }
        } catch (e) {
            event.sender.send('copilot:error', `无效的 API 地址: ${endpointUrl}`);
            resolve({ error: 'Invalid API URL' });
            return;
        }

        const isMiMoTokenPlan = (config.apiKey || '').startsWith('tp-');
        const authHeaders = isMiMoTokenPlan
            ? { 'api-key': config.apiKey }
            : { 'Authorization': `Bearer ${config.apiKey}` };

        const formattedMessages = [
            { role: 'system', content: systemPrompt || '你是一个资深网络专家，专注于为用户提供网络配置脚本的编写与排错建议。' },
            ...messages
        ];

        const body = JSON.stringify({
            model: config.model || 'gpt-3.5-turbo',
            messages: formattedMessages,
            temperature: 0.7,
            stream: true,
            tools: tools,
            tool_choice: 'auto'
        });

        let parsedUrl;
        try {
            parsedUrl = new URL(endpointUrl);
        } catch {
            event.sender.send('copilot:error', `解析 API 地址失败: ${endpointUrl}`);
            resolve({ error: 'URL Parse Failed' });
            return;
        }

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + (parsedUrl.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 60000,
            rejectUnauthorized: true
        };

        const transport = parsedUrl.protocol === 'https:' ? https : http;
        let req;
        try {
            req = transport.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errData = '';
                    res.on('data', c => { errData += c; });
                    res.on('end', () => {
                        let errMsg = `API 返回错误 (HTTP ${res.statusCode})`;
                        try {
                            const ej = JSON.parse(errData);
                            errMsg = ej.error?.message || errMsg;
                        } catch (_) {}
                        event.sender.send('copilot:error', errMsg);
                        resolve({ error: errMsg });
                    });
                    return;
                }

                let buffer = '';
                let accumulatedContent = '';
                const accumulatedToolCalls = [];

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // 保留不完整行

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        if (trimmed.startsWith('data:')) {
                            const payload = trimmed.slice(5).trim();
                            if (payload === '[DONE]') continue;
                            try {
                                const deltaObj = JSON.parse(payload);
                                const choice = deltaObj.choices?.[0];
                                if (!choice) continue;

                                const text = choice.delta?.content;
                                if (text) {
                                    accumulatedContent += text;
                                    event.sender.send('copilot:chunk', text);
                                }

                                const toolCalls = choice.delta?.tool_calls;
                                if (toolCalls && toolCalls.length > 0) {
                                    for (const tc of toolCalls) {
                                        const index = tc.index;
                                        if (!accumulatedToolCalls[index]) {
                                            accumulatedToolCalls[index] = {
                                                id: tc.id || '',
                                                type: tc.type || 'function',
                                                function: { name: tc.function?.name || '', arguments: '' }
                                            };
                                        }
                                        if (tc.id) accumulatedToolCalls[index].id = tc.id;
                                        if (tc.function?.name) accumulatedToolCalls[index].function.name = tc.function.name;
                                        if (tc.function?.arguments) {
                                            accumulatedToolCalls[index].function.arguments += tc.function.arguments;
                                        }
                                    }
                                }
                            } catch (e) {
                                // 忽略单行解析错误
                            }
                        }
                    }
                });

                res.on('end', () => {
                    if (buffer.trim()) {
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith('data:')) {
                            const payload = trimmed.slice(5).trim();
                            if (payload !== '[DONE]') {
                                try {
                                    const deltaObj = JSON.parse(payload);
                                    const choice = deltaObj.choices?.[0];
                                    if (choice) {
                                        const text = choice.delta?.content;
                                        if (text) {
                                            accumulatedContent += text;
                                            event.sender.send('copilot:chunk', text);
                                        }
                                    }
                                } catch (_) {}
                            }
                        }
                    }

                    const finalToolCalls = accumulatedToolCalls.filter(x => x);
                    if (activeHttpRequest === req) activeHttpRequest = null;
                    resolve({ content: accumulatedContent, toolCalls: finalToolCalls });
                });
            });

            req.on('error', (err) => {
                if (activeHttpRequest === req) activeHttpRequest = null;
                event.sender.send('copilot:error', `网络请求失败: ${err.message}`);
                resolve({ error: err.message });
            });

            req.on('timeout', () => {
                req.destroy();
                if (activeHttpRequest === req) activeHttpRequest = null;
                event.sender.send('copilot:error', '请求超时，请检查网络或 API Key 状态');
                resolve({ error: 'Request Timeout' });
            });

            activeHttpRequest = req;
            req.write(body);
            req.end();

        } catch (error) {
            event.sender.send('copilot:error', `启动请求发生异常: ${error.message}`);
            resolve({ error: error.message });
        }
    });
}

/**
 * 批量执行 AI 工具调用命令
 */
async function executeToolCalls(event, toolCalls, connectionId, deviceType, dependencies = {}) {
    const approvalRequester = dependencies.requestUserApproval || requestUserApproval;
    const commandExecutor = dependencies.executeCommandOnActiveConnection || executeCommandOnActiveConnection;
    const executionContext = dependencies.context || contextGlobal;
    const toolMessages = [];
    for (const toolCall of toolCalls) {
        if (isAborted) break;
        if (toolCall.function.name === 'execute_command') {
            let args;
            try {
                args = JSON.parse(toolCall.function.arguments);
            } catch (e) {
                args = { command: '', is_write_command: false };
            }

            if (!args || typeof args !== 'object' || Array.isArray(args)) {
                args = { command: '', is_write_command: true };
            }

            const command = typeof args.command === 'string' ? args.command.trim() : '';
            const isWrite = isCommandPotentiallyWrite(command, args.is_write_command);

            // 1. 发送正在执行状态通知前端
            event.sender.send('copilot:agentStep', {
                status: 'executing',
                id: toolCall.id,
                command: command,
                isWrite,
                requiresApproval: true
            });

            let executeResult = '';
            let stepSuccess = true;
            let stepErrorType = ''; // 'rejected' or 'error'
            
            if (!command) {
                executeResult = 'Error: AI returned an empty or invalid command.';
                stepSuccess = false;
                stepErrorType = 'error';
            } else if (!connectionId) {
                executeResult = 'Error: No active terminal connection selected. Please select a session in the left sidebar.';
                stepSuccess = false;
                stepErrorType = 'error';
            } else {
                // 所有 AI 设备命令都必须由用户逐条批准，风险标签不参与授权。
                const approved = isApprovalGranted(
                    await approvalRequester(executionContext, connectionId, command)
                );

                if (approved) {
                    // 执行设备命令
                    const runRes = await commandExecutor(executionContext, connectionId, command, deviceType);
                    if (runRes.success) {
                        executeResult = runRes.output;
                    } else {
                        executeResult = 'Error during execution: ' + runRes.error;
                        stepSuccess = false;
                        stepErrorType = 'error';
                    }
                } else {
                    executeResult = 'Error: Command execution rejected by user.';
                    stepSuccess = false;
                    stepErrorType = 'rejected';
                }
            }

            // 2. 发送执行完毕状态通知前端
            event.sender.send('copilot:agentStep', {
                status: 'completed',
                id: toolCall.id,
                command: command,
                success: stepSuccess,
                errorType: stepErrorType,
                result: executeResult.substring(0, 150) + (executeResult.length > 150 ? '...' : '')
            });

            // 3. 构建工具角色消息
            toolMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: 'execute_command',
                content: executeResult
            });
        }
    }
    return toolMessages;
}

/**
 * 诊断状态机主类 (NetworkDiagnoseGraph)
 * 模拟 LangGraph 的节点跳转与状态流转
 */
class NetworkDiagnoseGraph {
    constructor(event, messages, systemPrompt, config, connectionId, deviceType) {
        this.event = event;
        this.config = config;
        this.connectionId = connectionId;
        this.deviceType = deviceType;
        this.messages = [...messages]; // 复制历史记录
        this.baseSystemPrompt = systemPrompt || '你是一个资深网络专家，专注于为用户提供网络配置脚本的编写与排错建议。';

        this.state = {
            currentNode: 'init',
            diagnosticData: {}, // 存储命令与其回显内容
            isCompleted: false,
            stepsCount: 0,
            maxSteps: 6
        };
    }

    async run() {
        while (!this.state.isCompleted && this.state.stepsCount < this.state.maxSteps) {
            if (isAborted) break;

            console.log(`[DiagnoseGraph] Running Node: ${this.state.currentNode}, Step: ${this.state.stepsCount}`);

            if (this.state.currentNode === 'init') {
                await this.initNode();
            } else if (this.state.currentNode === 'collect') {
                await this.collectNode();
            } else if (this.state.currentNode === 'analyze') {
                await this.analyzeNode();
            } else if (this.state.currentNode === 'summarize') {
                await this.summarizeNode();
            } else {
                this.state.isCompleted = true;
            }

            this.state.stepsCount++;
        }

        if (!isAborted) {
            this.event.sender.send('copilot:end', this.messages);
        }
    }

    /**
     * INIT 节点：识别排障协议场景，加载相应的排错技能引导，并规划发起首条指令
     */
    async initNode() {
        const lastUserMessage = this.messages.filter(m => m.role === 'user').pop()?.content || '';
        console.log('[DiagnoseGraph] Init Node. User request:', lastUserMessage);

        let protocolInfo = '';
        const msg = lastUserMessage.toLowerCase();
        if (msg.includes('ospf')) {
            protocolInfo = '【诊断协议：OSPF】\n排错 SOP：1. 检查物理和 IP 路由是否通畅；2. 检查 OSPF 邻居状态是否建立 (show ip ospf peer / brief)；3. 核对两端 Area ID、Hello Interval 和 MTU 设置。';
        } else if (msg.includes('vlan') || msg.includes('trunk')) {
            protocolInfo = '【诊断协议：VLAN & Trunk】\n排错 SOP：1. 检查物理接口封装状态；2. 查看接口通过的 VLAN 允许列表；3. 校验 Native VLAN / PVID 是否吻合。';
        } else if (msg.includes('bgp')) {
            protocolInfo = '【诊断协议：BGP】\n排错 SOP：1. 确认 TCP 179 端口通畅性；2. 查看 BGP 邻居配置的 AS 号与更新源；3. 校验路由下一跳是否可达。';
        } else if (msg.includes('ping') || msg.includes('通不通') || msg.includes('连通') || msg.includes('网络中断')) {
            protocolInfo = '【诊断协议：基础连通性】\n排错 SOP：1. 检查直连与网段路由；2. 查看默认路由与网关设置；3. 核验是否存在 ACL / 防火墙策略阻断。';
        }

        // 拼接智能提示词
        const systemPrompt = `${this.baseSystemPrompt}\n\n【诊断流程 - 阶段 1：初始化与信息收集】\n你正在协助用户排查一个网络故障。\n${protocolInfo}\n1. 请决定你需要执行的第一条网络设备调试/查询指令，以了解当前设备的基础运行状态。\n2. 你必须且只能通过调用 \`execute_command\` 工具执行此命令。绝对禁止在没有工具调用的情况下口头宣称你执行了命令。\n3. 请只使用只读性质的查询指令（如 show, display, ping, traceroute），严禁修改配置！`;

        const res = await callLLM(this.event, this.messages, systemPrompt, this.config);
        if (res.error) {
            this.state.isCompleted = true;
            return;
        }

        if (res.toolCalls && res.toolCalls.length > 0) {
            const toolMessages = await executeToolCalls(this.event, res.toolCalls, this.connectionId, this.deviceType);

            this.messages.push({
                role: 'assistant',
                content: res.content || null,
                tool_calls: res.toolCalls
            });
            this.messages.push(...toolMessages);

            // 存入诊断缓存
            for (const tMsg of toolMessages) {
                const matchedCall = res.toolCalls.find(tc => tc.id === tMsg.tool_call_id);
                if (matchedCall) {
                    try {
                        const args = JSON.parse(matchedCall.function.arguments);
                        this.state.diagnosticData[args.command] = tMsg.content;
                    } catch (_) {}
                }
            }

            this.state.currentNode = 'collect';
        } else {
            // 没有需要连接终端执行的命令，直接视作普通对话
            if (res.content) {
                this.messages.push({ role: 'assistant', content: res.content });
            }
            this.state.isCompleted = true;
        }
    }

    /**
     * COLLECT 节点：根据已有数据，决定是否继续收集其他设备信息
     */
    async collectNode() {
        console.log('[DiagnoseGraph] Collect Node. Current keys:', Object.keys(this.state.diagnosticData));

        const systemPrompt = `${this.baseSystemPrompt}

【诊断流程 - 阶段 2：数据收集深化】
你当前已经收集了以下命令的回显内容：
${Object.keys(this.state.diagnosticData).map(cmd => `- 命令: \`${cmd}\` (回显字数: ${this.state.diagnosticData[cmd].length})`).join('\n')}

请根据当前已有回显，推断是否需要执行其他调试指令来获取更多诊断证据？
1. 若**需要**，请**继续且仅调用一次** \`execute_command\` 工具。
2. 若**不需要**（已有足够证据诊断根本原因），请**不要生成工具调用**，直接回复你的简短分析思路。状态机将自动跳转至分析诊断节点。`;

        const res = await callLLM(this.event, this.messages, systemPrompt, this.config);
        if (res.error) {
            this.state.isCompleted = true;
            return;
        }

        if (res.toolCalls && res.toolCalls.length > 0) {
            const toolMessages = await executeToolCalls(this.event, res.toolCalls, this.connectionId, this.deviceType);

            this.messages.push({
                role: 'assistant',
                content: res.content || null,
                tool_calls: res.toolCalls
            });
            this.messages.push(...toolMessages);

            for (const tMsg of toolMessages) {
                const matchedCall = res.toolCalls.find(tc => tc.id === tMsg.tool_call_id);
                if (matchedCall) {
                    try {
                        const args = JSON.parse(matchedCall.function.arguments);
                        this.state.diagnosticData[args.command] = tMsg.content;
                    } catch (_) {}
                }
            }

            // 安全上限：避免无限套娃收集
            if (Object.keys(this.state.diagnosticData).length >= 4) {
                this.state.currentNode = 'analyze';
            }
        } else {
            if (res.content) {
                this.messages.push({ role: 'assistant', content: res.content });
            }
            this.state.currentNode = 'analyze';
        }
    }

    /**
     * ANALYZE 节点：全面推理并确定故障根因，寻找配置修复方案
     */
    async analyzeNode() {
        console.log('[DiagnoseGraph] Analyze Node');

        const systemPrompt = `${this.baseSystemPrompt}

【诊断流程 - 阶段 3：故障原因分析】
你已经从网络终端上收集了如下关键运行状态：
${Object.entries(this.state.diagnosticData).map(([cmd, out]) => `\n====== 命令 [ ${cmd} ] 回显 ======\n${out.substring(0, 1000)}${out.length > 1000 ? '\n... (部分内容已省略)' : ''}`).join('\n')}

请运用你的专业知识，对上述回显进行严密逻辑推理：
1. 找出故障的源头（根因）以及可能的影响。
2. 准备一份能够完美修复此故障的配置下发建议脚本。
3. 如果需要最后一两个特殊只读命令来最终证实你的结论，你依然可以调用工具执行命令。
4. 如果诊断已经基本明晰，请**停止调用工具**，直接输出诊断思路。系统将自动引导进入生成最终报告阶段。`;

        const res = await callLLM(this.event, this.messages, systemPrompt, this.config);
        if (res.error) {
            this.state.isCompleted = true;
            return;
        }

        if (res.toolCalls && res.toolCalls.length > 0) {
            const toolMessages = await executeToolCalls(this.event, res.toolCalls, this.connectionId, this.deviceType);
            this.messages.push({
                role: 'assistant',
                content: res.content || null,
                tool_calls: res.toolCalls
            });
            this.messages.push(...toolMessages);

            for (const tMsg of toolMessages) {
                const matchedCall = res.toolCalls.find(tc => tc.id === tMsg.tool_call_id);
                if (matchedCall) {
                    try {
                        const args = JSON.parse(matchedCall.function.arguments);
                        this.state.diagnosticData[args.command] = tMsg.content;
                    } catch (_) {}
                }
            }
            this.state.currentNode = 'summarize';
        } else {
            if (res.content) {
                this.messages.push({ role: 'assistant', content: res.content });
            }
            this.state.currentNode = 'summarize';
        }
    }

    /**
     * SUMMARIZE 节点：面向用户生成最终排错诊断报告，并给出修复及验证指令
     */
    async summarizeNode() {
        console.log('[DiagnoseGraph] Summarize Node');
        try {
            this.event.sender.send('copilot:generatingReport');
        } catch (_) {}

        const systemPrompt = `${this.baseSystemPrompt}

【诊断流程 - 阶段 4：生成最终诊断报告】
根据前面的分析和收集到的设备数据，请输出一份结构非常美观、专业的排错报告。
必须以 Markdown 格式包含以下几个板块：
1. **诊断结论**：用最显眼的方式概括本次排障的结论（根因是什么）。
2. **诊断过程与依据**：列出你执行过的关键排查命令，以及从这些回显中发现了什么（用表格或列表展示对比，例如：R1 的 MTU 是 1500，而 R2 的 MTU 是 1450）。
3. **修复建议方案**：提供精确的、开箱即用的配置下发指令建议（区分好模式，如系统视图/全局配置模式），供用户复制执行。
4. **验证建议**：配置修改后应该如何验证是否恢复（例如使用 ping/show 等指令）。`;

        const res = await callLLM(this.event, this.messages, systemPrompt, this.config);
        if (res.content) {
            this.messages.push({ role: 'assistant', content: res.content });
        }
        this.state.isCompleted = true;
    }
}

/**
 * 解析命令行提示符所属的模式/视图并提供说明
 */
function parsePromptMode(prompt, deviceType) {
    const p = (prompt || '').trim();
    const type = (deviceType || '').toLowerCase();
    
    let modeInfo = `命令行提示符为：\`${p}\``;
    
    if (type.includes('h3c') || type.includes('huawei')) {
        if (p.startsWith('<') && p.endsWith('>')) {
            modeInfo += '（当前处于：用户视图/User View。如果需要进行配置修改，必须先下发 `system-view` 进入系统视图）';
        } else if (p.startsWith('[') && p.endsWith(']')) {
            const inner = p.slice(1, -1).toLowerCase();
            const subViewKeywords = ['ethernet', 'vlan', 'trunk', 'loopback', 'ospf', 'route', 'acl', 'bgp', 'interface', 'aaa', 'dhcp', 'user-interface'];
            const isSubView = subViewKeywords.some(kw => inner.includes(kw));
            if (isSubView) {
                modeInfo += '（当前处于：子配置视图/Sub-configuration View。如果需要配置当前子模块可直接下发指令；如果需要配置其他接口，需要先下发 `quit` 退回系统视图）';
            } else {
                modeInfo += '（当前处于：系统视图/System View。代表你已经在系统配置模式下，如果需要配置接口，可直接下发 `interface <接口名>` 进入接口视图；请注意：绝对不能下发 `system-view` 命令，否则设备会报错 Unrecognized command）';
            }
        }
    } else if (type.includes('cisco') || type.includes('ruijie')) {
        if (p.endsWith(')')) {
            if (p.endsWith('(config)#')) {
                modeInfo += '（当前处于：全局配置模式/Global Configuration Mode。可直接下发全局或接口配置命令；请注意：绝对不要下发 `configure terminal` 避免命令冲突）';
            } else if (p.includes('(config-')) {
                modeInfo += '（当前处于：子配置模式/Sub-configuration Mode。如果需要配置当前子模块可直接下发指令；如果配置其他模块需要先下发 `exit`）';
            }
        } else if (p.endsWith('#')) {
            modeInfo += '（当前处于：特权模式/Privileged EXEC Mode。如果需要修改配置，必须先下发 `configure terminal` 进入全局配置模式）';
        } else if (p.endsWith('>')) {
            modeInfo += '（当前处于：用户模式/User EXEC Mode。必须先下发 `enable` 进入特权模式，再下发 `configure terminal` 进行配置）';
        }
    }
    
    return modeInfo;
}

/**
 * 静默获取当前活动连接的命令行提示符
 */
async function getCurrentPrompt(context, connectionId) {
    if (!context) return '';
    let stream = null;
    let connectionType = '';

    if (context.activeConnections && context.activeConnections.has(`${connectionId}_shell`)) {
        stream = context.activeConnections.get(`${connectionId}_shell`);
        connectionType = 'ssh';
    } else if (context.activeTelnetConnections && context.activeTelnetConnections.has(connectionId)) {
        stream = context.activeTelnetConnections.get(connectionId);
        connectionType = 'telnet';
    } else if (context.activeSerialPorts && context.activeSerialPorts.has(connectionId)) {
        stream = context.activeSerialPorts.get(connectionId);
        connectionType = 'serial';
    }

    if (!stream) return '';

    return new Promise((resolve) => {
        let output = '';
        let timeoutTimer = null;

        const onData = (chunk) => {
            const dataStr = chunk.toString();
            output += dataStr;

            const trimmed = output.trim();
            const lines = trimmed.split('\n');
            const lastLine = lines[lines.length - 1]?.trim() || '';

            if (PROMPT_REGEX.test(lastLine)) {
                cleanup();
                resolve(lastLine);
            }
        };

        const cleanup = () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            try {
                stream.removeListener('data', onData);
            } catch (e) {}
        };

        stream.on('data', onData);

        // 1秒超时，获取提示符不能阻塞用户聊天太久
        timeoutTimer = setTimeout(() => {
            cleanup();
            const trimmed = output.trim();
            const lines = trimmed.split('\n');
            const lastLine = lines[lines.length - 1]?.trim() || '';
            resolve(lastLine);
        }, 1000);

        try {
            const { encodeString } = require('../connections/encoding-manager');
            const dataToWrite = encodeString ? encodeString(connectionId, '\n') : '\n';
            stream.write(dataToWrite);
        } catch (err) {
            cleanup();
            resolve('');
        }
    });
}

/**
 * 注册 AI 网络助手相关 IPC 处理程序
 */
function registerCopilotHandlers(context) {
    contextGlobal = context;

    // 获取配置状态
    ipcMain.handle('copilot:getConfigStatus', async () => {
        const config = loadAiConfig();
        return {
            configured: !!config.apiKey,
            model: config.model || 'gpt-3.5-turbo',
            apiUrl: config.apiUrl || 'https://api.openai.com'
        };
    });

    // 获取完整配置数据
    ipcMain.handle('copilot:getConfig', async () => {
        return loadAiConfig();
    });

    // 保存完整配置数据
    ipcMain.handle('copilot:saveConfig', async (event, config) => {
        const success = saveAiConfig(config);
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
            try {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('tshark:configChanged');
                }
            } catch (_) {}
        });
        return { success };
    });

    // 审批反馈处理器
    ipcMain.handle('copilot:approveResponse', async (event, { requestId, approved }) => {
        if (pendingApprovals.has(requestId)) {
            const { resolve } = pendingApprovals.get(requestId);
            pendingApprovals.delete(requestId);
            resolve(isApprovalGranted(approved));
            return { success: true };
        }
        return { success: false, error: '审批请求已失效或不存在' };
    });

    // 监听 AI 流式聊天请求 (Agent 版)
    ipcMain.on('copilot:chat', async (event, { messages, systemPrompt, connectionId, deviceType }) => {
        isAborted = false;
        if (activeHttpRequest) {
            try {
                activeHttpRequest.destroy();
            } catch (e) {}
            activeHttpRequest = null;
        }

        const config = loadAiConfig();
        if (!config.apiKey) {
            event.sender.send('copilot:error', '未检测到 API Key，请先在高级工具->TsharkAnalyzer 设置中配置 AI Key');
            return;
        }

        let updatedSystemPrompt = systemPrompt || '';
        
        // 针对特定终端状态加入提示信息
        if (connectionId) {
            try {
                const currentPrompt = await getCurrentPrompt(contextGlobal, connectionId);
                if (currentPrompt) {
                    const promptExplanation = parsePromptMode(currentPrompt, deviceType);
                    updatedSystemPrompt += `\n\n【重要上下文】当前设备终端所处的${promptExplanation}`;
                }
            } catch (e) {
                console.error('获取当前提示符失败:', e);
            }
        }

        if (isAborted) return;

        // 实例化诊断状态机并运行
        const graph = new NetworkDiagnoseGraph(event, messages, updatedSystemPrompt, config, connectionId, deviceType);
        graph.run().catch(err => {
            console.error('诊断状态机执行异常:', err);
            event.sender.send('copilot:error', `诊断执行失败: ${err.message}`);
        });
    });

    // 监听中止请求
    ipcMain.on('copilot:abort', (event) => {
        isAborted = true;
        if (activeHttpRequest) {
            try {
                activeHttpRequest.destroy();
            } catch (e) {}
            activeHttpRequest = null;
        }
        // 清理所有挂起的人工审批，向对应的 Promise 返回 false 阻断命令执行
        pendingApprovals.forEach((item) => {
            try {
                item.resolve(false);
            } catch (e) {}
        });
        pendingApprovals.clear();
        console.log('[Copilot] AI execution aborted by user.');
    });
}

module.exports = {
    registerCopilotHandlers,
    isCommandPotentiallyWrite,
    isApprovalGranted,
    executeToolCalls
};
