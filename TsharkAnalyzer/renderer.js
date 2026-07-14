/**
 * TsharkAnalyzer - 渲染进程主入口
 * 依赖：contextIsolation: false, nodeIntegration: true
 */
/* global require */
const { ipcRenderer } = require('electron');

// ==================== 状态 ====================

const state = {
    packets: [],
    filteredPackets: [],
    selectedIdx: -1,
    isCapturing: false,
    displayFilter: '',
    aiConfig: {},
    diagnosis: null,
    tsharkVersion: '',
    stats: {
        total: 0, bytes: 0, retrans: 0, rsts: 0,
        outOfOrders: 0, duplicateAcks: 0, synCount: 0,
        rttSum: 0, rttCount: 0, ttlSum: 0, ttlCount: 0,
        dnsErrors: 0, icmpUnreachable: 0,
        httpErrors: 0, tlsAlerts: 0, finCount: 0,
        protocols: {}, srcIps: {}, dstIps: {}, dstPorts: {},
        failedDnsNames: [],
        firstTs: 0, lastTs: 0
    }
};

// 虚拟列表常量
const ROW_H = 26;
const BUFFER = 20;

// ==================== DOM 快捷引用 ====================

const $ = (id) => document.getElementById(id);
const vlistContainer = $('vlist-container');
const vlistSpacer = $('vlist-spacer');
const vlistRows = $('vlist-rows');
const emptyState = $('empty-state');

let _lastPaintStart = -1, _lastPaintEnd = -1;
let _statUpdateTimer = null;
let _uiDirty = false;
let _uiRefreshTimer = null;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    resetStats();
    applyTheme();
    bindUIEvents();
    bindIpcEvents();
    await loadConfig();
    await checkTshark();
    await loadInterfaces();
    renderVList();
});

// ==================== 主题 ====================

function applyTheme(themePayload) {
    let mode, key;
    if (themePayload) {
        mode = themePayload.mode;
        key = themePayload.key;
    } else {
        const params = new URLSearchParams(location.search);
        mode = params.get('mode');
        key = params.get('theme');
    }

    if (!mode && !key) {
        ipcRenderer.invoke('theme:get').then(t => {
            if (t) {
                document.documentElement.setAttribute('data-theme', t.mode || 'dark');
                document.documentElement.setAttribute('data-theme-name', t.key || 'one-dark');
                if (t.mode === 'light') {
                    document.documentElement.classList.add('light');
                } else {
                    document.documentElement.classList.remove('light');
                }
            }
        }).catch(() => {});
        return;
    }

    document.documentElement.setAttribute('data-theme', mode || 'dark');
    document.documentElement.setAttribute('data-theme-name', key || 'one-dark');
    if (mode === 'light') {
        document.documentElement.classList.add('light');
    } else {
        document.documentElement.classList.remove('light');
    }
}

// 绑定运行时主题变更监听
ipcRenderer.on('theme:changed', (event, theme) => {
    applyTheme(theme);
});

// ==================== Tshark 检测 ====================

async function checkTshark() {
    const customPath = state.aiConfig.tsharkPath || '';
    const result = await ipcRenderer.invoke('tshark:checkVersion', customPath || undefined);
    const el = $('tshark-status');
    if (result.found) {
        state.tsharkVersion = result.version || '';
        const majorVer = parseInt((result.version || '0').split('.')[0], 10);
        if (majorVer < 3) {
            el.textContent = '⚠ tshark ' + result.version + '（版本过低）';
            el.className = 'status-pill error';
            $('btn-start').disabled = false;
            $('btn-clear').disabled = false;
            showToast('tshark 版本过低（< 3.0），TLS 等检测功能不可用，建议升级至 4.x', 'error');
        } else if (majorVer < 4) {
            el.textContent = '✓ tshark ' + result.version;
            el.className = 'status-pill ready';
            $('btn-start').disabled = false;
            $('btn-clear').disabled = false;
        } else {
            el.textContent = '✓ tshark ' + result.version;
            el.className = 'status-pill ready';
            $('btn-start').disabled = false;
            $('btn-clear').disabled = false;
        }
    } else {
        state.tsharkVersion = '';
        el.textContent = '✗ 未找到 tshark';
        el.className = 'status-pill error';
        $('btn-start').disabled = true;
        showToast('未找到 tshark，请安装 Wireshark 或在设置中指定路径', 'error');
    }
}

// ==================== 接口列表 ====================

async function loadInterfaces() {
    const result = await ipcRenderer.invoke('tshark:getInterfaces');
    const sel = $('interface-select');
    sel.innerHTML = '';
    if (result.success && result.interfaces.length > 0) {
        result.interfaces.forEach(iface => {
            const opt = document.createElement('option');
            opt.value = iface.index;
            opt.textContent = `${iface.index}. ${iface.description || iface.name}`.substring(0, 50);
            sel.appendChild(opt);
        });
    } else {
        const opt = document.createElement('option');
        opt.value = '1';
        opt.textContent = '默认接口 (1)';
        sel.appendChild(opt);
    }
}

// ==================== 配置管理 ====================

async function loadConfig() {
    const result = await ipcRenderer.invoke('tshark:loadConfig');
    if (result.success && result.config) {
        state.aiConfig = result.config;
        if (result.config.tsharkPath) $('cfg-tshark-path').value = result.config.tsharkPath;
        if (result.config.apiUrl)     $('cfg-api-url').value = result.config.apiUrl;
        if (result.config.apiKey)     $('cfg-api-key').value = result.config.apiKey;
        if (result.config.model)      $('cfg-model').value = result.config.model;
    }
    updateModelBadge();
}

async function saveConfig() {
    const config = {
        tsharkPath: $('cfg-tshark-path').value.trim(),
        apiUrl: $('cfg-api-url').value.trim(),
        apiKey: $('cfg-api-key').value.trim(),
        model: $('cfg-model').value.trim()
    };
    state.aiConfig = config;
    await ipcRenderer.invoke('tshark:saveConfig', config);
    showToast('配置已保存', 'success');
    closeSettings();
    updateModelBadge();
    await checkTshark();
}

function updateModelBadge() {
    const badge = $('model-badge');
    if (!badge) return;
    const model = state.aiConfig.model;
    const hasKey = !!state.aiConfig.apiKey;
    if (model && hasKey) {
        badge.textContent = model;
        badge.title = `当前模型: ${model}（点击配置）`;
        badge.className = 'model-badge';
    } else if (model) {
        badge.textContent = model + ' · 未填 Key';
        badge.title = '已选择模型但未填写 API Key，点击配置';
        badge.className = 'model-badge unconfigured';
    } else {
        badge.textContent = '未配置模型';
        badge.title = '点击配置 AI 模型';
        badge.className = 'model-badge unconfigured';
    }
}

// ==================== 抓包控制 ====================

async function startCapture() {
    const interfaceIndex = $('interface-select').value || '1';
    const displayFilter = state.displayFilter;

    const result = await ipcRenderer.invoke('tshark:start', {
        interfaceIndex,
        displayFilter: displayFilter || undefined
    });

    if (result.success) {
        state.isCapturing = true;
        $('btn-start').disabled = true;
        $('btn-stop').disabled = false;
        $('btn-ai-diagnose').disabled = true;
        $('btn-ai-start-guide').disabled = true;
        $('tshark-status').textContent = '● 捕获中';
        $('tshark-status').className = 'status-pill capturing';
        showToast('已开始捕获，需要管理员权限', 'info');
    } else {
        showToast('启动失败: ' + result.error, 'error');
    }
}

async function stopCapture() {
    await ipcRenderer.invoke('tshark:stop');
}

function clearPackets() {
    state.packets = [];
    state.filteredPackets = [];
    state.selectedIdx = -1;
    resetStats();
    renderVList();
    updateStatPanel();
    updatePktCount();
    resetDetailBar();
    $('btn-ai-diagnose').disabled = true;
    $('btn-ai-start-guide').disabled = true;
    $('btn-export-packets').disabled = true;
    showAiGuide();
}

// ==================== 导入 PCAP ====================

async function importPcap() {
    const result = await ipcRenderer.invoke('tshark:importFile');
    if (!result.success) {
        if (result.error !== '取消') showToast('导入失败: ' + result.error, 'error');
        return;
    }
    showToast(`已加载 ${state.packets.length} 个数据包 (${result.fileName})`, 'success');
}

// ==================== 数据摄入 ====================

function ingestPackets(newPackets) {
    if (!newPackets || newPackets.length === 0) return;

    for (const pkt of newPackets) {
        state.packets.push(pkt);
        updateStats(pkt);
        if (packetMatchesFilter(pkt)) {
            state.filteredPackets.push(pkt);
        }
    }

    // 标记 UI 脏，由定时器驱动刷新（避免高流量时阻塞）
    _uiDirty = true;
    _scheduleUiRefresh();
}

/**
 * 调度 UI 刷新（固定帧率 ~15fps，参考 Wireshark 解耦策略）
 * 抓包期间由定时器驱动；停止后立即刷新一次
 */
function _scheduleUiRefresh() {
    if (_uiRefreshTimer) return;
    _uiRefreshTimer = setTimeout(_flushUi, 66);
}

function _flushUi() {
    _uiRefreshTimer = null;
    if (!_uiDirty) return;
    _uiDirty = false;

    emptyState.style.display = 'none';
    renderVList();
    updatePktCount();
    updateStatPanel();

    // 自动滚动到底部
    const container = vlistContainer;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 80) {
        container.scrollTop = container.scrollHeight;
    }
}

// ==================== Wireshark 风格显示过滤器引擎 ====================

let _compiledFilter = null;
let _compiledFilterStr = '';
let _filterIsWireshark = true;

/**
 * CIDR 子网匹配辅助
 * @private
 */
function _ipToNum(ip) {
    const p = ip.split('.');
    if (p.length !== 4) return null;
    return ((+p[0]) << 24 | (+p[1]) << 16 | (+p[2]) << 8 | (+p[3])) >>> 0;
}

function _ipMatch(ip, pattern) {
    if (!ip || !pattern) return false;
    if (pattern.includes('/')) {
        const [net, bits] = pattern.split('/');
        const ipN = _ipToNum(ip), netN = _ipToNum(net);
        if (ipN === null || netN === null) return false;
        const mask = ~(0xFFFFFFFF >>> +bits) >>> 0;
        return (ipN & mask) === (netN & mask);
    }
    return ip === pattern;
}

/**
 * 协议快捷测试表
 * @private
 */
const _PROTO = {
    'tcp':    p => { const u = (p.protocol || '').toUpperCase(); return u === 'TCP' || u === 'TLS'; },
    'udp':    p => (p.protocol || '').toUpperCase() === 'UDP',
    'dns':    p => (p.protocol || '').toUpperCase() === 'DNS' || !!p.dns,
    'arp':    p => (p.protocol || '').toUpperCase() === 'ARP' || !!p.arp,
    'icmp':   p => { const u = (p.protocol || '').toUpperCase(); return u === 'ICMP' || u === 'ICMPV6' || !!p.icmp || !!p.icmpv6; },
    'icmpv6': p => (p.protocol || '').toUpperCase() === 'ICMPV6' || !!p.icmpv6,
    'http':   p => (p.protocol || '').toUpperCase() === 'HTTP' || !!p.http,
    'tls':    p => (p.protocol || '').toUpperCase() === 'TLS' || !!p.tls,
    'ssl':    p => (p.protocol || '').toUpperCase() === 'TLS' || !!p.tls,
    'sip':    p => (p.protocol || '').toUpperCase() === 'SIP' || !!p.sip,
    'rtp':    p => (p.protocol || '').toUpperCase() === 'RTP' || !!p.rtp,
    'dhcp':   p => (p.protocol || '').toUpperCase() === 'DHCP' || !!p.dhcp,
    'esp':    p => !!p.espSpi,
    'ike':    p => !!p.ikeSpi,
    'ip':     p => !!p.srcIp,
    'ipv6':   p => p.srcIp && p.srcIp.includes(':'),
};

