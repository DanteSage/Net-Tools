/**
 * Netcat 工具渲染进程逻辑
 */
const { ipcRenderer } = require('electron');

// ==================== 主题同步 ====================

function applyTheme(theme) {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme.mode || 'dark');
    document.documentElement.setAttribute('data-theme-name', theme.key || 'one-dark');
    if (theme.mode === 'light') {
        document.documentElement.classList.add('light-theme');
    } else {
        document.documentElement.classList.remove('light-theme');
    }
}

const _qs = new URLSearchParams(location.search);
const _qsMode = _qs.get('mode');
const _qsTheme = _qs.get('theme');
if (_qsMode || _qsTheme) {
    applyTheme({ mode: _qsMode, key: _qsTheme });
} else {
    ipcRenderer.invoke('theme:get').then(theme => {
        applyTheme(theme);
    }).catch(() => {});
}

ipcRenderer.on('theme:changed', (event, theme) => {
    applyTheme(theme);
});

// ==================== 工具函数 ====================

function $(id) { return document.getElementById(id); }

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function hexDump(hex) {
    // 把 hex 字符串分组每 2 字符空格分隔，每 16 字节换行
    if (!hex) return '';
    const groups = hex.match(/.{1,2}/g) || [];
    const lines = [];
    for (let i = 0; i < groups.length; i += 16) {
        lines.push(groups.slice(i, i + 16).join(' '));
    }
    return lines.join('\n');
}

/**
 * 在日志区追加一行
 */
function appendLog(container, kind, content) {
    // kind: 'in' | 'out' | 'sys' | 'err'
    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'log-line ' + kind;

    const tagText = kind === 'in' ? '收' : kind === 'out' ? '发' : kind === 'err' ? '错' : '系';
    line.innerHTML = `
        <span class="ts">${fmtTime()}</span>
        <span class="tag">${tagText}</span>
        <span class="body">${escHtml(content)}</span>
    `;
    container.appendChild(line);

    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;

    // 限制日志最大行数（防止内存暴涨）
    const max = 2000;
    if (container.childElementCount > max) {
        const removeN = container.childElementCount - max;
        for (let i = 0; i < removeN; i++) container.firstElementChild.remove();
    }
}

function setStatus(el, kind, text) {
    const dot = el.querySelector('.status-dot');
    const txt = el.querySelector('.status-text');
    dot.className = 'status-dot ' + (kind || '');
    txt.textContent = text;
}

// ==================== Tabs ====================

document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelector(`.panel[data-panel="${tab}"]`).classList.add('active');
    });
});

// ==================== Client 模式 ====================

let clientConnected = false;

const clientStatus = $('client-status');
const clientLog = $('client-log');
const clientConnectBtn = $('client-connect-btn');
const clientDisconnectBtn = $('client-disconnect-btn');
const clientSendBtn = $('client-send-btn');
const clientClearBtn = $('client-clear-btn');
const clientInput = $('client-input');
const clientShowHex = $('client-show-hex');

clientConnectBtn.addEventListener('click', async () => {
    const host = $('client-host').value.trim();
    const port = parseInt($('client-port').value, 10);
    const timeout = parseInt($('client-timeout').value, 10);
    if (!host || !port) {
        appendLog(clientLog, 'err', '请填写主机和端口');
        return;
    }
    clientConnectBtn.disabled = true;
    appendLog(clientLog, 'sys', `连接到 ${host}:${port}...`);
    try {
        const r = await ipcRenderer.invoke('netcat:client-connect', { host, port, timeout });
        if (!r || !r.success) {
            appendLog(clientLog, 'err', `连接失败：${(r && r.error) || '未知错误'}`);
            clientConnectBtn.disabled = false;
        }
    } catch (e) {
        appendLog(clientLog, 'err', '连接异常：' + e.message);
        clientConnectBtn.disabled = false;
    }
});

clientDisconnectBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('netcat:client-disconnect');
});

clientClearBtn.addEventListener('click', () => {
    clientLog.innerHTML = '<div class="log-empty">日志已清空</div>';
});

