/**
 * DNS Lookup 工具渲染进程
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

// ==================== 常量 ====================

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR'];

const DEFAULT_TYPES = new Set(['A', 'AAAA', 'NS', 'MX', 'TXT']);

const PRESET_SERVERS = [
    { name: 'Cloudflare', host: '1.1.1.1', transport: 'udp', tcp: true, dot: '1.1.1.1', doh: 'https://cloudflare-dns.com/dns-query' },
    { name: 'Google', host: '8.8.8.8', transport: 'udp', tcp: true, dot: '8.8.8.8', doh: 'https://dns.google/dns-query' },
    { name: 'Quad9', host: '9.9.9.9', transport: 'udp', tcp: true, dot: 'dns.quad9.net', doh: 'https://dns.quad9.net/dns-query' },
    { name: 'OpenDNS', host: '208.67.222.222', transport: 'udp', tcp: true },
    { name: '阿里 AliDNS', host: '223.5.5.5', transport: 'udp', tcp: true, dot: 'dns.alidns.com', doh: 'https://dns.alidns.com/dns-query' },
    { name: '腾讯 DNSPod', host: '119.29.29.29', transport: 'udp', tcp: true, dot: 'dot.pub', doh: 'https://doh.pub/dns-query' },
    { name: '114DNS', host: '114.114.114.114', transport: 'udp', tcp: true },
    { name: '360 安全', host: '101.226.4.6', transport: 'udp', tcp: true, doh: 'https://doh.360.cn/dns-query' }
];

// ==================== 工具函数 ====================

function $(id) { return document.getElementById(id); }

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtTtl(t) {
    if (t == null) return '--';
    if (t < 60) return `${t}s`;
    if (t < 3600) return `${Math.floor(t / 60)}m${t % 60 ? (t % 60) + 's' : ''}`;
    if (t < 86400) return `${Math.floor(t / 3600)}h`;
    return `${Math.floor(t / 86400)}d`;
}

function setStatus(el, kind, text) {
    if (!el) return;
    el.style.display = '';
    const dot = el.querySelector('.status-dot');
    const t = el.querySelector('.status-text');
    // kind: '' | 'connecting' | 'online' | 'error'
    dot.className = 'status-dot ' + (kind || '');
    t.textContent = text;
}

/**
 * 根据当前选择的传输协议，构造服务器参数
 */
function buildServerForTransport(srv, transport) {
    switch (transport) {
        case 'udp':
        case 'tcp':
            return { host: srv.host, port: 53, name: srv.name };
        case 'dot':
            if (!srv.dot) return null;
            return { host: srv.dot, port: 853, name: srv.name };
        case 'doh':
            if (!srv.doh) return null;
            return { url: srv.doh, name: srv.name };
        default:
            return null;
    }
}

// ==================== Tab 切换 ====================

document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const t = btn.dataset.tab;
        document.querySelector(`.panel[data-panel="${t}"]`).classList.add('active');
    });
});

// ==================== 初始化 ====================