/**
 * 字段取值映射
 * @private
 */
function _getField(pkt, f) {
    switch (f) {
        case 'ip.src': case 'ip.src_host': return pkt.srcIp || '';
        case 'ip.dst': case 'ip.dst_host': return pkt.dstIp || '';
        case 'ip.addr': return null;
        case 'ip.ttl': return pkt.ttl || 0;
        case 'ip.id': return pkt.ipId || '';
        case 'ip.len': case 'frame.len': case 'frame.length': return pkt.length || 0;
        case 'tcp.srcport': return pkt.srcPort || 0;
        case 'tcp.dstport': return pkt.dstPort || 0;
        case 'tcp.port': case 'udp.port': case 'port': return null;
        case 'tcp.seq': return pkt.tcpSeq || 0;
        case 'tcp.ack': return pkt.tcpAck || 0;
        case 'tcp.window_size': case 'tcp.window': return pkt.tcpWindow || 0;
        case 'tcp.flags.syn': return pkt.flags.syn ? 1 : 0;
        case 'tcp.flags.ack': return pkt.flags.ack ? 1 : 0;
        case 'tcp.flags.fin': return pkt.flags.fin ? 1 : 0;
        case 'tcp.flags.reset': case 'tcp.flags.rst': return pkt.flags.reset ? 1 : 0;
        case 'tcp.flags.push': case 'tcp.flags.psh': return pkt.flags.push ? 1 : 0;
        case 'tcp.analysis.retransmission': return pkt.flags.retransmission ? 1 : 0;
        case 'tcp.analysis.out_of_order': return pkt.flags.outOfOrder ? 1 : 0;
        case 'tcp.analysis.duplicate_ack': return pkt.flags.duplicateAck ? 1 : 0;
        case 'tcp.analysis.zero_window': return pkt.flags.zeroWindow ? 1 : 0;
        case 'udp.srcport': return pkt.srcPort || 0;
        case 'udp.dstport': return pkt.dstPort || 0;
        case 'eth.src': return pkt.ethSrc || '';
        case 'eth.dst': return pkt.ethDst || '';
        case 'eth.addr': return null;
        case 'dns.qry.name': case 'dns.query': return pkt.dns ? (pkt.dns.query || '') : null;
        case 'dns.flags.rcode': case 'dns.rcode': return pkt.dns ? (pkt.dns.rcode || '0') : null;
        case 'http.request.method': return pkt.http ? (pkt.http.method || '') : null;
        case 'http.request.uri': return pkt.http ? (pkt.http.uri || '') : null;
        case 'http.response.code': return pkt.http ? (pkt.http.code || '') : null;
        case 'tls.handshake.type': return pkt.tls ? (pkt.tls.handshakeType || '') : null;
        case 'tls.record.version': return pkt.tls ? (pkt.tls.version || '') : null;
        case 'tls.alert': return pkt.tls ? (pkt.tls.alertMsg || '') : null;
        case 'icmp.type': return pkt.icmp ? pkt.icmp.type : null;
        case 'icmp.code': return pkt.icmp ? pkt.icmp.code : null;
        case 'arp.opcode': return pkt.arp ? pkt.arp.opcode : null;
        case 'arp.src.proto_ipv4': case 'arp.src.ip': return pkt.arp ? (pkt.arp.srcIp || '') : null;
        case 'arp.dst.proto_ipv4': case 'arp.dst.ip': return pkt.arp ? (pkt.arp.dstIp || '') : null;
        case 'sip.method': return pkt.sip ? (pkt.sip.method || '') : null;
        case 'sip.status': return pkt.sip ? (pkt.sip.status || '') : null;
        case 'rtp.ssrc': return pkt.rtp ? (pkt.rtp.ssrc || '') : null;
        case 'frame.info': case 'info': return pkt.info || '';
        default: return undefined;
    }
}

/**
 * 数值/字符串比较
 * @private
 */
function _cmpVals(fv, op, val) {
    const nf = Number(fv), nv = Number(val);
    if (!isNaN(nf) && !isNaN(nv) && val !== '') {
        switch (op) {
            case '==': return nf === nv;
            case '!=': return nf !== nv;
            case '>':  return nf > nv;
            case '<':  return nf < nv;
            case '>=': return nf >= nv;
            case '<=': return nf <= nv;
        }
    }
    const sf = String(fv).toLowerCase(), sv = String(val).toLowerCase();
    switch (op) {
        case '==': return sf === sv;
        case '!=': return sf !== sv;
        default:   return sf === sv;
    }
}

/**
 * 编译过滤器字符串为可执行函数
 * @param {string} input - Wireshark 风格过滤表达式
 * @returns {Function|null} 返回 (pkt) => boolean，空输入返回 null
 */
function _compileFilter(input) {
    if (!input || !input.trim()) { _filterIsWireshark = true; return null; }
    input = input.trim();

    // ---- 词法分析 ----
    const tokens = [];
    let pos = 0;
    while (pos < input.length) {
        if (/\s/.test(input[pos])) { pos++; continue; }
        if (input.startsWith('&&', pos)) { tokens.push({ t: 'AND' }); pos += 2; continue; }
        if (input.startsWith('||', pos)) { tokens.push({ t: 'OR' });  pos += 2; continue; }
        if (input.startsWith('==', pos)) { tokens.push({ t: 'OP', v: '==' }); pos += 2; continue; }
        if (input.startsWith('!=', pos)) { tokens.push({ t: 'OP', v: '!=' }); pos += 2; continue; }
        if (input.startsWith('>=', pos)) { tokens.push({ t: 'OP', v: '>=' }); pos += 2; continue; }
        if (input.startsWith('<=', pos)) { tokens.push({ t: 'OP', v: '<=' }); pos += 2; continue; }
        if (input[pos] === '>') { tokens.push({ t: 'OP', v: '>' }); pos++; continue; }
        if (input[pos] === '<') { tokens.push({ t: 'OP', v: '<' }); pos++; continue; }
        if (input[pos] === '!') { tokens.push({ t: 'NOT' }); pos++; continue; }
        if (input[pos] === '(') { tokens.push({ t: '(' }); pos++; continue; }
        if (input[pos] === ')') { tokens.push({ t: ')' }); pos++; continue; }
        if (input[pos] === '"' || input[pos] === "'") {
            const q = input[pos]; let e = input.indexOf(q, pos + 1);
            if (e === -1) e = input.length;
            tokens.push({ t: 'W', v: input.slice(pos + 1, e) }); pos = e + 1; continue;
        }
        const m = input.slice(pos).match(/^[a-zA-Z0-9_.:\/\-\*]+/);
        if (m) {
            const w = m[0], wl = w.toLowerCase();
            if (wl === 'and') tokens.push({ t: 'AND' });
            else if (wl === 'or') tokens.push({ t: 'OR' });
            else if (wl === 'not') tokens.push({ t: 'NOT' });
            else if (wl === 'contains') tokens.push({ t: 'CONT' });
            else if (wl === 'matches') tokens.push({ t: 'MATCH' });
            else tokens.push({ t: 'W', v: w });
            pos += w.length; continue;
        }
        pos++;
    }
    tokens.push({ t: 'EOF' });

    // ---- 语法分析（递归下降） ----
    let ti = 0;
    const pk = () => tokens[ti];
    const nx = () => tokens[ti++];

    function pOr() {
        let l = pAnd();
        while (pk().t === 'OR') { nx(); l = { o: '|', l, r: pAnd() }; }
        return l;
    }
    function pAnd() {
        let l = pNot();
        while (pk().t === 'AND') { nx(); l = { o: '&', l, r: pNot() }; }
        // 隐式 AND：两个表达式相邻且无运算符
        while (pk().t === 'W' || pk().t === 'NOT' || pk().t === '(') {
            l = { o: '&', l, r: pNot() };
        }
        return l;
    }
    function pNot() {
        if (pk().t === 'NOT') { nx(); return { o: '!', e: pNot() }; }
        return pPrim();
    }
    function pPrim() {
        if (pk().t === '(') { nx(); const e = pOr(); if (pk().t === ')') nx(); return e; }
        if (pk().t !== 'W') throw new Error('Unexpected: ' + pk().t);
        const w = nx();
        const field = w.v.toLowerCase();
        // 字段比较 field op value
        if (pk().t === 'OP') {
            const op = nx().v;
            if (pk().t !== 'W') throw new Error('Expected value');
            return { o: 'C', f: field, c: op, v: nx().v };
        }
        // field contains value
        if (pk().t === 'CONT') {
            nx();
            if (pk().t !== 'W') throw new Error('Expected value');
            return { o: 'S', f: field, v: nx().v };
        }
        // field matches regex
        if (pk().t === 'MATCH') {
            nx();
            if (pk().t !== 'W') throw new Error('Expected value');
            return { o: 'R', f: field, v: nx().v };
        }
        // 裸词 = 协议测试 / 字段存在测试
        return { o: 'E', f: field };
    }

    let ast;
    try {
        ast = pOr();
        _filterIsWireshark = true;
    } catch {
        // 解析失败 → 回退到简单文本搜索
        _filterIsWireshark = false;
        const lower = input.toLowerCase();
        return (pkt) => {
            const s = `${pkt.srcIp || ''} ${pkt.dstIp || ''} ${pkt.srcPort || ''} ${pkt.dstPort || ''} ${pkt.protocol || ''} ${pkt.info || ''}`.toLowerCase();
            return s.includes(lower);
        };
    }

    // ---- AST 求值 ----
    function ev(n, p) {
        switch (n.o) {
            case '&': return ev(n.l, p) && ev(n.r, p);
            case '|': return ev(n.l, p) || ev(n.r, p);
            case '!': return !ev(n.e, p);

            case 'E': {
                const test = _PROTO[n.f];
                if (test) return test(p);
                const v = _getField(p, n.f);
                return v !== null && v !== undefined && v !== '';
            }

            case 'C': {
                const { f, c, v } = n;
                // ip.addr / tcp.port 等双向匹配字段
                if (f === 'ip.addr') {
                    if (v.includes('/')) return _ipMatch(p.srcIp, v) || _ipMatch(p.dstIp, v);
                    return _cmpVals(p.srcIp || '', c, v) || _cmpVals(p.dstIp || '', c, v);
                }
                if (f === 'ip.src' && v.includes('/')) return _ipMatch(p.srcIp, v);
                if (f === 'ip.dst' && v.includes('/')) return _ipMatch(p.dstIp, v);
                if (f === 'tcp.port' || f === 'udp.port' || f === 'port') {
                    return _cmpVals(p.srcPort || 0, c, v) || _cmpVals(p.dstPort || 0, c, v);
                }
                if (f === 'eth.addr') {
                    return _cmpVals(p.ethSrc || '', c, v) || _cmpVals(p.ethDst || '', c, v);
                }
                const fv = _getField(p, f);
                if (fv === null || fv === undefined) return false;
                return _cmpVals(fv, c, v);
            }

            case 'S': {
                const { f, v } = n;
                const vl = v.toLowerCase();
                if (f === 'ip.addr') return (p.srcIp || '').toLowerCase().includes(vl) || (p.dstIp || '').toLowerCase().includes(vl);
                if (f === 'frame' || f === 'info') return (p.info || '').toLowerCase().includes(vl);
                const fv = _getField(p, f);
                return fv !== null && fv !== undefined && String(fv).toLowerCase().includes(vl);
            }

            case 'R': {
                try {
                    const re = new RegExp(n.v, 'i');
                    const fv = n.f === 'frame' || n.f === 'info' ? (p.info || '') : _getField(p, n.f);
                    return fv !== null && fv !== undefined && re.test(String(fv));
                } catch { return false; }
            }

            default: return false;
        }
    }

    return (pkt) => ev(ast, pkt);
}