async function sendClient() {
    if (!clientConnected) return;
    const data = clientInput.value;
    const format = $('client-format').value;
    const newline = $('client-newline').checked;
    if (!data) return;
    try {
        const r = await ipcRenderer.invoke('netcat:client-send', { data, format, appendNewline: newline });
        if (r && r.success) {
            const display = clientShowHex.checked ? hexDump(Buffer.from(data + (newline ? '\r\n' : ''), 'utf8').toString('hex')) : data;
            appendLog(clientLog, 'out', display);
            clientInput.value = '';
        } else {
            appendLog(clientLog, 'err', '发送失败：' + (r && r.error));
        }
    } catch (e) {
        appendLog(clientLog, 'err', '发送异常：' + e.message);
    }
}

clientSendBtn.addEventListener('click', sendClient);

clientInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        sendClient();
    }
});

ipcRenderer.on('netcat:client-state', (_, payload) => {
    const { state, host, port, message, local, hadError } = payload || {};
    if (state === 'connecting') {
        setStatus(clientStatus, 'connecting', `正在连接 ${host}:${port}...`);
        clientConnectBtn.disabled = true;
        clientDisconnectBtn.disabled = false;
        clientSendBtn.disabled = true;
    } else if (state === 'connected') {
        clientConnected = true;
        const localStr = local ? ` (本地 ${local.address}:${local.port})` : '';
        setStatus(clientStatus, 'online', `已连接到 ${host}:${port}${localStr}`);
        appendLog(clientLog, 'sys', `已连接到 ${host}:${port}${localStr}`);
        clientConnectBtn.disabled = true;
        clientDisconnectBtn.disabled = false;
        clientSendBtn.disabled = false;
    } else if (state === 'closed') {
        clientConnected = false;
        setStatus(clientStatus, '', '已断开');
        appendLog(clientLog, 'sys', '连接已关闭' + (hadError ? '（发生错误）' : ''));
        clientConnectBtn.disabled = false;
        clientDisconnectBtn.disabled = true;
        clientSendBtn.disabled = true;
    } else if (state === 'error') {
        clientConnected = false;
        setStatus(clientStatus, 'error', '错误：' + (message || ''));
        appendLog(clientLog, 'err', message || '未知错误');
        clientConnectBtn.disabled = false;
        clientDisconnectBtn.disabled = true;
        clientSendBtn.disabled = true;
    }
});

ipcRenderer.on('netcat:client-data', (_, payload) => {
    const { text, hex, size } = payload || {};
    const display = clientShowHex.checked ? hexDump(hex) : text;
    appendLog(clientLog, 'in', display + `  [${size} 字节]`);
});

// ==================== Server 模式 ====================

let serverListening = false;
const serverConnectedClients = new Map(); // id -> {address, port}

const serverStatus = $('server-status');
const serverLog = $('server-log');
const serverListenBtn = $('server-listen-btn');
const serverStopBtn = $('server-stop-btn');
const serverSendBtn = $('server-send-btn');
const serverClientsEl = $('server-clients');
const serverClientCount = $('server-client-count');
const serverTarget = $('server-target');
const serverInput = $('server-input');

function renderServerClients() {
    serverClientsEl.innerHTML = '';
    if (serverConnectedClients.size === 0) {
        serverClientsEl.innerHTML = '<div class="client-empty">暂无连入客户端</div>';
    } else {
        for (const [id, info] of serverConnectedClients.entries()) {
            const row = document.createElement('div');
            row.className = 'client-item';
            row.innerHTML = `
                <span class="cid">#${id}</span>
                <span class="addr">${escHtml(info.address)}:${info.port}</span>
                <button class="btn btn-danger btn-small" data-kick="${id}">踢出</button>
            `;
            serverClientsEl.appendChild(row);
        }
    }
    serverClientCount.textContent = serverConnectedClients.size + ' 个';

    // 更新发送目标下拉
    const prev = serverTarget.value;
    serverTarget.innerHTML = '<option value="all">所有客户端</option>';
    for (const [id, info] of serverConnectedClients.entries()) {
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = `#${id} ${info.address}:${info.port}`;
        serverTarget.appendChild(opt);
    }
    if (prev && Array.from(serverTarget.options).some(o => o.value === prev)) {
        serverTarget.value = prev;
    }

    // 绑定踢出
    serverClientsEl.querySelectorAll('button[data-kick]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.kick, 10);
            await ipcRenderer.invoke('netcat:server-kick', { id });
        });
    });
}