function initSingleTab() {
    // 服务器下拉
    const select = $('single-server-select');
    PRESET_SERVERS.forEach((srv, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${srv.name} (${srv.host})`;
        select.appendChild(opt);
    });

    // 类型 chips
    const chipsEl = $('single-type-chips');
    RECORD_TYPES.forEach(type => {
        const c = document.createElement('div');
        c.className = 'chip' + (DEFAULT_TYPES.has(type) ? ' selected' : '');
        c.textContent = type;
        c.dataset.type = type;
        c.addEventListener('click', () => c.classList.toggle('selected'));
        chipsEl.appendChild(c);
    });

    // 域名预设
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.addEventListener('click', () => { $('single-domain').value = b.dataset.domain; });
    });

    // 传输协议变更时禁用某些服务器（如选 DoH 但服务器不支持）
    $('single-transport').addEventListener('change', updateSingleServerOptions);
    updateSingleServerOptions();

    $('single-query-btn').addEventListener('click', runSingleQuery);
    $('single-clear-btn').addEventListener('click', () => {
        $('single-results').innerHTML = '';
        $('single-status').style.display = 'none';
    });
}

function updateSingleServerOptions() {
    const transport = $('single-transport').value;
    const select = $('single-server-select');
    [...select.options].forEach((opt, i) => {
        const srv = PRESET_SERVERS[i];
        if (!srv) return;
        let supports = true;
        if (transport === 'dot') supports = !!srv.dot;
        else if (transport === 'doh') supports = !!srv.doh;
        opt.disabled = !supports;
        opt.textContent = `${srv.name} (${srv.host})${supports ? '' : ' — 不支持'}`;
    });
    // 若当前选中不支持，切换到第一个支持的
    if (select.selectedOptions[0]?.disabled) {
        const first = [...select.options].find(o => !o.disabled);
        if (first) select.value = first.value;
    }
}

function initCompareTab() {
    const list = $('compare-server-list');
    PRESET_SERVERS.forEach((srv, idx) => {
        // 为每种支持的传输协议各生成一项
        const protocols = ['udp'];
        if (srv.tcp) protocols.push('tcp');
        if (srv.dot) protocols.push('dot');
        if (srv.doh) protocols.push('doh');

        protocols.forEach(p => {
            const item = document.createElement('label');
            item.className = 'server-item';
            const checked = (p === 'udp' && idx < 4) ? 'checked' : '';
            const meta = p === 'doh' ? (srv.doh || '') : (p === 'dot' ? (srv.dot || srv.host) : srv.host);
            item.innerHTML = `
                <input type="checkbox" data-idx="${idx}" data-proto="${p}" ${checked}>
                <div class="si-info">
                    <span class="si-name">${esc(srv.name)}<span class="badge ${p}">${p}</span></span>
                    <span class="si-meta">${esc(meta)}</span>
                </div>
            `;
            const cb = item.querySelector('input');
            cb.addEventListener('change', () => item.classList.toggle('selected', cb.checked));
            if (checked) item.classList.add('selected');
            list.appendChild(item);
        });
    });

    $('compare-query-btn').addEventListener('click', runCompareQuery);

    // 点击参数卡标题切换折叠
    $('compare-params-toggle').addEventListener('click', () => {
        $('compare-params-card').classList.toggle('collapsed');
    });

    $('compare-select-all').addEventListener('click', () => {
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
            cb.closest('.server-item').classList.add('selected');
        });
    });
    $('compare-clear-sel').addEventListener('click', () => {
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
            cb.closest('.server-item').classList.remove('selected');
        });
    });
}

function initTraceTab() {
    $('trace-start-btn').addEventListener('click', runTrace);
    $('trace-stop-btn').addEventListener('click', () => {
        ipcRenderer.invoke('dns:trace-abort');
    });
}

// ==================== 单次查询 ====================

async function runSingleQuery() {
    const domain = $('single-domain').value.trim();
    if (!domain) {
        setStatus($('single-status'), 'error', '请输入域名');
        return;
    }
    const types = [...document.querySelectorAll('#single-type-chips .chip.selected')].map(c => c.dataset.type);
    if (types.length === 0) {
        setStatus($('single-status'), 'error', '请至少选择一种记录类型');
        return;
    }
    const srvIdx = parseInt($('single-server-select').value, 10);
    const transport = $('single-transport').value;
    const srv = PRESET_SERVERS[srvIdx];
    const serverParam = buildServerForTransport(srv, transport);
    if (!serverParam) {
        setStatus($('single-status'), 'error', `服务器 ${srv.name} 不支持 ${transport.toUpperCase()}`);
        return;
    }
    const timeout = parseInt($('single-timeout').value, 10) || 5000;

    $('single-query-btn').disabled = true;
    $('single-results').innerHTML = '';
    setStatus($('single-status'), 'connecting', `查询中 (${srv.name} / ${transport.toUpperCase()})...`);

    try {
        const r = await ipcRenderer.invoke('dns:query', {
            domain, types, server: serverParam, transport, timeout
        });
        if (!r.success) {
            setStatus($('single-status'), 'error', '失败: ' + (r.error || ''));
        } else {
            renderSingleResults(domain, srv, transport, r.results);
            setStatus($('single-status'), 'online', `完成：查询了 ${r.results.length} 种类型`);
        }
    } catch (e) {
        setStatus($('single-status'), 'error', '异常: ' + e.message);
    } finally {
        $('single-query-btn').disabled = false;
    }
}

function renderSingleResults(domain, srv, transport, results) {
    const out = $('single-results');
    out.innerHTML = '';
    for (const r of results) {
        const card = document.createElement('div');
        card.className = 'result-block';

        if (r.error) {
            card.innerHTML = `
                <div class="result-head">
                    <div class="rh-left">
                        <span class="badge">${esc(r.type)}</span>
                        <span class="domain">${esc(domain)}</span>
                    </div>
                    <div class="rh-right">
                        <span class="badge ${esc(transport)}">${esc(transport)}</span>
                        ${r.time != null ? '· ' + r.time + ' ms' : ''}
                    </div>
                </div>
                <div class="result-body">
                    <table class="records"><tbody><tr class="error-row"><td>错误: ${esc(r.error)}</td></tr></tbody></table>
                </div>
            `;
            out.appendChild(card);
            continue;
        }

        const totalAns = (r.answers || []).length;
        const rcodeClass = r.rcode === 0 ? 'rcode-ok' : 'rcode-error';
        card.innerHTML = `
            <div class="result-head">
                <div class="rh-left">
                    <span class="badge">${esc(r.type)}</span>
                    <span class="domain">${esc(domain)}</span>
                </div>
                <div class="rh-right">
                    <span class="${rcodeClass}">${esc(r.rcodeName)}</span>
                    · ${totalAns} 条 · ${r.time} ms
                    · <span class="badge ${esc(transport)}">${esc(transport)}</span>
                </div>
            </div>
            <div class="result-body">
                ${renderRecordsTable(r.answers)}
            </div>
        `;
        out.appendChild(card);
    }
}

function renderRecordsTable(records) {
    if (!records || records.length === 0) {
        return `<table class="records"><tbody><tr class="empty-row"><td>无应答记录</td></tr></tbody></table>`;
    }
    return `
        <table class="records">
            <thead>
                <tr>
                    <th style="width: 70px;">类型</th>
                    <th style="width: 90px;">TTL</th>
                    <th>RDATA</th>
                </tr>
            </thead>
            <tbody>
                ${records.map(rr => `
                    <tr>
                        <td class="col-type">${esc(rr.typeName)}</td>
                        <td class="col-ttl">${fmtTtl(rr.ttl)}</td>
                        <td class="col-data">${esc(rr.text)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ==================== 多服务器对比 ====================

async function runCompareQuery() {
    const domain = $('compare-domain').value.trim();
    if (!domain) {
        setStatus($('compare-status'), 'error', '请输入域名');
        return;
    }
    const type = $('compare-type').value;
    const checks = [...document.querySelectorAll('#compare-server-list input[type="checkbox"]:checked')];
    if (checks.length === 0) {
        setStatus($('compare-status'), 'error', '请至少选择一个服务器');
        return;
    }
    const timeout = parseInt($('compare-timeout').value, 10) || 5000;

    const servers = checks.map(cb => {
        const idx = parseInt(cb.dataset.idx, 10);
        const proto = cb.dataset.proto;
        const srv = PRESET_SERVERS[idx];
        const built = buildServerForTransport(srv, proto);
        return built ? { ...built, transport: proto } : null;
    }).filter(s => s);

    if (servers.length === 0) {
        setStatus($('compare-status'), 'error', '所选服务器均不支持对应传输协议');
        return;
    }

    $('compare-query-btn').disabled = true;
    $('compare-result-wrap').style.display = 'none';
    $('compare-inconsistent').style.display = 'none';
    setStatus($('compare-status'), 'connecting', `对比中（${servers.length} 个服务器）...`);

    try {
        const r = await ipcRenderer.invoke('dns:multi-query', { domain, type, servers, timeout });
        if (!r.success) {
            setStatus($('compare-status'), 'error', '失败: ' + (r.error || ''));
        } else {
            renderCompareResults(domain, type, r.results, r.inconsistent);
            setStatus($('compare-status'), r.inconsistent ? 'error' : 'online',
                r.inconsistent ? '检测到不一致的应答（可能存在污染/分流）' : '所有服务器应答一致');
            // 查询成功后自动折叠参数卡，并显示参数摘要
            setCompareParamsSummary(domain, type, servers.length);
            $('compare-params-card').classList.add('collapsed');
        }
    } catch (e) {
        setStatus($('compare-status'), 'error', '异常: ' + e.message);
    } finally {
        $('compare-query-btn').disabled = false;
    }
}

function setCompareParamsSummary(domain, type, count) {
    $('compare-params-summary').innerHTML = `
        <span class="sep">·</span>${esc(domain)}
        <span class="sep">·</span><span style="color: var(--primary); font-weight: 600;">${esc(type)}</span>
        <span class="sep">·</span>${count} 个服务器
    `;
}

function renderCompareResults(domain, type, results, inconsistent) {
    $('compare-result-wrap').style.display = '';
    $('compare-result-type').textContent = type;
    $('compare-result-domain').textContent = domain;

    const banner = $('compare-inconsistent');
    if (inconsistent) {
        banner.style.display = '';
        banner.className = 'inconsistent';
        banner.innerHTML = `
            <span class="inconsistent-icon">!</span>
            <div>检测到不同 DNS 服务器返回了 <strong>不一致的应答</strong>。可能原因：DNS 污染、运营商劫持、GeoDNS 分流或缓存不同步。</div>
        `;
    } else {
        banner.style.display = 'none';
    }

    const tbody = $('compare-tbody');
    tbody.innerHTML = results.map(r => {
        const srv = r.server || {};
        const proto = srv.transport || '';
        const addr = srv.url || `${srv.host || ''}${srv.port ? ':' + srv.port : ''}`;
        if (r.error) {
            return `
                <tr>
                    <td>
                        <div class="server-cell">
                            <span class="sc-name">${esc(srv.name || '--')}<span class="badge ${esc(proto)}">${esc(proto)}</span></span>
                            <span class="sc-addr">${esc(addr)}</span>
                        </div>
                    </td>
                    <td><span class="rcode-error">ERR</span></td>
                    <td style="color: var(--err-color);">${esc(r.error)}</td>
                    <td class="time-cell">${r.time != null ? r.time + ' ms' : '--'}</td>
                </tr>
            `;
        }
        const rcodeClass = r.rcode === 0 ? 'rcode-ok' : 'rcode-error';
        const answers = r.answers || [];
        return `
            <tr>
                <td>
                    <div class="server-cell">
                        <span class="sc-name">${esc(srv.name || '--')}<span class="badge ${esc(proto)}">${esc(proto)}</span></span>
                        <span class="sc-addr">${esc(addr)}</span>
                    </div>
                </td>
                <td><span class="${rcodeClass}">${esc(r.rcodeName)}</span></td>
                <td>
                    ${answers.length === 0
                        ? '<span class="text-muted" style="font-style: italic;">无应答</span>'
                        : '<div class="answers-cell">' + answers.map(a => `
                            <div class="answer-line">
                                <span class="type-mini">${esc(a.typeName)}</span>
                                <span>${esc(a.text)}</span>
                                <span class="ttl-mini">TTL ${fmtTtl(a.ttl)}</span>
                            </div>
                        `).join('') + '</div>'
                    }
                </td>
                <td class="time-cell">${r.time} ms</td>
            </tr>
        `;
    }).join('');
}

// ==================== 递归追踪 ====================

let traceStepCount = 0;

async function runTrace() {
    const domain = $('trace-domain').value.trim();
    if (!domain) {
        setStatus($('trace-status'), 'error', '请输入域名');
        return;
    }
    const type = $('trace-type').value;
    const timeout = parseInt($('trace-timeout').value, 10) || 5000;

    traceStepCount = 0;
    $('trace-steps').innerHTML = '';
    $('trace-start-btn').disabled = true;
    $('trace-stop-btn').disabled = false;
    setStatus($('trace-status'), 'connecting', `追踪 ${domain} (${type}) ...`);

    try {
        const r = await ipcRenderer.invoke('dns:trace', { domain, type, timeout });
        if (!r.success) {
            setStatus($('trace-status'), 'error', '失败: ' + (r.error || ''));
        } else {
            setStatus($('trace-status'), 'online', `追踪完成，共 ${r.steps.length} 步`);
        }
    } catch (e) {
        setStatus($('trace-status'), 'error', '异常: ' + e.message);
    } finally {
        $('trace-start-btn').disabled = false;
        $('trace-stop-btn').disabled = true;
    }
}

ipcRenderer.on('dns:trace-step', (_, step) => {
    appendTraceStep(step);
});

function appendTraceStep(step) {
    traceStepCount++;
    const div = document.createElement('div');
    div.className = 'trace-step' + (step.final ? ' final' : '') + (step.error ? ' error' : '');

    const dotLabel = step.error ? '!' : (step.final ? '✓' : String(step.depth + 1));

    if (step.error) {
        div.innerHTML = `
            <div class="trace-dot">${dotLabel}</div>
            <div class="trace-card">
                <div class="trace-head">
                    <span class="th-label">第 ${step.depth + 1} 步 · 失败</span>
                </div>
                <div class="trace-body" style="color: var(--err-color);">
                    ${esc(step.error)}
                    ${step.candidates ? '<div class="trace-section" style="margin-top:6px;"><span class="trace-sect-title">候选服务器</span>' +
                        step.candidates.map(c => `<div class="trace-rr"><span class="rr-type">NS</span><span class="rr-ttl">--</span><span class="rr-data">${esc(c.name || '')} ${c.host ? '(' + esc(c.host) + ')' : '(未解析)'}</span></div>`).join('') + '</div>'
                        : ''}
                </div>
            </div>
        `;
        $('trace-steps').appendChild(div);
        scrollTraceToBottom();
        return;
    }

    const srv = step.server || {};
    const labelTxt = step.depth === 0 ? '根服务器' : (step.final ? '权威服务器' : `中间服务器 (第 ${step.depth + 1} 跳)`);

    const renderRRs = (arr) => {
        if (!arr || arr.length === 0) return '<div class="trace-rr" style="color: var(--text-muted); font-style: italic;"><span></span><span></span><span>(空)</span></div>';
        return arr.map(rr => `
            <div class="trace-rr">
                <span class="rr-type">${esc(rr.typeName)}</span>
                <span class="rr-ttl">${fmtTtl(rr.ttl)}</span>
                <span class="rr-data">${esc(rr.name)} → ${esc(rr.text)}</span>
            </div>
        `).join('');
    };

    div.innerHTML = `
        <div class="trace-dot">${dotLabel}</div>
        <div class="trace-card">
            <div class="trace-head">
                <div>
                    <span class="th-label">${labelTxt}</span>
                    <span class="th-server">${esc(srv.name || '')} (${esc(srv.host || '')})</span>
                </div>
                <div class="th-meta">
                    ${esc(step.rcodeName)} · ${step.time} ms${step.aa ? ' · AA' : ''}
                </div>
            </div>
            <div class="trace-body">
                ${(step.answers && step.answers.length) ? `
                    <div class="trace-section">
                        <span class="trace-sect-title">应答 (Answer)</span>
                        ${renderRRs(step.answers)}
                    </div>` : ''}
                ${(step.authorities && step.authorities.length) ? `
                    <div class="trace-section">
                        <span class="trace-sect-title">权威/委派 (Authority)</span>
                        ${renderRRs(step.authorities)}
                    </div>` : ''}
                ${(step.additionals && step.additionals.length) ? `
                    <div class="trace-section">
                        <span class="trace-sect-title">附加 (Additional / Glue)</span>
                        ${renderRRs(step.additionals)}
                    </div>` : ''}
            </div>
        </div>
    `;
    $('trace-steps').appendChild(div);
    scrollTraceToBottom();
}

function scrollTraceToBottom() {
    const wrap = $('trace-steps');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

// ==================== 启动 ====================

initSingleTab();
initCompareTab();
initTraceTab();