/**
 * 过滤单个数据包
 */
function packetMatchesFilter(pkt) {
    if (!_compiledFilter) return true;
    try { return _compiledFilter(pkt); } catch { return true; }
}

function applyDisplayFilter() {
    const raw = state.displayFilter.trim();
    if (raw !== _compiledFilterStr) {
        _compiledFilterStr = raw;
        _compiledFilter = _compileFilter(raw);
    }
    state.filteredPackets = _compiledFilter
        ? state.packets.filter(p => packetMatchesFilter(p))
        : [...state.packets];
    state.selectedIdx = -1;
    renderVList();
    updatePktCount();
    resetDetailBar();
}

// ==================== 统计计算 ====================

function resetStats() {
    state.stats = {
        total: 0, bytes: 0, retrans: 0, rsts: 0,
        outOfOrders: 0, duplicateAcks: 0, synCount: 0,
        rttSum: 0, rttCount: 0, ttlSum: 0, ttlCount: 0,
        dnsErrors: 0, icmpUnreachable: 0,
        httpErrors: 0, tlsAlerts: 0, finCount: 0,
        zeroWindows: 0, windowFull: 0,
        largePkts: 0, smallPkts: 0, ackOnlyPkts: 0,
        synAckCount: 0,
        dnsByRcode: { nxdomain: 0, servfail: 0, refused: 0, other: 0 },
        arpRequests: 0, arpReplies: 0, arpIpMacMap: {},
        tlsAlertTypes: {},
        httpTimeSum: 0, httpTimeCount: 0,
        dhcpStats: { discover: 0, offer: 0, nak: 0, decline: 0 },
        broadcastPkts: 0, multicastPkts: 0,
        duplicateIpIds: 0, _ipIdSeen: {},
        ikeSent: 0, ikeRecv: 0, ikeErrors: 0, espPkts: 0,
        synOnlyCount: 0,
        icmpNeedFrag: 0, dfBigPkts: 0,
        clearTextPkts: 0,
        sipErrors: 0, sipMethods: {}, rtpPkts: 0, rtpSsrcs: null,
        protocols: {}, srcIps: {}, dstIps: {}, dstPorts: {},
        failedDnsNames: [],
        firstTs: 0, lastTs: 0,
        anomaly: { rst: [], retrans: [], dnsFail: [], tlsAlert: [], httpError: [], icmpUnreach: [] },
        _flowTracker: {},
        _timeBuckets: {},
        _rtpStreams: {}
    };
}

function updateStats(pkt) {
    const s = state.stats;
    s.total++;
    s.bytes += pkt.length || 0;
    if (pkt.flags.retransmission) s.retrans++;
    if (pkt.flags.reset) s.rsts++;
    if (pkt.flags.syn) s.synCount++;
    if (pkt.flags.outOfOrder) s.outOfOrders++;
    if (pkt.flags.duplicateAck) s.duplicateAcks++;
    if (pkt.rtt !== null && pkt.rtt > 0) { s.rttSum += pkt.rtt; s.rttCount++; }
    if (pkt.ttl > 0) { s.ttlSum += pkt.ttl; s.ttlCount++; }
    if (pkt.dns && pkt.dns.rcode && pkt.dns.rcode !== '0') s.dnsErrors++;
    else if (pkt.dnsRcode && pkt.dnsRcode !== '0') s.dnsErrors++;
    // ICMP 目标不可达(type=3) + ICMPv6 目标不可达(type=1)
    if (pkt.icmp && pkt.icmp.type === '3') s.icmpUnreachable++;
    if (pkt.icmpv6 && pkt.icmpv6.type === '1') s.icmpUnreachable++;
    if (pkt.http && pkt.http.code && parseInt(pkt.http.code) >= 400) s.httpErrors++;
    if (pkt.tls || (pkt.protocol && pkt.protocol.toUpperCase().startsWith('TLS'))) {
        if (pkt.info && pkt.info.toLowerCase().includes('alert')) s.tlsAlerts++;
    }
    if (pkt.flags.fin) s.finCount++;
    if (pkt.flags.synAck) s.synAckCount++;
    if (pkt.flags.zeroWindow) s.zeroWindows++;
    if (pkt.flags.windowFull) s.windowFull++;
    if ((pkt.length || 0) > 1400) s.largePkts++;
    if ((pkt.length || 0) < 100) s.smallPkts++;
    if (pkt.flags.ack && !pkt.flags.syn && !pkt.flags.fin && !pkt.flags.reset && !pkt.flags.push && (pkt.length || 0) < 60) s.ackOnlyPkts++;
    // DNS 错误类型分组
    if (pkt.dns && pkt.dns.rcode && pkt.dns.rcode !== '0') {
        const rc = pkt.dns.rcode;
        if (rc === '3')      s.dnsByRcode.nxdomain++;
        else if (rc === '2') s.dnsByRcode.servfail++;
        else if (rc === '5') s.dnsByRcode.refused++;
        else                 s.dnsByRcode.other++;
    }
    // ARP 请求/响应 + 欺骗检测
    if (pkt.arp) {
        if (pkt.arp.opcode === '1') s.arpRequests++;
        else if (pkt.arp.opcode === '2') {
            s.arpReplies++;
            // ARP 欺骗检测：同一 IP 对应多个不同 MAC
            if (pkt.arp.srcIp && pkt.arp.srcMac) {
                if (!s.arpIpMacMap[pkt.arp.srcIp]) s.arpIpMacMap[pkt.arp.srcIp] = new Set();
                s.arpIpMacMap[pkt.arp.srcIp].add(pkt.arp.srcMac.toLowerCase());
            }
        }
    }
    // 广播/多播
    if (pkt.isBroadcast) s.broadcastPkts++;
    else if (pkt.isMulticast) s.multicastPkts++;
    // 环路检测：统计 IP ID 重复出现（同一包反复绕圈）
    if (pkt.ipId && pkt.srcIp) {
        const key = `${pkt.srcIp}:${pkt.ipId}`;
        if (s._ipIdSeen[key]) {
            s.duplicateIpIds++;
        } else {
            s._ipIdSeen[key] = 1;
            if (Object.keys(s._ipIdSeen).length > 20000) s._ipIdSeen = {};
        }
    }
    // IKE/ESP (VPN)
    if (pkt.ike) {
        if (pkt.ike.isResponse) s.ikeRecv++; else s.ikeSent++;
        if (pkt.ike.notifyMsg) s.ikeErrors++;
    }
    if (pkt.esp) s.espPkts++;
    // 纯 SYN（连接发起，无ACK）
    if (pkt.flags.synOnly) s.synOnlyCount++;
    // MTU/分片
    if (pkt.isIcmpNeedFrag) s.icmpNeedFrag++;
    if (pkt.isDfBigPkt) s.dfBigPkts++;
    // 明文传输
    if (pkt.isClearText) s.clearTextPkts++;
    // SIP/RTP (VoIP)
    if (pkt.sip) {
        if (pkt.sip.method) s.sipMethods[pkt.sip.method] = (s.sipMethods[pkt.sip.method] || 0) + 1;
        if (pkt.sip.status && parseInt(pkt.sip.status) >= 400) s.sipErrors++;
    }
    if (pkt.rtp) {
        s.rtpPkts++;
        if (!s.rtpSsrcs) s.rtpSsrcs = new Set();
        s.rtpSsrcs.add(pkt.rtp.ssrc);
    }
    // TLS Alert 类型
    if (pkt.tls && pkt.tls.alertMsg) {
        const am = pkt.tls.alertMsg;
        s.tlsAlertTypes[am] = (s.tlsAlertTypes[am] || 0) + 1;
    } else if (pkt.tls || (pkt.protocol && pkt.protocol.toUpperCase().startsWith('TLS'))) {
        if (pkt.info && pkt.info.toLowerCase().includes('alert')) {
            const m = pkt.info.match(/alert[:\s]+([\w_]+)/i);
            const am = m ? m[1] : 'unknown';
            s.tlsAlertTypes[am] = (s.tlsAlertTypes[am] || 0) + 1;
        }
    }
    // HTTP 响应时间
    if (pkt.http && pkt.http.time && pkt.http.time > 0) {
        s.httpTimeSum += pkt.http.time; s.httpTimeCount++;
    }
    // DHCP 统计
    if (pkt.dhcpType) {
        if (pkt.dhcpType === '1') s.dhcpStats.discover++;
        else if (pkt.dhcpType === '2') s.dhcpStats.offer++;
        else if (pkt.dhcpType === '6') s.dhcpStats.nak++;
        else if (pkt.dhcpType === '4') s.dhcpStats.decline++;
    }
    if (pkt.protocol) s.protocols[pkt.protocol] = (s.protocols[pkt.protocol] || 0) + 1;
    if (pkt.srcIp) s.srcIps[pkt.srcIp] = (s.srcIps[pkt.srcIp] || 0) + 1;
    if (pkt.dstIp) s.dstIps[pkt.dstIp] = (s.dstIps[pkt.dstIp] || 0) + 1;
    if (pkt.dstPort && pkt.dstPort !== '0') s.dstPorts[pkt.dstPort] = (s.dstPorts[pkt.dstPort] || 0) + 1;
    // 记录 DNS 失败的域名（最多保留 10 个，去重）
    if (pkt.dns && pkt.dns.rcode && pkt.dns.rcode !== '0' && pkt.dns.name) {
        if (!s.failedDnsNames.includes(pkt.dns.name) && s.failedDnsNames.length < 10) {
            s.failedDnsNames.push(pkt.dns.name);
        }
    }
    if (pkt.timestamp) {
        if (!s.firstTs || pkt.timestamp < s.firstTs) s.firstTs = pkt.timestamp;
        if (!s.lastTs  || pkt.timestamp > s.lastTs)  s.lastTs  = pkt.timestamp;
    }

    // ==================== 异常包采集与 TCP 流追踪 ====================
    if (pkt.timestamp && s.firstTs) {
        const bIdx = Math.max(0, Math.floor((pkt.timestamp - s.firstTs) / 5));
        if (!s._timeBuckets[bIdx]) s._timeBuckets[bIdx] = { retrans: 0, rst: 0, dnsFail: 0 };
        const bkt = s._timeBuckets[bIdx];

        // TCP 流追踪（仅追踪含异常标志的流，控制内存占用）
        if (pkt.srcIp && pkt.dstIp &&
            (pkt.flags.syn || pkt.flags.reset || pkt.flags.retransmission || pkt.flags.fin)) {
            const fk = `${pkt.srcIp}:${pkt.srcPort||'?'}→${pkt.dstIp}:${pkt.dstPort||'?'}`;
            if (!s._flowTracker[fk] && Object.keys(s._flowTracker).length < 500)
                s._flowTracker[fk] = { synTs: null, synAckTs: null, rstTs: null, finTs: null, retransCount: 0 };
            const fl = s._flowTracker[fk];
            if (fl) {
                if (pkt.flags.syn && !pkt.flags.ack) fl.synTs = pkt.timestamp;
                if (pkt.flags.synAck) fl.synAckTs = pkt.timestamp;
                if (pkt.flags.fin && !fl.finTs) fl.finTs = pkt.timestamp;
                if (pkt.flags.reset && !fl.rstTs) fl.rstTs = pkt.timestamp;
                if (pkt.flags.retransmission) fl.retransCount++;
            }
        }

        // RST 包样本（记全量计数到分桶，样本最多20条）
        if (pkt.flags.reset) {
            bkt.rst++;
            if (s.anomaly.rst.length < 20)
                s.anomaly.rst.push({ t: pkt.timestamp, src: pkt.srcIp, sp: pkt.srcPort, dst: pkt.dstIp, dp: pkt.dstPort });
        }
        // 重传包样本
        if (pkt.flags.retransmission) {
            bkt.retrans++;
            if (s.anomaly.retrans.length < 20) {
                const fk2 = `${pkt.srcIp}:${pkt.srcPort||'?'}→${pkt.dstIp}:${pkt.dstPort||'?'}`;
                const attempt = s._flowTracker[fk2] ? s._flowTracker[fk2].retransCount : 1;
                s.anomaly.retrans.push({ t: pkt.timestamp, src: pkt.srcIp, dst: pkt.dstIp, dp: pkt.dstPort, n: attempt });
            }
        }
        // DNS 失败样本
        if (pkt.dns && pkt.dns.rcode && pkt.dns.rcode !== '0') {
            bkt.dnsFail++;
            if (s.anomaly.dnsFail.length < 20) {
                const rcMap = { '2': 'SERVFAIL', '3': 'NXDOMAIN', '5': 'REFUSED' };
                s.anomaly.dnsFail.push({ t: pkt.timestamp, q: pkt.dns.name || '?', rc: rcMap[pkt.dns.rcode] || `rc${pkt.dns.rcode}` });
            }
        }
        // TLS Alert 样本
        if (s.anomaly.tlsAlert.length < 15) {
            const alertMsg = pkt.tls && pkt.tls.alertMsg ? pkt.tls.alertMsg
                : (pkt.info && pkt.info.toLowerCase().includes('alert') &&
                   (pkt.tls || (pkt.protocol && pkt.protocol.toUpperCase().startsWith('TLS')))
                    ? ((pkt.info.match(/alert[:\s]+([\w_]+)/i) || [])[1] || 'unknown') : null);
            if (alertMsg)
                s.anomaly.tlsAlert.push({ t: pkt.timestamp, alert: alertMsg, src: pkt.srcIp, dst: pkt.dstIp });
        }
        // HTTP 错误样本
        if (pkt.http && pkt.http.code && parseInt(pkt.http.code) >= 400 && s.anomaly.httpError.length < 15)
            s.anomaly.httpError.push({ t: pkt.timestamp, code: pkt.http.code, uri: pkt.http.uri || '?', dst: pkt.dstIp, ms: pkt.http.time ? Math.round(pkt.http.time * 1000) : null });
        // ICMP 不可达样本
        if (pkt.icmp && pkt.icmp.type === '3' && s.anomaly.icmpUnreach.length < 10)
            s.anomaly.icmpUnreach.push({ t: pkt.timestamp, src: pkt.srcIp, dst: pkt.dstIp, code: pkt.icmp.code });

        // RTP 逐流追踪（丢包率 + 到达间隔抖动）
        if (pkt.rtp && pkt.rtp.ssrc) {
            if (!s._rtpStreams[pkt.rtp.ssrc])
                s._rtpStreams[pkt.rtp.ssrc] = { count: 0, minSeq: null, maxSeq: null, lastArrival: null, lastInterval: null, jitter: 0 };
            const rs = s._rtpStreams[pkt.rtp.ssrc];
            rs.count++;
            // 序列号追踪（用于计算丢包，处理 16 位回绕）
            const seq = parseInt(pkt.rtp.seq);
            if (!isNaN(seq)) {
                if (rs.minSeq === null || seq < rs.minSeq) rs.minSeq = seq;
                if (rs.maxSeq === null || seq > rs.maxSeq) rs.maxSeq = seq;
            }
            // RFC 3550 到达间隔抖动（使用 wall-clock ms，不依赖 RTP 时钟率）
            if (rs.lastArrival !== null) {
                const interval = (pkt.timestamp - rs.lastArrival) * 1000;
                if (rs.lastInterval !== null)
                    rs.jitter += (Math.abs(interval - rs.lastInterval) - rs.jitter) / 16;
                rs.lastInterval = interval;
            }
            rs.lastArrival = pkt.timestamp;
        }
    }
}