serverListenBtn.addEventListener('click', async () => {
    const host = $('server-host').value.trim() || '0.0.0.0';
    const port = parseInt($('server-port').value, 10);
    if (!port) {
        appendLog(serverLog, 'err', '请填写端口');
        return;
    }
    serverListenBtn.disabled = true;
    appendLog(serverLog, 'sys', `开始在 ${host}:${port} 监听...`);
    try {
        const r = await ipcRenderer.invoke('netcat:server-start', { host, port });
        if (!r || !r.success) {
            appendLog(serverLog, 'err', '监听失败：' + (r && r.error));
            serverListenBtn.disabled = false;
        }
    } catch (e) {
        appendLog(serverLog, 'err', '监听异常：' + e.message);
        serverListenBtn.disabled = false;
    }
});

serverStopBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('netcat:server-stop');
});

async function sendServer() {
    if (!serverListening) return;
    const data = serverInput.value;
    const format = $('server-format').value;
    const newline = $('server-newline').checked;
    if (!data) return;
    const target = serverTarget.value;

    const sendOne = async (id) => {
        const r = await ipcRenderer.invoke('netcat:server-send', { id, data, format, appendNewline: newline });
        if (r && r.success) {
            appendLog(serverLog, 'out', `→ #${id}: ${data}`);
        } else {
            appendLog(serverLog, 'err', `→ #${id} 失败: ` + (r && r.error));
        }
    };

    if (target === 'all') {
        const ids = Array.from(serverConnectedClients.keys());
        if (ids.length === 0) {
            appendLog(serverLog, 'err', '没有连入的客户端');
            return;
        }
        await Promise.all(ids.map(sendOne));
    } else {
        await sendOne(parseInt(target, 10));
    }
    serverInput.value = '';
}

serverSendBtn.addEventListener('click', sendServer);

serverInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        sendServer();
    }
});

ipcRenderer.on('netcat:server-state', (_, payload) => {
    const { state, host, port, message } = payload || {};
    if (state === 'listening') {
        serverListening = true;
        setStatus(serverStatus, 'online', `正在监听 ${host}:${port}`);
        appendLog(serverLog, 'sys', `已开始监听 ${host}:${port}`);
        serverListenBtn.disabled = true;
        serverStopBtn.disabled = false;
        serverSendBtn.disabled = false;
    } else if (state === 'closed') {
        serverListening = false;
        serverConnectedClients.clear();
        renderServerClients();
        setStatus(serverStatus, '', '已停止监听');
        appendLog(serverLog, 'sys', '监听已停止');
        serverListenBtn.disabled = false;
        serverStopBtn.disabled = true;
        serverSendBtn.disabled = true;
    } else if (state === 'error') {
        serverListening = false;
        setStatus(serverStatus, 'error', '错误：' + (message || ''));
        appendLog(serverLog, 'err', message || '未知错误');
        serverListenBtn.disabled = false;
        serverStopBtn.disabled = true;
        serverSendBtn.disabled = true;
    }
});

ipcRenderer.on('netcat:server-client', (_, payload) => {
    const { event, id, address, port } = payload || {};
    if (event === 'connected') {
        serverConnectedClients.set(id, { address, port });
        appendLog(serverLog, 'sys', `客户端 #${id} 已连入 ${address}:${port}`);
        renderServerClients();
    } else if (event === 'disconnected') {
        const info = serverConnectedClients.get(id);
        serverConnectedClients.delete(id);
        if (info) {
            appendLog(serverLog, 'sys', `客户端 #${id} 已断开 (${info.address}:${info.port})`);
        }
        renderServerClients();
    }
});

ipcRenderer.on('netcat:server-data', (_, payload) => {
    const { id, text, size } = payload || {};
    appendLog(serverLog, 'in', `← #${id}: ${text}  [${size} 字节]`);
});

// ==================== Banner 抓取模式 ====================

let bannerRunning = false;
let bannerResults = [];