function rebuildStats() {
    resetStats();
    for (const pkt of state.packets) updateStats(pkt);
}

// ==================== 统计面板渲染 ====================

function updateStatPanel() {
    const s = state.stats;
    $('s-total').textContent = s.total.toLocaleString();
    $('s-bytes').textContent = formatBytes(s.bytes);
    $('s-retrans').textContent = s.retrans;
    $('s-rsts').textContent = s.rsts;

    // 扩展指标
    const avgRttMs = s.rttCount > 0 ? (s.rttSum / s.rttCount * 1000).toFixed(1) + ' ms' : '--';
    if ($('s-rtt'))        $('s-rtt').textContent = avgRttMs;
    if ($('s-ooo'))        $('s-ooo').textContent = s.outOfOrders;
    if ($('s-dup-ack'))    $('s-dup-ack').textContent = s.duplicateAcks;
    if ($('s-dns-err'))    $('s-dns-err').textContent = s.dnsErrors;
    if ($('s-icmp-unr'))   $('s-icmp-unr').textContent = s.icmpUnreachable;
    if ($('s-http-err'))   $('s-http-err').textContent = s.httpErrors;
    if ($('s-tls-alert'))  $('s-tls-alert').textContent = s.tlsAlerts;

    // 协议分布
    const protoEl = $('proto-bars');
    const sorted = Object.entries(s.protocols).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sorted.length === 0) {
        protoEl.innerHTML = '<div style="color:var(--text3);font-size:11.5px;">暂无数据</div>';
    } else {
        const maxVal = sorted[0][1];
        protoEl.innerHTML = sorted.map(([name, cnt]) => {
            const pct = s.total > 0 ? (cnt / s.total * 100).toFixed(1) : 0;
            const barW = maxVal > 0 ? (cnt / maxVal * 100).toFixed(1) : 0;
            return `<div class="proto-bar-row">
                <span class="proto-bar-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <div class="proto-bar-track"><div class="proto-bar-fill" style="width:${barW}%"></div></div>
                <span class="proto-bar-pct">${pct}%</span>
            </div>`;
        }).join('');
    }

    // Top IP
    renderTopIps('top-src-ips', s.srcIps);
    renderTopIps('top-dst-ips', s.dstIps);
}

function renderTopIps(elId, ipsObj) {
    const el = $(elId);
    const sorted = Object.entries(ipsObj).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sorted.length === 0) {
        el.innerHTML = '<div style="color:var(--text3);font-size:11.5px;">暂无数据</div>';
        return;
    }
    el.innerHTML = sorted.map(([ip, cnt]) =>
        `<div class="top-ip-item">
            <span class="top-ip-addr">${escHtml(ip)}</span>
            <span class="top-ip-count">${cnt} 包</span>
        </div>`
    ).join('');
}

// ==================== 虚拟列表渲染 ====================

function renderVList() {
    const total = state.filteredPackets.length;
    vlistSpacer.style.height = (total * ROW_H) + 'px';
    _lastPaintStart = -1; _lastPaintEnd = -1;

    if (total === 0) {
        vlistRows.innerHTML = '';
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';
    paintRows();
}

function paintRows() {
    const container = vlistContainer;
    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const total = state.filteredPackets.length;

    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
    const endIdx   = Math.min(total - 1, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

    if (startIdx === _lastPaintStart && endIdx === _lastPaintEnd) return;
    _lastPaintStart = startIdx;
    _lastPaintEnd = endIdx;

    vlistRows.style.top = (startIdx * ROW_H) + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = startIdx; i <= endIdx; i++) {
        fragment.appendChild(buildRow(state.filteredPackets[i], i));
    }
    vlistRows.innerHTML = '';
    vlistRows.appendChild(fragment);
}

function buildRow(pkt, idx) {
    const div = document.createElement('div');
    const isHttpErr = pkt.http && pkt.http.code && parseInt(pkt.http.code) >= 400;
    const isTlsAlert = pkt.info && pkt.info.toLowerCase().includes('alert') &&
        (pkt.protocol || '').toUpperCase().startsWith('TLS');
    div.className = 'pkt-row' +
        (idx === state.selectedIdx ? ' selected' : '') +
        (pkt.flags.retransmission ? ' retrans' : '') +
        (pkt.flags.reset ? ' rst' : '') +
        (isHttpErr || isTlsAlert ? ' row-warn' : '');
    div.dataset.idx = idx;

    const relTime = state.stats.firstTs > 0
        ? (pkt.timestamp - state.stats.firstTs).toFixed(4)
        : pkt.timestamp.toFixed(4);

    const displayInfo = pkt.info ||
        (pkt.srcPort && pkt.dstPort ? `${pkt.srcPort} → ${pkt.dstPort}` : '');

    const protoClass = getProtoClass(pkt.protocol);

    // ARP 包没有 IP 层，改用 ARP 层地址；如果有 MAC 就附在括号内
    const isArp = !!(pkt.arp);
    const rowSrc = isArp
        ? (pkt.arp.srcIp || '') + (pkt.arp.srcMac ? ` (${pkt.arp.srcMac})` : '')
        : (pkt.srcIp || '') + (pkt.srcPort ? ':' + pkt.srcPort : '');
    const rowDst = isArp
        ? (pkt.arp.dstIp || 'Broadcast')
        : (pkt.dstIp || '') + (pkt.dstPort ? ':' + pkt.dstPort : '');

    div.innerHTML =
        `<span class="pkt-cell no">${pkt.id}</span>` +
        `<span class="pkt-cell time">${relTime}</span>` +
        `<span class="pkt-cell" title="${escHtml(rowSrc)}">${escHtml(rowSrc)}</span>` +
        `<span class="pkt-cell" title="${escHtml(rowDst)}">${escHtml(rowDst)}</span>` +
        `<span class="pkt-cell"><span class="proto-badge ${protoClass}">${escHtml(pkt.protocol || '?')}</span></span>` +
        `<span class="pkt-cell len">${pkt.length}</span>` +
        `<span class="pkt-cell" title="${escHtml(displayInfo)}">${escHtml(displayInfo)}</span>`;

    return div;
}

function getProtoClass(proto) {
    if (!proto) return 'proto-other';
    const p = proto.toUpperCase();
    if (p === 'TCP') return 'proto-TCP';
    if (p === 'UDP') return 'proto-UDP';
    if (p === 'DNS') return 'proto-DNS';
    if (p === 'ICMP' || p === 'ICMPV6') return 'proto-ICMP';
    if (p.startsWith('TLS') || p.startsWith('SSL') || p === 'DTLS') return 'proto-TLS';
    if (p.startsWith('HTTP')) return 'proto-HTTP';
    if (p === 'ARP' || p === 'RARP') return 'proto-ARP';
    if (p === 'IGMP' || p === 'PIM' || p === 'VRRP') return 'proto-IGMP';
    if (p === 'OSPF' || p === 'EIGRP' || p === 'BGP' || p === 'RIP') return 'proto-ROUTING';
    if (p === 'GRE' || p === 'ESP' || p === 'AH' || p === 'L2TP') return 'proto-TUNNEL';
    if (p === 'SCTP') return 'proto-SCTP';
    return 'proto-other';
}

// ==================== 数据包选中 ====================

function selectPacket(idx, pkt) {
    const prev = state.selectedIdx;
    state.selectedIdx = idx;
    // 就地更新 class，不重建 DOM（保留 dblclick 事件目标）
    const rows = vlistRows.querySelectorAll('.pkt-row');
    for (const row of rows) {
        const ri = parseInt(row.dataset.idx);
        if (ri === prev) row.classList.remove('selected');
        if (ri === idx) row.classList.add('selected');
    }
    renderDetailBar(pkt);
}

/**
 * 生成 Wireshark 风格树形 HTML（供详情栏和弹窗共用）
 */
function _buildDetailHtml(pkt) {
    const relTime = state.stats.firstTs > 0
        ? (pkt.timestamp - state.stats.firstTs).toFixed(6) + 's'
        : pkt.timestamp.toFixed(6) + 's (epoch)';

    // ---- 树形构建辅助函数 ----
    const L = (key, val, cls) =>
        `<div class="pkt-tree-leaf"><span class="pkt-tree-key">${escHtml(key)}:</span>` +
        `<span class="pkt-tree-val${cls ? ' '+cls : ''}">${escHtml(String(val))}</span></div>`;

    const node = (title, cls, inner) =>
        `<details class="pkt-tree-node ${cls}" open><summary>${escHtml(title)}</summary>` +
        `<div class="pkt-tree-children">${inner}</div></details>`;

    let html = '';

    // ---- Frame ----
    let frameInner = L('序号', pkt.id);
    frameInner += L('相对时间', relTime);
    if (pkt.absTime) frameInner += L('捕获时间', pkt.absTime.replace('T', ' ').split('.')[0]);
    frameInner += L('帧长度', `${pkt.length} bytes`);
    frameInner += L('协议', pkt.protocol || '?');
    html += node(`Frame ${pkt.id}: ${pkt.length} bytes on wire`, 'node-frame', frameInner);

    // ---- Ethernet II ----
    const ethTypeMap = { arp: 'ARP (0x0806)', ipv4: 'IPv4 (0x0800)', ipv6: 'IPv6 (0x86DD)' };
    const isIpv6Global = (pkt.srcIp || '').includes(':');
    const ethType = pkt.arp ? ethTypeMap.arp : (isIpv6Global ? ethTypeMap.ipv6 : ethTypeMap.ipv4);
    let ethInner = '';
    if (pkt.ethDst) ethInner += L('Destination', pkt.ethDst);
    if (pkt.ethSrc) ethInner += L('Source', pkt.ethSrc);
    ethInner += L('Type', ethType);
    const ethSummaryDst = pkt.ethDst || (pkt.arp ? 'ff:ff:ff:ff:ff:ff' : '--');
    const ethSummaryMac = pkt.ethSrc || '--';
    html += node(`Ethernet II, Src: ${ethSummaryMac}, Dst: ${ethSummaryDst}`, 'node-eth', ethInner);

    // ---- 网络层 ----
    if (pkt.arp) {
        // ARP 无 IP 层，直接跳到 ARP 节点
    } else {
        const isIpv6 = isIpv6Global;
        const ipVer  = isIpv6 ? 'IPv6' : 'IPv4';
        const protoNames = { '1':'ICMP','2':'IGMP','6':'TCP','17':'UDP','41':'IPv6',
            '47':'GRE','50':'ESP','58':'ICMPv6','89':'OSPF' };
        let ipInner = '';
        ipInner += L('源地址', pkt.srcIp || '--');
        ipInner += L('目标地址', pkt.dstIp || '--');
        if (pkt.ttl > 0) ipInner += L('生存时间 (TTL)', pkt.ttl,
            pkt.ttl < 10 ? 'hi-danger' : pkt.ttl < 64 ? 'hi-warn' : '');
        if (pkt.ipProto) {
            const pName = protoNames[pkt.ipProto];
            ipInner += L('协议', pName ? `${pName} (${pkt.ipProto})` : pkt.ipProto);
        }
        if (pkt.ipId)  ipInner += L('标识 (ID)', pkt.ipId, 'hi-muted');
        if (pkt.ipDf)  ipInner += L('标志', 'Don\'t Fragment (DF)', 'hi-muted');
        html += node(
            `Internet Protocol ${ipVer}, Src: ${pkt.srcIp || '--'}, Dst: ${pkt.dstIp || '--'}`,
            'node-ip', ipInner);
    }

    // ---- 传输层 ----
    const isTcp = (pkt.protocol || '').toUpperCase().includes('TCP');
    const isUdp = (pkt.protocol || '').toUpperCase().includes('UDP');
    if (isTcp) {
        const flagBits = [
            ['URG', pkt.flags.urg], ['ACK', pkt.flags.ack], ['PSH', pkt.flags.push],
            ['RST', pkt.flags.reset], ['SYN', pkt.flags.syn], ['FIN', pkt.flags.fin]
        ];
        const setFlags = flagBits.filter(([,v]) => v).map(([f]) => f);
        const anomalies = [
            pkt.flags.retransmission ? '[TCP Retransmission]' : null,
            pkt.flags.outOfOrder     ? '[TCP Out-Of-Order]' : null,
            pkt.flags.duplicateAck   ? '[TCP Dup ACK]' : null
        ].filter(Boolean);
        let tcpInner = '';
        tcpInner += L('源端口', pkt.srcPort || '--');
        tcpInner += L('目标端口', pkt.dstPort || '--');
        tcpInner += L('标志位', setFlags.length ? setFlags.join(', ') : '(none)',
            pkt.flags.reset ? 'hi-danger' : '');
        if (anomalies.length) tcpInner += L('分析', anomalies.join(' '), 'hi-warn');
        if (pkt.tcpSeq !== null)  tcpInner += L('Sequence Number', pkt.tcpSeq, 'hi-muted');
        if (pkt.tcpAck !== null && pkt.flags.ack)
            tcpInner += L('Acknowledgment Number', pkt.tcpAck, 'hi-muted');
        if (pkt.tcpLen !== null && pkt.tcpLen !== '0')
            tcpInner += L('TCP Segment Len', `${pkt.tcpLen} bytes`);
        if (pkt.winSize > 0)
            tcpInner += L('Window Size', pkt.winSize.toLocaleString() + ' bytes');
        if (pkt.rtt !== null) {
            const rttMs = (pkt.rtt * 1000).toFixed(3);
            tcpInner += L('ACK RTT', `${rttMs} ms`, parseFloat(rttMs) > 100 ? 'hi-warn' : 'hi-ok');
        }
        html += node(
            `Transmission Control Protocol, Src Port: ${pkt.srcPort}, Dst Port: ${pkt.dstPort}`,
            'node-tcp', tcpInner);
    } else if (isUdp) {
        let udpInner = L('源端口', pkt.srcPort || '--') + L('目标端口', pkt.dstPort || '--');
        html += node(
            `User Datagram Protocol, Src Port: ${pkt.srcPort}, Dst Port: ${pkt.dstPort}`,
            'node-udp', udpInner);
    }

    // ---- ARP ----
    if (pkt.arp) {
        const a = pkt.arp;
        const arpOps = { '1':'request (1)', '2':'reply (2)' };
        let arpInner = '';
        arpInner += L('硬件类型', 'Ethernet (1)');
        arpInner += L('协议类型', 'IPv4 (0x0800)');
        arpInner += L('操作码 (Opcode)', arpOps[a.opcode] || `unknown (${a.opcode})`);
        if (a.srcMac) arpInner += L('Sender MAC Address', a.srcMac);
        if (a.srcIp)  arpInner += L('Sender IP Address', a.srcIp);
        arpInner += L('Target MAC Address',
            a.opcode === '1' ? '00:00:00:00:00:00 (unknown)' : (a.srcMac || '--'),
            'hi-muted');
        if (a.dstIp)  arpInner += L('Target IP Address', a.dstIp,
            a.opcode === '1' ? 'hi-warn' : 'hi-ok');
        html += node(
            `Address Resolution Protocol (${a.opcode === '1' ? 'request' : 'reply'})`,
            'node-arp', arpInner);
    }

    // ---- DNS ----
    if (pkt.dns) {
        const d = pkt.dns;
        const rcodeMap = { '0':'No error','1':'Format error','2':'Server failure',
            '3':'No such name (NXDOMAIN)','4':'Not implemented','5':'Refused' };
        const qtypeMap = { '1':'A','2':'NS','5':'CNAME','6':'SOA','12':'PTR',
            '15':'MX','16':'TXT','28':'AAAA','33':'SRV','65':'HTTPS','255':'ANY' };
        const isErr = d.rcode && d.rcode !== '0';
        let dnsInner = '';
        if (d.name)  dnsInner += L('Name', d.name);
        if (d.qtype) dnsInner += L('Type', qtypeMap[d.qtype] || `TYPE${d.qtype}`);
        if (d.rcode !== null) dnsInner += L('Response Code',
            rcodeMap[d.rcode] || `RCODE=${d.rcode}`, isErr ? 'hi-danger' : 'hi-ok');
        if (d.a)     dnsInner += L('Address', d.a, 'hi-ok');
        html += node(
            `Domain Name System (${d.rcode === undefined ? 'query' : (isErr ? 'response — ERROR' : 'response')})`,
            'node-dns', dnsInner);
    }

    // ---- ICMP ----
    if (pkt.icmp) {
        const ic = pkt.icmp;
        const icmpTypes = {
            '0':'Echo (ping) reply','3':'Destination Unreachable','5':'Redirect',
            '8':'Echo (ping) request','11':'Time to live exceeded','12':'Parameter Problem'
        };
        const unreachCodes = {
            '0':'Network unreachable','1':'Host unreachable','2':'Protocol unreachable',
            '3':'Port unreachable','4':'Fragmentation needed'
        };
        const isUnreach = ic.type === '3' || ic.type === '11';
        let icmpInner = '';
        icmpInner += L('类型 (Type)', `${ic.type} — ${icmpTypes[ic.type] || 'Unknown'}`,
            isUnreach ? 'hi-danger' : '');
        if (ic.code) icmpInner += L('代码 (Code)',
            ic.type === '3' ? (unreachCodes[ic.code] || `Code ${ic.code}`) : `Code ${ic.code}`);
        if (ic.ident) icmpInner += L('Identifier', ic.ident, 'hi-muted');
        if (ic.seq)   icmpInner += L('Sequence Number', ic.seq, 'hi-muted');
        html += node(`Internet Control Message Protocol`, 'node-icmp', icmpInner);
    }

    // ---- ICMPv6 ----
    if (pkt.icmpv6) {
        const ic6 = pkt.icmpv6;
        const icmpv6Types = {
            '1':'Destination Unreachable','2':'Packet Too Big','3':'Time Exceeded',
            '4':'Parameter Problem','128':'Echo (ping) Request','129':'Echo (ping) Reply',
            '133':'Router Solicitation','134':'Router Advertisement',
            '135':'Neighbor Solicitation','136':'Neighbor Advertisement'
        };
        const isErr6 = ic6.type === '1' || ic6.type === '3';
        let ic6Inner = '';
        ic6Inner += L('类型 (Type)', `${ic6.type} — ${icmpv6Types[ic6.type] || 'Unknown'}`,
            isErr6 ? 'hi-danger' : '');
        if (ic6.code) ic6Inner += L('代码 (Code)', ic6.code);
        html += node(`Internet Control Message Protocol v6`, 'node-icmpv6', ic6Inner);
    }

    // ---- HTTP ----
    if (pkt.http) {
        const h = pkt.http;
        const isErr = h.code && parseInt(h.code) >= 400;
        let httpInner = '';
        if (h.method) httpInner += L('Request Method', h.method);
        if (h.uri)    httpInner += L('Request URI', h.uri.length > 100 ? h.uri.substring(0, 100) + '…' : h.uri);
        if (h.code)   httpInner += L('Response Code', h.code, isErr ? 'hi-danger' : 'hi-ok');
        html += node(`Hypertext Transfer Protocol`, 'node-http', httpInner);
    }

    // ---- TLS ----
    if (pkt.tls) {
        const t = pkt.tls;
        const hsTypes = {
            '1':'Client Hello','2':'Server Hello','4':'New Session Ticket',
            '8':'Encrypted Extensions','11':'Certificate','12':'Server Key Exchange',
            '13':'Certificate Request','14':'Server Hello Done',
            '15':'Certificate Verify','16':'Client Key Exchange','20':'Finished'
        };
        let tlsInner = '';
        if (t.handshakeType) tlsInner += L('Handshake Type',
            `${hsTypes[t.handshakeType] || 'Unknown'} (${t.handshakeType})`);
        if (pkt.info && pkt.info.toLowerCase().includes('alert'))
            tlsInner += L('Alert', pkt.info.substring(0, 80), 'hi-danger');
        html += node(`Transport Layer Security`, 'node-tls', tlsInner);
    }

    // ---- Info 行（始终最后一行）----
    const displayInfo = pkt.info || (pkt.srcPort && pkt.dstPort ? `${pkt.srcPort} → ${pkt.dstPort}` : '--');
    html += `<div class="pkt-tree-leaf" style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px;">` +
        `<span class="pkt-tree-key">Info:</span>` +
        `<span class="pkt-tree-val" style="color:var(--text2)">${escHtml(displayInfo)}</span></div>`;

    return html;
}

function renderDetailBar(pkt) {
    const _dispSrc = pkt.srcIp || (pkt.arp && pkt.arp.srcIp) || '--';
    const _dispDst = pkt.dstIp || (pkt.arp && pkt.arp.dstIp) || '--';
    $('detail-summary').textContent =
        `#${pkt.id}  ${pkt.protocol}  ${_dispSrc}${pkt.srcPort ? ':'+pkt.srcPort : ''} → ${_dispDst}${pkt.dstPort ? ':'+pkt.dstPort : ''}  ${pkt.length} 字节`;
    $('detail-inner').innerHTML = `<div class="pkt-tree">${_buildDetailHtml(pkt)}</div>`;
    if (!$('detail-content').classList.contains('open')) toggleDetailBar();
}

function openPacketModal(pkt) {
    const _dispSrc = pkt.srcIp || (pkt.arp && pkt.arp.srcIp) || '--';
    const _dispDst = pkt.dstIp || (pkt.arp && pkt.arp.dstIp) || '--';
    const title = `#${pkt.id}  ${pkt.protocol}  ${_dispSrc}${pkt.srcPort ? ':'+pkt.srcPort : ''} → ${_dispDst}${pkt.dstPort ? ':'+pkt.dstPort : ''}  ${pkt.length} 字节`;
    $('pkt-modal-title').textContent = title;
    $('pkt-modal-inner').innerHTML = _buildDetailHtml(pkt);
    $('pkt-modal-overlay').classList.add('show');
}

function resetDetailBar() {
    $('detail-summary').textContent = '选择一个数据包查看详情';
    $('detail-inner').innerHTML = '<span style="color:var(--text3);font-size:12px;">暂无选中数据包</span>';
}

function toggleDetailBar() {
    const content = $('detail-content');
    const arrow = $('detail-arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
}

// ==================== 统计序列化（IPC 传输用） ====================

function _serializeStats() {
    const s = state.stats;
    const duration = s.lastTs > s.firstTs ? s.lastTs - s.firstTs : 0;
    const serialized = { ...s, duration, totalBytes: s.bytes,
        avgTtl: s.ttlCount > 0 ? s.ttlSum / s.ttlCount : null };
    // Set 对象无法通过 IPC 结构化克隆序列化
    serialized.rtpSsrcCount = s.rtpSsrcs ? s.rtpSsrcs.size : 0;
    delete serialized.rtpSsrcs;
    // arpIpMacMap 中的 Set 转为数组
    if (s.arpIpMacMap) {
        const map = {};
        for (const [ip, macs] of Object.entries(s.arpIpMacMap)) {
            map[ip] = macs instanceof Set ? [...macs] : (Array.isArray(macs) ? macs : []);
        }
        serialized.arpIpMacMap = map;
    }
    // 排除内部追踪对象（体积大且无需传输）
    delete serialized._ipIdSeen;

    // 导出异常流（RST 或重传≥2 次的流，按重传次数降序，最多 30 条）
    serialized.anomalousFlows = Object.entries(s._flowTracker || {})
        .filter(([, fl]) => fl.rstTs || fl.retransCount >= 2)
        .sort((a, b) => b[1].retransCount - a[1].retransCount)
        .slice(0, 30)
        .map(([key, fl]) => ({ key, ...fl }));
    // 时间分桶：过滤空桶，按时间顺序导出
    serialized.timeBuckets = Object.entries(s._timeBuckets || {})
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .filter(([, b]) => b.retrans > 0 || b.rst > 0 || b.dnsFail > 0)
        .map(([idx, b]) => ({ label: `T+${parseInt(idx) * 5}-${parseInt(idx) * 5 + 5}s`, ...b }));
    delete serialized._flowTracker;
    delete serialized._timeBuckets;

    // RTP 逐流统计：丢包率 + 抖动（按包数降序，最多 20 路）
    serialized.rtpStreamStats = Object.entries(s._rtpStreams || {})
        .map(([ssrc, rs]) => {
            // RTP seq 是 16 位，最大 65535，处理回绕（简单取 min～max 范围）
            const range = rs.maxSeq !== null && rs.minSeq !== null
                ? Math.min(rs.maxSeq - rs.minSeq + 1, 65536) : 0;
            const lossRate = range > 1
                ? Math.max(0, (range - rs.count) / range * 100) : 0;
            return { ssrc, pkts: rs.count, lossRate: lossRate.toFixed(1), jitterMs: rs.jitter.toFixed(1) };
        })
        .filter(rs => rs.pkts > 0)
        .sort((a, b) => b.pkts - a.pkts)
        .slice(0, 20);
    delete serialized._rtpStreams;

    return serialized;
}

// ==================== AI 诊断 ====================

async function runAiDiagnosis() {
    if (state.packets.length === 0) {
        showToast('请先采集数据包', 'error');
        return;
    }
    if (!state.aiConfig.apiKey) {
        showToast('请先在设置中填写 API Key', 'error');
        openSettings();
        return;
    }

    // 切换到 AI 标签
    switchTab('ai');
    showAiLoading();

    // 动态更新步骤
    setTimeout(() => { setStep(2); }, 800);
    setTimeout(() => { setStep(3); }, 1800);

    const result = await ipcRenderer.invoke('tshark:aiDiagnose', {
        stats: _serializeStats(),
        packetCount: state.packets.length,
        config: {
            apiUrl: state.aiConfig.apiUrl || '',
            apiKey: state.aiConfig.apiKey || '',
            model: state.aiConfig.model || 'gpt-3.5-turbo'
        }
    });

    if (!result.success) {
        hideAiLoading();
        showToast('AI 诊断失败: ' + result.error, 'error');
        showAiGuide();
        return;
    }

    state.diagnosis = result.result;
    hideAiLoading();
    renderDiagnosisResult(result.result);
}

function setStep(n) {
    for (let i = 1; i <= 3; i++) {
        const el = $(`step-${i}`);
        if (!el) continue;
        el.className = 'ai-step' + (i < n ? ' done' : i === n ? ' active' : '');
    }
}

function showAiGuide() {
    $('ai-guide').style.display = 'flex';
    $('ai-loading').classList.remove('show');
    $('ai-result').classList.remove('show');
}

let _aiElapsedTimer = null;

function showAiLoading() {
    $('ai-guide').style.display = 'none';
    $('ai-loading').classList.add('show');
    $('ai-result').classList.remove('show');
    setStep(1);
    _fillLoadingSummary();
    // 实时计时
    let sec = 0;
    const el = $('ai-elapsed');
    if (el) el.textContent = '已等待 0 秒...';
    clearInterval(_aiElapsedTimer);
    _aiElapsedTimer = setInterval(() => {
        sec++;
        if (el) el.textContent = `已等待 ${sec} 秒...`;
    }, 1000);
}

function _fillLoadingSummary() {
    const s = state.stats;
    const dur = s.lastTs > s.firstTs ? (s.lastTs - s.firstTs) : 0;
    const durStr = dur > 60 ? `${(dur / 60).toFixed(1)}min` : `${dur.toFixed(1)}s`;
    const bytesStr = s.bytes > 1048576
        ? `${(s.bytes / 1048576).toFixed(1)} MB`
        : `${(s.bytes / 1024).toFixed(1)} KB`;
    const protoCount = Object.keys(s.protocols || {}).length;
    const topProto = Object.entries(s.protocols || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p).join(', ') || '-';
    const uniqueIps = new Set([
        ...Object.keys(s.srcIps || {}),
        ...Object.keys(s.dstIps || {})
    ]).size;

    const el = $('ai-loading-summary');
    if (!el) return;
    el.innerHTML = `
        <div class="ai-summary-title">📊 待分析数据摘要</div>
        <div class="ai-summary-grid">
            <div class="ai-summary-item"><span class="ai-summary-label">数据包</span><span class="ai-summary-val">${state.packets.length.toLocaleString()}</span></div>
            <div class="ai-summary-item"><span class="ai-summary-label">持续时间</span><span class="ai-summary-val">${durStr}</span></div>
            <div class="ai-summary-item"><span class="ai-summary-label">数据量</span><span class="ai-summary-val">${bytesStr}</span></div>
            <div class="ai-summary-item"><span class="ai-summary-label">独立 IP</span><span class="ai-summary-val">${uniqueIps}</span></div>
            <div class="ai-summary-item"><span class="ai-summary-label">协议种类</span><span class="ai-summary-val">${protoCount}</span></div>
            <div class="ai-summary-item"><span class="ai-summary-label">主要协议</span><span class="ai-summary-val">${escHtml(topProto)}</span></div>
            ${s.retrans > 0 ? `<div class="ai-summary-item"><span class="ai-summary-label">重传包</span><span class="ai-summary-val" style="color:var(--warning)">${s.retrans}</span></div>` : ''}
            ${s.dnsErrors > 0 ? `<div class="ai-summary-item"><span class="ai-summary-label">DNS 错误</span><span class="ai-summary-val" style="color:var(--danger)">${s.dnsErrors}</span></div>` : ''}
        </div>`;
}

function hideAiLoading() {
    clearInterval(_aiElapsedTimer);
    _aiElapsedTimer = null;
    $('ai-loading').classList.remove('show');
}

function renderDiagnosisResult(diag) {
    // 防御：若后端解析失败，summary 可能是完整 JSON 字符串，尝试二次解析
    if ((!diag.overall_status || diag.health_score === 0) && (diag._raw || diag.summary)) {
        const raw = (diag._raw || diag.summary || '').trim();
        if (raw.includes('"health_score"') || raw.includes('"overall_status"') || raw.trimStart().startsWith('{')) {
            const cleanRaw = (s) => s
                .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/g, '')
                .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
                .replace(/，/g, ',').replace(/：/g, ':')
                .replace(/,(\s*[}\]])/g, '$1').trim();
            try {
                const m = cleanRaw(raw).match(/\{[\s\S]*\}/);
                if (m) {
                    const reparsed = JSON.parse(cleanRaw(m[0]));
                    if (reparsed && reparsed.health_score !== undefined) diag = reparsed;
                }
            } catch (_) {}
        }
        // 仍失败：提示原始响应前100字符
        if (!diag.overall_status || diag.health_score === 0) {
            const preview = raw.substring(0, 100).replace(/\n/g, ' ');
            if (preview.length > 10) showToast('AI 响应: ' + preview + '…', 'info');
        }
    }

    $('ai-guide').style.display = 'none';
    $('ai-loading').classList.remove('show');
    $('ai-result').classList.add('show');

    const score = Math.max(0, Math.min(100, diag.health_score || 0));
    $('score-text').textContent = score;
    $('score-summary').textContent = diag.summary || '诊断完成';

    // 颜色 & 标题
    const ringFill = $('score-ring-fill');
    const circumference = 170;
    const offset = circumference - (score / 100 * circumference);
    const overallStatus = diag.overall_status || (score >= 80 ? 'normal' : score >= 60 ? 'warning' : 'critical');
    if (overallStatus === 'normal')   { ringFill.style.stroke = '#10b981'; $('score-title').textContent = '网络状态正常'; }
    else if (overallStatus === 'warning') { ringFill.style.stroke = '#f59e0b'; $('score-title').textContent = '网络存在问题'; }
    else                              { ringFill.style.stroke = '#ef4444'; $('score-title').textContent = '网络状况严重'; }
    setTimeout(() => { ringFill.style.strokeDashoffset = offset; }, 100);

    // 总体结论横幅
    const conclusionEl = $('diag-conclusion');
    if (conclusionEl) {
        const statusMap = { normal: { cls: 'conclusion-ok', icon: '✓', label: '网络正常' },
            warning: { cls: 'conclusion-warn', icon: '⚠', label: '存在问题' },
            critical: { cls: 'conclusion-crit', icon: '✗', label: '严重异常' } };
        const st = statusMap[overallStatus] || statusMap.warning;
        conclusionEl.innerHTML = `<div class="conclusion-banner ${st.cls}">` +
            `<span class="conclusion-icon">${st.icon}</span>` +
            `<span class="conclusion-label">${st.label}</span></div>` +
            (diag.conclusion ? `<div class="conclusion-text">${escHtml(diag.conclusion)}</div>` : '');
    }

    // 维度评分
    const dimsEl = $('diag-dimensions');
    if (dimsEl && diag.dimensions) {
        const dimNames = { connectivity:'连接质量', performance:'性能表现', application:'应用层', dns:'DNS健康', security:'安全状况' };
        const dimIcons = { connectivity:'⬡', performance:'⚡', application:'◈', dns:'⬡', security:'⊕' };
        const stColors = { normal:'#10b981', warning:'#f59e0b', critical:'#ef4444' };
        dimsEl.innerHTML = Object.entries(diag.dimensions).map(([key, dim]) => {
            const s = Math.max(0, Math.min(100, dim.score || 0));
            const color = stColors[dim.status] || stColors.normal;
            return `<div class="dim-item">
                <div class="dim-header">
                    <span class="dim-name">${dimNames[key] || key}</span>
                    <span class="dim-score" style="color:${color}">${s}</span>
                </div>
                <div class="dim-bar-track">
                    <div class="dim-bar-fill" style="width:${s}%;background:${color}"></div>
                </div>
            </div>`;
        }).join('');
    }

    // 严重程度分布
    const issues = diag.issues || [];
    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    issues.forEach(issue => { if (sevCounts[issue.severity] !== undefined) sevCounts[issue.severity]++; });
    const maxSev = Math.max(1, ...Object.values(sevCounts));
    ['critical', 'high', 'medium', 'low'].forEach(k => {
        $(`sev-${k}`).style.width = (sevCounts[k] / maxSev * 100) + '%';
        $(`sev-${k[0]}-count`).textContent = sevCounts[k];
    });

    // 故障清单
    const issuesList = $('issues-list');
    if (issues.length === 0) {
        issuesList.innerHTML = '<div class="no-issues">✓ 未发现明显网络故障</div>';
    } else {
        const sevLabel = { critical: '严重', high: '高危', medium: '中危', low: '低危' };
        issuesList.innerHTML = issues.map((issue, i) => `
            <div class="issue-item">
                <div class="issue-header">
                    <span class="severity-badge severity-${escHtml(issue.severity || 'low')}">${sevLabel[issue.severity] || issue.severity || 'low'}</span>
                    <span class="issue-title">${i + 1}. ${escHtml(issue.title || '')}</span>
                </div>
                <div class="issue-desc">${escHtml(issue.description || '')}</div>
                ${(issue.metric_value || issue.threshold) ? `<div class="issue-metrics">
                    ${issue.metric_value ? `<span class="metric-val">实测: ${escHtml(issue.metric_value)}</span>` : ''}
                    ${issue.threshold ? `<span class="metric-threshold">阈值: ${escHtml(issue.threshold)}</span>` : ''}
                </div>` : ''}
                ${issue.evidence ? `<div class="issue-evidence">依据: ${escHtml(issue.evidence)}</div>` : ''}
            </div>`).join('');
    }

    // 修复建议
    const recs = diag.recommendations || [];
    const recsList = $('recs-list');
    // 将多步骤文字拆成有序列表：先按换行拆，再识别 "N. " 开头
    const fmtAction = (text) => {
        if (!text) return '';
        const escaped = escHtml(text);
        // 已有换行符的直接转 br
        if (escaped.includes('\n')) {
            return escaped.split('\n').filter(l => l.trim()).map(l => `<div class="rec-step">${l}</div>`).join('');
        }
        // 无换行：将 " 1. " / " 2. " 等拆分（允许中文句号）
        const parts = escaped.split(/(?=\s*\d+[.、．]\s)/);
        if (parts.length > 1) {
            return parts.filter(p => p.trim()).map(p => `<div class="rec-step">${p.trim()}</div>`).join('');
        }
        return `<div class="rec-step">${escaped}</div>`;
    };
    if (recs.length === 0) {
        recsList.innerHTML = '<div class="no-issues">暂无修复建议</div>';
    } else {
        const prioLabel = { high: '高', medium: '中', low: '低' };
        recsList.innerHTML = recs.map((rec, i) => `
            <div class="rec-item">
                <div class="rec-header">
                    <span class="rec-priority-badge rec-priority-${escHtml(rec.priority || 'low')}">${prioLabel[rec.priority] || rec.priority || 'low'}</span>
                    <span class="rec-title">${i + 1}. ${escHtml(rec.title || '')}</span>
                </div>
                <div class="rec-action">${fmtAction(rec.action)}</div>
                ${rec.expected_effect ? `<div class="rec-effect">预期效果: ${escHtml(rec.expected_effect)}</div>` : ''}
            </div>`).join('');
    }
}