const bannerStartBtn = $('banner-start-btn');
const bannerStopBtn = $('banner-stop-btn');
const bannerClearBtn = $('banner-clear-btn');
const bannerExportBtn = $('banner-export-btn');
const bannerTargetsEl = $('banner-targets');
const bannerTbody = $('banner-tbody');
const bannerEmpty = $('banner-empty');
const bannerProgressFill = $('banner-progress-fill');
const bannerProgressText = $('banner-progress-text');

/**
 * 解析目标列表
 * 支持每行 "host:port" 或 "host port"
 */
function parseTargets(text) {
    const lines = (text || '').split(/\r?\n/);
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        let host, portStr;
        if (line.includes(':')) {
            const idx = line.lastIndexOf(':');
            host = line.slice(0, idx).trim();
            portStr = line.slice(idx + 1).trim();
        } else {
            const parts = line.split(/\s+/);
            host = parts[0];
            portStr = parts[1];
        }
        const port = parseInt(portStr, 10);
        if (host && Number.isInteger(port) && port > 0 && port <= 65535) {
            out.push({ host, port });
        }
    }
    return out;
}

function renderBannerResults() {
    if (bannerResults.length === 0) {
        bannerTbody.innerHTML = '';
        bannerEmpty.style.display = '';
        bannerExportBtn.disabled = true;
        return;
    }
    bannerEmpty.style.display = 'none';
    bannerExportBtn.disabled = false;
    bannerTbody.innerHTML = bannerResults.map((r, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escHtml(r.host)}</td>
            <td>${r.port}</td>
            <td class="status-${r.status}">${r.status}${r.error ? ' (' + escHtml(r.error) + ')' : ''}</td>
            <td>${r.size || 0}</td>
            <td class="col-banner" title="${escHtml(r.bannerText || '')}">${escHtml((r.bannerText || '').replace(/\r?\n/g, ' '))}</td>
        </tr>
    `).join('');
}

bannerStartBtn.addEventListener('click', async () => {
    const targets = parseTargets(bannerTargetsEl.value);
    if (targets.length === 0) {
        bannerProgressText.textContent = '目标列表为空或格式错误';
        return;
    }
    const timeout = parseInt($('banner-timeout').value, 10) || 3000;
    const concurrency = parseInt($('banner-concurrency').value, 10) || 20;
    const probe = $('banner-probe').value;

    bannerResults = [];
    renderBannerResults();
    bannerRunning = true;
    bannerStartBtn.disabled = true;
    bannerStopBtn.disabled = false;
    bannerProgressFill.style.width = '0%';
    bannerProgressText.textContent = `0 / ${targets.length}`;

    try {
        await ipcRenderer.invoke('netcat:banner-grab', { targets, timeout, concurrency, probe });
    } catch (e) {
        bannerProgressText.textContent = '失败: ' + e.message;
    }

    bannerRunning = false;
    bannerStartBtn.disabled = false;
    bannerStopBtn.disabled = true;
});

bannerStopBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('netcat:banner-stop');
    bannerProgressText.textContent = '已停止';
});

bannerClearBtn.addEventListener('click', () => {
    bannerResults = [];
    renderBannerResults();
    bannerProgressFill.style.width = '0%';
    bannerProgressText.textContent = '就绪';
});

bannerExportBtn.addEventListener('click', () => {
    if (bannerResults.length === 0) return;
    const header = ['#', 'host', 'port', 'status', 'size', 'banner'];
    const rows = bannerResults.map((r, i) => [
        i + 1,
        r.host,
        r.port,
        r.status + (r.error ? ' (' + r.error + ')' : ''),
        r.size || 0,
        (r.bannerText || '').replace(/\r?\n/g, ' ')
    ]);
    const csv = [header, ...rows].map(row =>
        row.map(cell => {
            const s = String(cell == null ? '' : cell);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',')
    ).join('\r\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banner-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

ipcRenderer.on('netcat:banner-progress', (_, payload) => {
    const { current, total, result } = payload || {};
    if (result) {
        bannerResults.push(result);
        renderBannerResults();
    }
    const pct = total > 0 ? (current / total) * 100 : 0;
    bannerProgressFill.style.width = pct.toFixed(1) + '%';
    bannerProgressText.textContent = `${current} / ${total}`;
});