// ==================== 数据包导出 ====================

async function exportPacketsCsv() {
    if (state.packets.length === 0) { showToast('暂无数据包', 'error'); return; }
    const result = await ipcRenderer.invoke('tshark:exportCsv', { packets: state.packets });
    if (result.success) showToast(`CSV 已导出（${state.packets.length} 个包）`, 'success');
    else if (result.error !== '取消') showToast('导出失败: ' + result.error, 'error');
}

async function exportPacketsJson() {
    if (state.packets.length === 0) { showToast('暂无数据包', 'error'); return; }
    const result = await ipcRenderer.invoke('tshark:exportJson', { packets: state.packets });
    if (result.success) showToast(`JSON 已导出（${state.packets.length} 个包）`, 'success');
    else if (result.error !== '取消') showToast('导出失败: ' + result.error, 'error');
}

async function exportPacketsPcap() {
    const result = await ipcRenderer.invoke('tshark:exportPcap');
    if (result.success) showToast('PCAP 已导出', 'success');
    else if (result.error !== '取消') showToast(result.error, 'error');
}

// ==================== 报告导出 ====================

async function exportMarkdown() {
    if (!state.diagnosis) { showToast('请先运行 AI 诊断', 'error'); return; }
    const result = await ipcRenderer.invoke('tshark:exportMarkdown', {
        diagnosis: state.diagnosis,
        stats: _serializeStats(),
        packetCount: state.packets.length
    });
    if (result.success) showToast('Markdown 报告已导出', 'success');
    else if (result.error !== '取消') showToast('导出失败: ' + result.error, 'error');
}

async function exportPdf() {
    if (!state.diagnosis) { showToast('请先运行 AI 诊断', 'error'); return; }
    showToast('正在生成 PDF...', 'info');
    const htmlContent = buildPdfHtml(state.diagnosis);
    const result = await ipcRenderer.invoke('tshark:exportPdf', { htmlContent });
    if (result.success) showToast('PDF 报告已导出', 'success');
    else if (result.error !== '取消') showToast('导出失败: ' + result.error, 'error');
}

function buildPdfHtml(diag) {
    const score = Math.max(0, Math.min(100, diag.health_score || 0));
    const now = new Date().toLocaleString('zh-CN');
    const sevColor = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#16a34a' };

    const issuesHtml = (diag.issues || []).map(i => `
        <div style="margin-bottom:10px;padding:10px;border:1px solid #e2e8f0;border-left:4px solid ${sevColor[i.severity]||'#94a3b8'};border-radius:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:#1e293b">${escHtml(i.title||'')}</strong>
                <span style="font-size:11px;padding:2px 8px;background:${sevColor[i.severity]||'#94a3b8'}22;color:${sevColor[i.severity]||'#94a3b8'};border-radius:10px;">${i.severity}</span>
            </div>
            <p style="font-size:12px;color:#475569">${escHtml(i.description||'')}</p>
            ${i.evidence ? `<p style="font-size:11px;color:#94a3b8;margin-top:4px;font-style:italic">依据：${escHtml(i.evidence)}</p>` : ''}
        </div>`).join('');

    const recsHtml = (diag.recommendations || []).map((r, i) => `
        <div style="margin-bottom:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
            <strong style="color:#1e293b">${i+1}. ${escHtml(r.title||'')}</strong>
            <p style="font-size:12px;color:#475569;margin-top:4px">${escHtml(r.action||'')}</p>
        </div>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;color:#1e293b;max-width:800px;margin:0 auto}
h1{font-size:22px;color:#0f172a;margin-bottom:4px}h2{font-size:15px;margin:20px 0 10px;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
.score-box{display:flex;align-items:center;gap:16px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:20px}
.score-num{font-size:40px;font-weight:700;color:${score>=80?'#10b981':score>=60?'#f59e0b':'#ef4444'}}
.meta{font-size:12px;color:#94a3b8;margin-bottom:20px}
</style></head><body>
<h1>网络诊断报告</h1><div class="meta">生成时间：${now} &nbsp;|&nbsp; 数据包：${state.packets.length}</div>
<div class="score-box">
  <div class="score-num">${score}</div>
  <div><strong>${score>=80?'网络状态良好':score>=60?'网络存在问题':'网络状况较差'}</strong><p style="font-size:13px;color:#475569;margin-top:4px">${escHtml(diag.summary||'')}</p></div>
</div>
<h2>故障清单</h2>${issuesHtml||'<p style="color:#94a3b8">未发现明显故障</p>'}
<h2>修复建议</h2>${recsHtml||'<p style="color:#94a3b8">暂无建议</p>'}
<p style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center">由 NetTools TsharkAnalyzer 生成</p>
</body></html>`;
}

// ==================== 设置面板 - tshark 环境检测 ====================

async function checkTsharkInSettings() {
    const icon   = $('env-icon');
    const label  = $('env-label');
    const detail = $('env-detail');
    const ver    = $('env-version');
    const customPath = ($('cfg-tshark-path').value || '').trim();

    icon.className = 'env-icon checking';
    icon.textContent = '↻';
    label.textContent = '检测中...';
    detail.textContent = '正在执行 tshark --version，请稍候';
    ver.style.display = 'none';

    const result = await ipcRenderer.invoke('tshark:checkVersion', customPath || undefined);

    const warn = $('env-warn');
    if (result.found) {
        const majorVer = parseInt((result.version || '0').split('.')[0], 10);
        icon.textContent = '✓';
        label.textContent = 'tshark 就绪';
        detail.textContent = result.path;
        ver.style.display = 'block';
        ver.textContent = 'v' + result.version;
        if (customPath) $('cfg-tshark-path').value = result.path;

        if (majorVer < 3) {
            icon.className = 'env-icon fail';
            warn.className = 'env-warn critical';
            warn.style.display = 'block';
            warn.textContent = '⚠ 版本过低（< 3.0）：TLS 字段名不兼容（旧版使用 ssl.* 前缀），TLS 握手失败、Alert 检测将全部失效。强烈建议升级至 Wireshark 4.x。';
            showToast('tshark 版本过低（< 3.0），部分检测功能不可用', 'error');
        } else if (majorVer < 4) {
            icon.className = 'env-icon ok';
            warn.className = 'env-warn';
            warn.style.display = 'block';
            warn.textContent = '⚠ 版本 3.x 可用，但建议升级至 4.x 以获得最佳兼容性。';
            showToast('tshark v' + result.version + ' 检测通过（建议升级至 4.x）', 'success');
        } else {
            icon.className = 'env-icon ok';
            warn.style.display = 'none';
            showToast('tshark v' + result.version + ' 检测通过', 'success');
        }
    } else {
        icon.className = 'env-icon fail';
        icon.textContent = '✗';
        label.textContent = '未找到 tshark';
        detail.textContent = result.error || '请安装 Wireshark 或手动指定路径';
        ver.style.display = 'none';
        warn.className = 'env-warn critical';
        warn.style.display = 'block';
        warn.textContent = '需要 tshark ≥ 3.0（推荐 4.x）。安装 Wireshark 时会自动附带 tshark.exe。';
        showToast('未找到 tshark，请安装 Wireshark', 'error');
    }
}

async function browseTsharkPath() {
    const result = await ipcRenderer.invoke('tshark:browseTshark');
    if (!result.canceled) {
        $('cfg-tshark-path').value = result.path;
        await checkTsharkInSettings();
    }
}

function openWiresharkDownload() {
    ipcRenderer.invoke('shell:openExternal', 'https://www.wireshark.org/download.html');
}

// ==================== 设置面板 ====================

function openSettings() {
    $('settings-overlay').classList.add('show');
    updatePresetHighlight();
}

function updatePresetHighlight() {
    const url = ($('cfg-api-url').value || '').toLowerCase();
    const PRESET_KEYS = {
        deepseek: 'deepseek.com',
        mimo:     'xiaomimimo.com',
        openai:   'api.openai.com'
    };
    document.querySelectorAll('.preset-btn').forEach(btn => {
        const keyword = PRESET_KEYS[btn.dataset.preset];
        btn.classList.toggle('active', !!keyword && url.includes(keyword));
    });
}

function closeSettings() {
    $('settings-overlay').classList.remove('show');
}

// ==================== 标签页切换 ====================

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + tabId);
    });
}

// ==================== 更新数量 ====================

function updatePktCount() {
    $('pkt-count').textContent = `共 ${state.packets.length} 个包 · 显示 ${state.filteredPackets.length}`;
    const hasData = state.packets.length > 0;
    $('btn-ai-diagnose').disabled = !hasData;
    $('btn-ai-start-guide').disabled = !hasData;
    $('btn-export-packets').disabled = !hasData;
    if (hasData) updateStatPanel();
}

// ==================== IPC 事件监听 ====================

function bindIpcEvents() {
    // 接收批量数据包
    ipcRenderer.on('tshark:packets', (event, packets) => {
        ingestPackets(packets);
    });

    ipcRenderer.on('tshark:importStart', () => {
        clearPackets();
        showToast('正在解析文件...', 'info');
    });

    ipcRenderer.on('tshark:stopped', (event, info) => {
        const wasCapturing = state.isCapturing;
        state.isCapturing = false;
        $('btn-start').disabled = false;
        $('btn-stop').disabled = true;
        if (state.tsharkVersion) {
            $('tshark-status').textContent = '✓ tshark ' + state.tsharkVersion;
        } else {
            $('tshark-status').textContent = '✓ tshark 就绪';
        }
        $('tshark-status').className = 'status-pill ready';
        // 停止时立即刷新 UI（不等定时器）
        if (_uiDirty) _flushUi();
        updatePktCount();

        const code = info && info.code !== undefined ? info.code : 0;
        if (wasCapturing && state.packets.length === 0 && code !== 0) {
            // 启动后立刻退出且无数据 → 大概率权限或接口问题
            showToast(`抓包异常退出 (退出码 ${code})，请以管理员身份运行或检查接口选择`, 'error');
        } else {
            showToast(`捕获已停止，共 ${state.packets.length} 个数据包`, 'info');
        }
    });

    ipcRenderer.on('tshark:error', (event, msg) => {
        const text = String(msg).trim();
        // 正常的 tshark 进度信息，不显示
        if (!text) return;
        if (text.includes('Capturing on') || text.includes('packets captured')) return;

        // 权限类错误
        if (text.toLowerCase().includes('permission') ||
            text.toLowerCase().includes('access denied') ||
            text.includes('Run as root') ||
            text.includes('The capture session could not be initiated')) {
            showToast('权限不足：请以管理员身份运行，或在 Npcap 安装时勾选"允许非特权用户抓包"', 'error');
            return;
        }
        // 接口不存在
        if (text.includes('No such device') || text.includes('not found') ||
            text.includes('Invalid interface')) {
            showToast('接口无效：请重新选择网卡', 'error');
            return;
        }
        // 其他错误：截取前120字符显示
        showToast('tshark: ' + text.substring(0, 120), 'error');
    });

    ipcRenderer.on('tshark:configChanged', () => {
        loadConfig();
    });
}

// ==================== UI 事件绑定 ====================

function bindUIEvents() {
    $('btn-start').addEventListener('click', startCapture);
    $('btn-stop').addEventListener('click', stopCapture);
    $('btn-clear').addEventListener('click', clearPackets);
    $('btn-import').addEventListener('click', importPcap);
    $('btn-ai-diagnose').addEventListener('click', runAiDiagnosis);
    $('btn-ai-start-guide').addEventListener('click', runAiDiagnosis);
    $('btn-settings').addEventListener('click', openSettings);
    $('model-badge').addEventListener('click', openSettings);
    $('btn-save-config').addEventListener('click', saveConfig);
    $('btn-close-settings').addEventListener('click', closeSettings);
    $('btn-check-tshark-env').addEventListener('click', checkTsharkInSettings);
    $('btn-browse-tshark').addEventListener('click', browseTsharkPath);
    $('btn-download-wireshark').addEventListener('click', openWiresharkDownload);

    // 服务商预置快选
    const PRESETS = {
        deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
        mimo:     {
            url: 'https://token-plan-cn.xiaomimimo.com/v1',
            model: 'mimo-v2.5-pro',
            tip: '已填入 MiMo 套餐版（中国集群）。套餐 Key 格式 tp-xxxxx；按量付费 Key 格式 sk-xxxxx（需手动填写对应 Base URL）。认证头根据 Key 前缀自动识别。'
        },
        openai:   { url: 'https://api.openai.com',   model: 'gpt-4o' }
    };
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = PRESETS[btn.dataset.preset];
            if (!preset) return;
            if (preset.url) $('cfg-api-url').value = preset.url;
            $('cfg-model').value = preset.model;
            updatePresetHighlight();
            if (preset.tip) showToast(preset.tip, 'info');
            else showToast(`已填入 ${btn.textContent} 配置，请填写 API Key 后保存`, 'info');
        });
    });
    $('btn-export-md').addEventListener('click', exportMarkdown);
    $('btn-export-pdf').addEventListener('click', exportPdf);
    $('detail-bar').addEventListener('click', toggleDetailBar);

    // 导出下拉菜单
    $('btn-export-packets').addEventListener('click', (e) => {
        e.stopPropagation();
        $('export-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', () => $('export-dropdown').classList.remove('open'));
    $('export-dropdown-menu').addEventListener('click', (e) => e.stopPropagation());
    $('btn-export-csv').addEventListener('click',  () => { $('export-dropdown').classList.remove('open'); exportPacketsCsv(); });
    $('btn-export-json').addEventListener('click', () => { $('export-dropdown').classList.remove('open'); exportPacketsJson(); });
    $('btn-export-pcap').addEventListener('click', () => { $('export-dropdown').classList.remove('open'); exportPacketsPcap(); });

    // 数据包详情弹窗
    $('pkt-modal-close').addEventListener('click', () => $('pkt-modal-overlay').classList.remove('show'));
    $('pkt-modal-overlay').addEventListener('click', (e) => {
        if (e.target === $('pkt-modal-overlay')) $('pkt-modal-overlay').classList.remove('show');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') $('pkt-modal-overlay').classList.remove('show');
    });

    // 标签页
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 显示过滤器（防抖 + Wireshark 语法验证）
    let filterTimer = null;
    const filterInput = $('display-filter');
    filterInput.addEventListener('input', (e) => {
        state.displayFilter = e.target.value.trim();
        clearTimeout(filterTimer);
        // 预编译并更新视觉状态
        _compiledFilterStr = state.displayFilter;
        _compiledFilter = _compileFilter(state.displayFilter);
        filterInput.classList.remove('filter-valid', 'filter-fallback');
        if (state.displayFilter) {
            filterInput.classList.add(_filterIsWireshark ? 'filter-valid' : 'filter-fallback');
        }
        filterTimer = setTimeout(applyDisplayFilter, 300);
    });

    // 虚拟列表滚动
    vlistContainer.addEventListener('scroll', () => { paintRows(); }, { passive: true });

    // 虚拟列表事件委托（避免每行绑定监听器）
    vlistRows.addEventListener('click', (e) => {
        const row = e.target.closest('.pkt-row');
        if (!row) return;
        const idx = parseInt(row.dataset.idx);
        const pkt = state.filteredPackets[idx];
        if (pkt) selectPacket(idx, pkt);
    });
    vlistRows.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.pkt-row');
        if (!row) return;
        const idx = parseInt(row.dataset.idx);
        const pkt = state.filteredPackets[idx];
        if (pkt) openPacketModal(pkt);
    });

    // 窗口大小变化
    window.addEventListener('resize', () => { _lastPaintStart = -1; _lastPaintEnd = -1; paintRows(); });
}

// ==================== 工具函数 ====================

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function showToast(msg, type = 'info') {
    const container = $('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}
