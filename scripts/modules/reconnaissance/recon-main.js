/**
 * 资产勘测 (Asset Reconnaissance) 渲染进程模块
 */

// 当前查看的子工具视图ID
let activeReconView = null;

// FOFA 缓存数据
let fofaSearchResults = [];
// 域名爆破缓存数据
let subdomainResults = [];
// 指纹识别缓存数据
let fingerprintResults = [];

/**
 * 初始化页面主入口
 */
async function initReconnaissancePage() {
    // 默认展示仪表盘，隐藏其它子视图
    _showView(null);
    
    // 加载配置
    await _loadFofaConfig();
}

/**
 * 切换子工具视图
 * @private
 */
function _showView(viewId) {
    activeReconView = viewId;
    
    const dashboard = document.getElementById('recon-dashboard');
    const backBtn = document.getElementById('btn-recon-back');
    const titleEl = document.getElementById('recon-page-title');
    
    // 获取全部视图 section
    const views = {
        'fingerprint': document.getElementById('recon-view-fingerprint'),
        'subdomain': document.getElementById('recon-view-subdomain'),
        'fofa': document.getElementById('recon-view-fofa'),
        'snmp': document.getElementById('recon-view-snmp')
    };

    if (viewId === null) {
        // 展示仪表盘
        dashboard.style.display = 'block';
        backBtn.style.display = 'none';
        titleEl.textContent = '资产勘测';
        
        // 隐藏所有子工具视图
        Object.values(views).forEach(v => v.style.display = 'none');
    } else {
        // 展示子工具
        dashboard.style.display = 'none';
        backBtn.style.display = 'inline-flex';
        
        // 调整页面标题
        if (viewId === 'fingerprint') titleEl.textContent = 'Web 指纹识别';
        if (viewId === 'subdomain') titleEl.textContent = '域名爆破';
        if (viewId === 'fofa') titleEl.textContent = '空间测绘 (FOFA)';
        if (viewId === 'snmp') titleEl.textContent = 'SNMP 接口诊断';
        
        // 显隐具体视图
        Object.keys(views).forEach(key => {
            views[key].style.display = (key === viewId) ? 'flex' : 'none';
        });
    }
}

/**
 * 加载并填充 FOFA 配置
 * @private
 */
async function _loadFofaConfig() {
    try {
        const config = await window.api.reconnaissance.getConfig();
        if (config) {
            const emailInput = document.getElementById('fofa-config-email');
            const keyInput = document.getElementById('fofa-config-key');
            if (emailInput) emailInput.value = config.fofaEmail || '';
            if (keyInput) keyInput.value = config.fofaKey || '';
        }
    } catch (e) {
        console.error('加载 FOFA 配置失败:', e);
    }
}

/**
 * CSV 导出通用实现
 */
function _exportToCsv(filename, headers, rows) {
    if (rows.length === 0) {
        showToast('暂无数据可导出', 'warning');
        return;
    }

    // 处理逗号和双引号
    const formatCell = (val) => {
        if (val === null || val === undefined) return '';
        let str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(formatCell).join(','))
    ].join('\n');

    // 加上 BOM 字节以解决 Excel 中文乱码问题
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('数据已成功导出', 'success');
}

// ==================== FOFA 功能 ====================

/**
 * 执行 FOFA 查询
 */
async function runFofaSearch() {
    const query = document.getElementById('recon-ff-query').value.trim();
    const size = parseInt(document.getElementById('recon-ff-size').value, 10) || 100;
    
    if (!query) {
        showToast('请输入查询语句', 'warning');
        return;
    }

    const searchBtn = document.getElementById('btn-recon-ff-start');
    const tableBody = document.getElementById('recon-ff-table-body');
    const titleEl = document.getElementById('recon-ff-results-title');

    searchBtn.disabled = true;
    searchBtn.textContent = '查询中...';
    tableBody.innerHTML = `<tr><td colspan="7" class="recon-results-empty">正在向 FOFA 服务器检索，请稍候...</td></tr>`;
    fofaSearchResults = [];

    try {
        const res = await window.api.reconnaissance.fofaSearch({ query, size });
        if (res.success) {
            fofaSearchResults = res.results || [];
            titleEl.textContent = `检索结果 (共 ${res.total} 条记录，当前加载 ${fofaSearchResults.length} 条)`;
            
            if (fofaSearchResults.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="recon-results-empty">未匹配到任何资产</td></tr>`;
            } else {
                tableBody.innerHTML = fofaSearchResults.map(item => `
                    <tr>
                        <td>${escapeHtml(item.host)}</td>
                        <td>${escapeHtml(item.ip)}</td>
                        <td>${escapeHtml(item.port)}</td>
                        <td>${escapeHtml(item.protocol)}</td>
                        <td>${escapeHtml(item.title || '-')}</td>
                        <td>${escapeHtml(item.server || '-')}</td>
                        <td>${escapeHtml(item.country)}</td>
                    </tr>
                `).join('');
            }
        } else {
            showToast(res.error, 'error');
            tableBody.innerHTML = `<tr><td colspan="7" class="recon-results-empty" style="color: var(--danger-color); font-weight: 500;">查询失败: ${escapeHtml(res.error)}</td></tr>`;
        }
    } catch (e) {
        showToast('网络请求异常: ' + e.message, 'error');
        tableBody.innerHTML = `<tr><td colspan="7" class="recon-results-empty" style="color: var(--danger-color);">查询发生错误: ${escapeHtml(e.message)}</td></tr>`;
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = '查询';
    }
}

// ==================== 域名爆破 功能 ====================

/**
 * 开始域名爆破
 */
async function startSubdomainScan() {
    const domain = document.getElementById('recon-sd-domain').value.trim();
    const concurrency = parseInt(document.getElementById('recon-sd-concurrency').value, 10) || 20;

    if (!domain) {
        showToast('请输入目标主域名', 'warning');
        return;
    }

    // 格式校验
    if (!/^[a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+$/.test(domain)) {
        showToast('无效的主域名格式', 'warning');
        return;
    }

    const startBtn = document.getElementById('btn-recon-sd-start');
    const stopBtn = document.getElementById('btn-recon-sd-stop');
    const scanContainer = document.getElementById('recon-sd-scan-container');
    const radarSweep = document.getElementById('recon-sd-radar-sweep');
    const scanText = document.getElementById('recon-sd-scan-text');
    const scanDetail = document.getElementById('recon-sd-scan-detail');
    const tableBody = document.getElementById('recon-sd-table-body');

    // UI 锁定
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-flex';
    scanContainer.classList.add('scanning');
    scanContainer.style.display = 'flex';
    radarSweep.style.display = 'block';
    
    scanText.textContent = `子域名爆破进行中... [${domain}]`;
    scanDetail.textContent = '进度: 0% (已完成: 0 / 0)';
    
    tableBody.innerHTML = `<tr><td colspan="3" class="recon-results-empty">正在枚举并解析 DNS，请稍候...</td></tr>`;
    subdomainResults = [];

    // 进度监听
    window.api.reconnaissance.removeSubdomainListeners();
    window.api.reconnaissance.onSubdomainProgress(({ current, total, newResolved }) => {
        const percent = Math.round((current / total) * 100);
        scanDetail.textContent = `进度: ${percent}% (已完成: ${current} / ${total})`;
        
        if (newResolved && newResolved.length > 0) {
            // 如果是首次插入，清空“暂无”行
            if (subdomainResults.length === 0) {
                tableBody.innerHTML = '';
            }
            newResolved.forEach(item => {
                subdomainResults.push(item);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(item.subdomain)}</td>
                    <td>${escapeHtml(item.ips.join(', '))}</td>
                    <td><span class="badge-resolved">解析成功</span></td>
                `;
                tableBody.appendChild(tr);
            });
        }
    });

    try {
        const res = await window.api.reconnaissance.startSubdomain({ domain, concurrency });
        if (res.success) {
            showToast('域名爆破任务完成', 'success');
            scanText.textContent = '爆破扫描完成';
            scanDetail.textContent = `共枚举 ${res.total || 200} 次，发现 ${subdomainResults.length} 个存活子域名`;
        }
    } catch (e) {
        showToast('爆破任务中断或异常', 'error');
    } finally {
        // 恢复 UI
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        scanContainer.classList.remove('scanning');
        radarSweep.style.display = 'none';
        window.api.reconnaissance.removeSubdomainListeners();
    }
}

/**
 * 停止域名爆破
 */
async function stopSubdomainScan() {
    await window.api.reconnaissance.stopSubdomain();
    showToast('正在停止任务...', 'info');
}

// ==================== Web 指纹识别 功能 ====================

/**
 * 开始指纹识别
 */
async function startFingerprintScan() {
    const targets = document.getElementById('recon-fg-targets').value.trim();
    const concurrency = parseInt(document.getElementById('recon-fg-concurrency').value, 10) || 5;

    if (!targets) {
        showToast('请输入需要探测的目标地址', 'warning');
        return;
    }

    const startBtn = document.getElementById('btn-recon-fg-start');
    const stopBtn = document.getElementById('btn-recon-fg-stop');
    const scanContainer = document.getElementById('recon-fg-scan-container');
    const progressFill = document.getElementById('recon-fg-progress-fill');
    const progressText = document.getElementById('recon-fg-progress-text');
    const scanText = document.getElementById('recon-fg-scan-text');
    const scanDetail = document.getElementById('recon-fg-scan-detail');
    const tableBody = document.getElementById('recon-fg-table-body');

    // UI 锁定
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-flex';
    scanContainer.classList.add('scanning');
    scanContainer.style.display = 'flex';
    
    // 重置进度环 (BOM 周长约为 502.65)
    progressFill.style.strokeDashoffset = '502.65';
    progressText.textContent = '0%';
    scanText.textContent = '正在发起 Web 服务指纹识别探测...';
    scanDetail.textContent = '已完成: 0 / 0';
    
    tableBody.innerHTML = `<tr><td colspan="5" class="recon-results-empty">正在爬取站点 Headers 并解析指纹规则...</td></tr>`;
    fingerprintResults = [];

    // 进度监听
    window.api.reconnaissance.removeFingerprintListeners();
    window.api.reconnaissance.onFingerprintProgress(({ current, total, newResults }) => {
        const percent = Math.round((current / total) * 100);
        progressText.textContent = `${percent}%`;
        
        // 环状 SVG 进度填充
        const offset = 502.65 * (1 - current / total);
        progressFill.style.strokeDashoffset = offset;
        scanDetail.textContent = `已完成: ${current} / ${total}`;

        if (newResults && newResults.length > 0) {
            if (fingerprintResults.length === 0) {
                tableBody.innerHTML = '';
            }
            newResults.forEach(item => {
                fingerprintResults.push(item);
                const tr = document.createElement('tr');
                
                // 渲染指纹
                const fingerBadges = item.fingerprints.map(f => `<span class="badge-fingerprint">${escapeHtml(f)}</span>`).join('');
                
                // 区分状态配色
                const statusColor = item.status === 'offline/timeout' ? 'var(--text-muted)' : (item.status >= 400 ? 'var(--warning-color)' : 'var(--success-color)');
                
                tr.innerHTML = `
                    <td style="font-family: monospace;">${escapeHtml(item.url)}</td>
                    <td style="color: ${statusColor}; font-weight: 600;">${escapeHtml(item.status)}</td>
                    <td>${escapeHtml(item.server)}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${fingerBadges}</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    });

    try {
        const res = await window.api.reconnaissance.startFingerprint({ targets, concurrency });
        if (res.success) {
            showToast('指纹识别扫描完成', 'success');
            scanText.textContent = '探测任务已全部完成';
            // 确保进度满圈
            progressText.textContent = '100%';
            progressFill.style.strokeDashoffset = '0';
        }
    } catch (e) {
        showToast('探测任务中断或异常', 'error');
    } finally {
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        scanContainer.classList.remove('scanning');
        window.api.reconnaissance.removeFingerprintListeners();
    }
}

/**
 * 停止指纹识别
 */
async function stopFingerprintScan() {
    await window.api.reconnaissance.stopFingerprint();
    showToast('正在停止检测...', 'info');
}

// ==================== 初始化事件监听器 ====================

document.addEventListener('DOMContentLoaded', () => {
    // 视图切换点击事件
    document.getElementById('card-recon-fingerprint')?.addEventListener('click', () => _showView('fingerprint'));
    document.getElementById('card-recon-subdomain')?.addEventListener('click', () => _showView('subdomain'));
    document.getElementById('card-recon-fofa')?.addEventListener('click', () => _showView('fofa'));
    document.getElementById('btn-recon-back')?.addEventListener('click', () => _showView(null));

    // 滑块联动绑定
    const sdRange = document.getElementById('recon-sd-concurrency');
    const sdLabel = document.getElementById('recon-sd-concurrency-val');
    if (sdRange && sdLabel) {
        sdRange.addEventListener('input', () => sdLabel.textContent = sdRange.value);
    }
    
    const fgRange = document.getElementById('recon-fg-concurrency');
    const fgLabel = document.getElementById('recon-fg-concurrency-val');
    if (fgRange && fgLabel) {
        fgRange.addEventListener('input', () => fgLabel.textContent = fgRange.value);
    }

    // FOFA 配置抽屉管理
    const fofaDrawer = document.getElementById('fofa-drawer');
    const fofaBackdrop = document.getElementById('fofa-drawer-backdrop');
    
    const openDrawer = () => {
        fofaDrawer?.classList.add('active');
        fofaBackdrop?.classList.add('active');
    };
    
    const closeDrawer = () => {
        fofaDrawer?.classList.remove('active');
        fofaBackdrop?.classList.remove('active');
    };

    document.getElementById('btn-recon-ff-config')?.addEventListener('click', openDrawer);
    document.getElementById('btn-fofa-drawer-close')?.addEventListener('click', closeDrawer);
    document.getElementById('btn-fofa-config-cancel')?.addEventListener('click', closeDrawer);
    fofaBackdrop?.addEventListener('click', closeDrawer);

    // FOFA 保存配置
    document.getElementById('btn-fofa-config-save')?.addEventListener('click', async () => {
        const email = document.getElementById('fofa-config-email').value.trim();
        const key = document.getElementById('fofa-config-key').value.trim();
        
        const saveRes = await window.api.reconnaissance.saveConfig({ fofaEmail: email, fofaKey: key });
        if (saveRes && saveRes.success) {
            showToast('FOFA 配置保存成功', 'success');
            closeDrawer();
        } else {
            showToast('保存失败: ' + (saveRes.error || '未知错误'), 'error');
        }
    });

    // FOFA 查询与导出
    document.getElementById('btn-recon-ff-start')?.addEventListener('click', runFofaSearch);
    document.getElementById('btn-recon-ff-export')?.addEventListener('click', () => {
        const headers = ['主机 (Host)', 'IP 地址', '端口', '协议', '页面标题 (Title)', 'Web 服务器', '国家'];
        const rows = fofaSearchResults.map(i => [i.host, i.ip, i.port, i.protocol, i.title || '', i.server || '', i.country]);
        _exportToCsv('fofa_search_results.csv', headers, rows);
    });

    // 域名爆破查询与导出
    document.getElementById('btn-recon-sd-start')?.addEventListener('click', startSubdomainScan);
    document.getElementById('btn-recon-sd-stop')?.addEventListener('click', stopSubdomainScan);
    document.getElementById('btn-recon-sd-export')?.addEventListener('click', () => {
        const headers = ['子域名', '解析 IP 地址', '解析状态'];
        const rows = subdomainResults.map(i => [i.subdomain, i.ips.join('|'), '解析成功']);
        _exportToCsv('subdomain_bruteforce_results.csv', headers, rows);
    });

    // 指纹探测与导出
    document.getElementById('btn-recon-fg-start')?.addEventListener('click', startFingerprintScan);
    document.getElementById('btn-recon-fg-stop')?.addEventListener('click', stopFingerprintScan);
    document.getElementById('btn-recon-fg-export')?.addEventListener('click', () => {
        const headers = ['目标 URL', '网络状态/响应码', 'Web 服务器', '网页标题 (Title)', '指纹匹配'];
        const rows = fingerprintResults.map(i => [i.url, i.status, i.server, i.title, i.fingerprints.join('|')]);
        _exportToCsv('web_fingerprint_results.csv', headers, rows);
    });

    // SNMP 诊断与导出
    document.getElementById('card-recon-snmp')?.addEventListener('click', () => _showView('snmp'));
    document.getElementById('btn-recon-sn-start')?.addEventListener('click', runSnmpInterfaceScan);
    document.getElementById('btn-recon-sn-stop')?.addEventListener('click', async () => {
        await window.api.reconnaissance.stopSnmpScan();
    });
    document.getElementById('btn-recon-sn-export')?.addEventListener('click', exportSnmpResults);
    document.getElementById('btn-recon-sn-monitor-close')?.addEventListener('click', closeTrafficMonitor);

    // SNMP 版本切换与 v3 参数行显隐联动
    document.getElementById('recon-sn-version')?.addEventListener('change', (e) => {
        const v3Row = document.getElementById('recon-sn-v3-row');
        const commGroup = document.getElementById('recon-sn-community')?.parentElement;
        if (e.target.value === '3') {
            if (v3Row) v3Row.style.display = 'flex';
            if (commGroup) commGroup.style.display = 'none';
        } else {
            if (v3Row) v3Row.style.display = 'none';
            if (commGroup) commGroup.style.display = 'flex';
        }
    });

    // SNMP 过滤与排序输入监听
    document.getElementById('recon-sn-filter-search')?.addEventListener('input', filterAndRenderSnmpTable);
    document.getElementById('recon-sn-filter-status')?.addEventListener('change', filterAndRenderSnmpTable);
    document.getElementById('recon-sn-sort-by')?.addEventListener('change', filterAndRenderSnmpTable);
});

// ==================== SNMP 接口诊断与实时流量监控 ====================

let snmpResults = [];
let snmpDeviceInfo = {};

async function runSnmpInterfaceScan() {
    const ip = document.getElementById('recon-sn-ip').value.trim();
    const community = document.getElementById('recon-sn-community').value.trim() || 'public';
    const version = document.getElementById('recon-sn-version').value;
    const mode = document.getElementById('recon-sn-mode').value;

    if (!ip) {
        showToast('请输入设备 IP 地址', 'warning');
        return;
    }

    if (!/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {
        showToast('请输入有效的 IPv4 地址', 'warning');
        return;
    }

    const startBtn = document.getElementById('btn-recon-sn-start');
    const stopBtn = document.getElementById('btn-recon-sn-stop');
    const tableBody = document.getElementById('recon-sn-table-body');
    const infoPanel = document.getElementById('recon-sn-info-panel');
    const progressContainer = document.getElementById('recon-sn-progress-container');

    startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    infoPanel.style.display = 'none';

    if (progressContainer) {
        progressContainer.style.display = 'flex';
        document.getElementById('recon-sn-progress-phase').textContent = '正在连接设备并获取系统信息...';
        document.getElementById('recon-sn-progress-percent').textContent = '0%';
        document.getElementById('recon-sn-progress-bar').style.width = '0%';
    }

    tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty">正在向目标设备发起 SNMP 查询，请稍候...</td></tr>`;
    snmpResults = [];

    // 进度监听
    window.api.reconnaissance.removeSnmpListeners();
    window.api.reconnaissance.onSnmpProgress(({ phase, percent, detail }) => {
        const percentEl = document.getElementById('recon-sn-progress-percent');
        const barEl = document.getElementById('recon-sn-progress-bar');
        const phaseEl = document.getElementById('recon-sn-progress-phase');
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (barEl) barEl.style.width = `${percent}%`;
        if (phaseEl) phaseEl.textContent = detail;
    });

    const params = {
        ip,
        version,
        mode,
        community,
        username: document.getElementById('recon-sn-v3-username').value.trim(),
        authProto: document.getElementById('recon-sn-v3-auth-proto').value,
        authPass: document.getElementById('recon-sn-v3-auth-pass').value,
        privProto: document.getElementById('recon-sn-v3-priv-proto').value,
        privPass: document.getElementById('recon-sn-v3-priv-pass').value
    };

    try {
        const res = await window.api.reconnaissance.startSnmpScan(params);
        if (res.success) {
            snmpResults = res.interfaces || [];
            snmpDeviceInfo = res.deviceInfo || {};

            document.getElementById('recon-sn-info-name').textContent = snmpDeviceInfo.name || '-';
            document.getElementById('recon-sn-info-uptime').textContent = snmpDeviceInfo.uptime || '-';
            document.getElementById('recon-sn-info-descr').textContent = snmpDeviceInfo.descr || '-';
            infoPanel.style.display = 'flex';

            filterAndRenderSnmpTable();
            showToast('接口数据获取成功', 'success');
        } else {
            if (res.cancelled) {
                showToast('扫描已取消', 'info');
                tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty" style="color: var(--text-muted);">扫描已被用户停止。</td></tr>`;
            } else {
                showToast(res.error, 'error');
                tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty" style="color: var(--danger-color); font-weight: 500;">获取失败: ${escapeHtml(res.error)}</td></tr>`;
            }
        }
    } catch (e) {
        showToast('请求异常: ' + e.message, 'error');
        tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty" style="color: var(--danger-color);">发生错误: ${escapeHtml(e.message)}</td></tr>`;
    } finally {
        startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (progressContainer) progressContainer.style.display = 'none';
        window.api.reconnaissance.removeSnmpListeners();
    }
}

function filterAndRenderSnmpTable() {
    const tableBody = document.getElementById('recon-sn-table-body');
    if (!tableBody) return;

    if (snmpResults.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty">暂无查询结果，请配置参数后获取接口</td></tr>`;
        return;
    }

    // 获取过滤排序参数
    const searchVal = document.getElementById('recon-sn-filter-search')?.value.toLowerCase().trim() || '';
    const statusVal = document.getElementById('recon-sn-filter-status')?.value || 'all';
    const sortBy = document.getElementById('recon-sn-sort-by')?.value || 'index';

    // 1. 过滤
    let filtered = snmpResults.filter(item => {
        if (searchVal) {
            const nameMatch = (item.name || '').toLowerCase().includes(searchVal);
            const aliasMatch = (item.alias || '').toLowerCase().includes(searchVal);
            const macMatch = (item.physAddress || '').toLowerCase().includes(searchVal);
            const neighborMatch = item.neighbor && (
                (item.neighbor.deviceName || '').toLowerCase().includes(searchVal) ||
                (item.neighbor.portName || '').toLowerCase().includes(searchVal)
            );
            if (!nameMatch && !aliasMatch && !macMatch && !neighborMatch) {
                return false;
            }
        }

        if (statusVal === 'up' && item.operStatus !== 1) {
            return false;
        }
        if (statusVal === 'traffic' && (item.inOctets || 0) === 0 && (item.outOctets || 0) === 0) {
            return false;
        }
        if (statusVal === 'anomaly') {
            const isLinkFlapOrDown = (item.operStatus !== 1 && item.adminStatus === 1);
            const hasErrors = (item.inErrors || 0) > 0 || (item.outErrors || 0) > 0;
            const hasDiscards = (item.inDiscards || 0) > 0 || (item.outDiscards || 0) > 0;
            if (!isLinkFlapOrDown && !hasErrors && !hasDiscards) {
                return false;
            }
        }

        return true;
    });

    // 2. 排序
    filtered.sort((a, b) => {
        if (sortBy === 'speed') {
            const speedA = a.speed || 0;
            const speedB = b.speed || 0;
            return speedB - speedA; // 从高到低
        }
        if (sortBy === 'traffic') {
            const trafficA = (a.inOctets || 0) + (a.outOctets || 0);
            const trafficB = (b.inOctets || 0) + (b.outOctets || 0);
            return trafficB - trafficA; // 从高到低
        }
        return a.index - b.index; // 默认升序
    });

    // 3. 渲染
    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="recon-results-empty">没有匹配的接口</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(item => {
        // lastChange 格式化
        let lastChangeTip = '';
        if (item.lastChange && item.lastChange > 0) {
            const seconds = Math.floor(item.lastChange / 100);
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            lastChangeTip = `最后变化时间: 开机后 ${days}天 ${hours}小时 ${minutes}分钟`;
        } else {
            lastChangeTip = '自启动以来状态未改变';
        }

        const adminBadgeText = item.adminStatus === 1 ? 'UP' : 'DOWN';
        const operBadgeClass = item.operStatus === 1 ? 'badge-up' : 'badge-down';
        const statusBadge = `<span class="${operBadgeClass}" title="${lastChangeTip}">${item.operStatus === 1 ? 'UP' : 'DOWN'}/${adminBadgeText}</span>`;

        // 接口名称和描述合并
        const descText = item.alias ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">描述: ${escapeHtml(item.alias)}</div>` : '';
        const nameColumn = `<div>
            <div style="font-weight: 600;">${escapeHtml(item.name)}</div>
            ${descText}
        </div>`;

        // 类型与 MAC 合并
        const macText = item.physAddress ? `<div style="font-family: monospace; font-size: 11px; color: var(--text-muted); margin-top: 2px;">MAC: ${escapeHtml(item.physAddress)}</div>` : '';
        const typeBadge = item.type && item.type !== '-' ? `<span style="font-size: 10px; padding: 1px 4px; background: rgba(255,255,255,0.06); border-radius: 3px; color: var(--text-secondary);">${escapeHtml(item.type)}</span>` : '';
        const typeColumn = `<div>
            <div>${typeBadge}</div>
            ${macText}
        </div>`;

        // 错丢包
        const errIn = item.inErrors || 0;
        const errOut = item.outErrors || 0;
        const discIn = item.inDiscards || 0;
        const discOut = item.outDiscards || 0;
        let errColumn = '';
        if (errIn > 0 || errOut > 0 || discIn > 0 || discOut > 0) {
            errColumn = `<div style="font-family: monospace; font-size: 11px; color: #ff453a;">
                入: 错${errIn}/丢${discIn}<br>
                出: 错${errOut}/丢${discOut}
            </div>`;
        } else {
            errColumn = `<div style="font-family: monospace; font-size: 11px; color: var(--text-muted);">无</div>`;
        }

        // 流量
        const inBytes = _formatBytes(item.inOctets);
        const outBytes = _formatBytes(item.outOctets);
        const trafficColumn = `<div style="font-family: monospace; font-size: 11px;">
            <span style="color: #30d158;">▼ In:  ${inBytes}</span><br>
            <span style="color: #0a84ff;">▲ Out: ${outBytes}</span>
        </div>`;

        const speedText = _formatSpeed(item.speed);

        // 邻居
        let neighborText = '-';
        if (item.neighbor) {
            neighborText = `<span class="badge-neighbor" title="对端端口: ${escapeHtml(item.neighbor.portName)}">
                ${escapeHtml(item.neighbor.deviceName)}
            </span>`;
        }

        // 缺失标记
        const warningBadge = item.partialMissing ? `<span class="badge-down" style="padding: 1px 4px; font-size: 10px; margin-left: 5px; cursor: help;" title="该端口部分 SNMP 属性请求失败（已单次重试均超时）">数据缺失</span>` : '';

        return `
            <tr>
                <td style="font-family: monospace; text-align: center;">${item.index}</td>
                <td>${nameColumn}</td>
                <td>${typeColumn}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="font-family: monospace; text-align: center;">${item.mtu || '-'}</td>
                <td style="font-family: monospace; text-align: center;">${speedText}${warningBadge}</td>
                <td>${trafficColumn}</td>
                <td style="text-align: center;">${errColumn}</td>
                <td style="text-align: center;">
                    <button class="btn-monitor" onclick="openTrafficMonitor(${item.index}, '${escapeJsString(item.name)}')">📈 监控</button>
                </td>
            </tr>
        `;
    }).join('');
}

function _formatSpeed(speed) {
    if (!speed || isNaN(speed)) return '-';
    if (speed >= 1000000000) return (speed / 1000000000).toFixed(1) + ' Gbps';
    if (speed >= 1000000) return (speed / 1000000).toFixed(1) + ' Mbps';
    if (speed >= 1000) return (speed / 1000).toFixed(1) + ' Kbps';
    return speed + ' bps';
}

function _formatBytes(bytes) {
    if (bytes === undefined || isNaN(bytes)) return '-';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return bytes + ' B';
}

function escapeJsString(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// 实时流量监控变量
let trafficInterval = null;
let trafficHistory = [];
let lastInOctets = null;
let lastOutOctets = null;
let lastTimestamp = null;
let monitorPortIndex = null;
let monitorPortName = '';

const chartCanvas = document.getElementById('recon-sn-traffic-chart');
const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;

function openTrafficMonitor(portIndex, portName) {
    const ip = document.getElementById('recon-sn-ip').value.trim();
    const community = document.getElementById('recon-sn-community').value.trim() || 'public';
    const version = document.getElementById('recon-sn-version').value;

    monitorPortIndex = portIndex;
    monitorPortName = portName;

    document.getElementById('recon-sn-monitor-port-name').textContent = `${portName} (Index ${portIndex})`;
    document.getElementById('recon-sn-monitor-in-rate').textContent = '计算中...';
    document.getElementById('recon-sn-monitor-out-rate').textContent = '计算中...';

    trafficHistory = [];
    lastInOctets = null;
    lastOutOctets = null;
    lastTimestamp = null;

    document.getElementById('recon-sn-monitor-modal').classList.add('active');

    resizeTrafficCanvas();

    if (chartCtx) {
        chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        drawTrafficGrid(100);
    }

    if (trafficInterval) clearInterval(trafficInterval);
    
    pollTraffic(ip, community, version);
    trafficInterval = setInterval(() => {
        pollTraffic(ip, community, version);
    }, 1500);
}

async function pollTraffic(ip, community, version) {
    try {
        const params = {
            ip,
            community,
            version,
            portIndex: monitorPortIndex,
            username: document.getElementById('recon-sn-v3-username').value.trim(),
            authProto: document.getElementById('recon-sn-v3-auth-proto').value,
            authPass: document.getElementById('recon-sn-v3-auth-pass').value,
            privProto: document.getElementById('recon-sn-v3-priv-proto').value,
            privPass: document.getElementById('recon-sn-v3-priv-pass').value
        };

        const res = await window.api.reconnaissance.getPortTraffic(params);
        if (res.success) {
            const currentTimestamp = res.timestamp;
            const currentIn = res.inOctets;
            const currentOut = res.outOctets;

            if (lastTimestamp !== null) {
                const timeDiff = (currentTimestamp - lastTimestamp) / 1000;
                let deltaIn = currentIn - lastInOctets;
                let deltaOut = currentOut - lastOutOctets;

                if (deltaIn < 0) deltaIn = 0;
                if (deltaOut < 0) deltaOut = 0;

                const inSpeedKbps = (deltaIn * 8) / (timeDiff * 1024);
                const outSpeedKbps = (deltaOut * 8) / (timeDiff * 1024);

                document.getElementById('recon-sn-monitor-in-rate').textContent = inSpeedKbps.toFixed(1) + ' Kbps';
                document.getElementById('recon-sn-monitor-out-rate').textContent = outSpeedKbps.toFixed(1) + ' Kbps';

                trafficHistory.push({
                    timestamp: currentTimestamp,
                    inSpeed: inSpeedKbps,
                    outSpeed: outSpeedKbps
                });

                if (trafficHistory.length > 20) {
                    trafficHistory.shift();
                }

                drawTrafficChart();
            }

            lastInOctets = currentIn;
            lastOutOctets = currentOut;
            lastTimestamp = currentTimestamp;
        }
    } catch (e) {
        console.error('获取流量异常:', e);
    }
}

function closeTrafficMonitor() {
    if (trafficInterval) {
        clearInterval(trafficInterval);
        trafficInterval = null;
    }
    document.getElementById('recon-sn-monitor-modal').classList.remove('active');
}

function resizeTrafficCanvas() {
    const canvasEl = document.getElementById('recon-sn-traffic-chart');
    if (!canvasEl) return;
    const container = canvasEl.parentElement;
    canvasEl.width = container.clientWidth;
    canvasEl.height = container.clientHeight;
}

window.addEventListener('resize', () => {
    const modal = document.getElementById('recon-sn-monitor-modal');
    if (modal && modal.classList.contains('active')) {
        resizeTrafficCanvas();
        drawTrafficChart();
    }
});

function drawTrafficGrid(maxY) {
    const canvasEl = document.getElementById('recon-sn-traffic-chart');
    const ctx = canvasEl ? canvasEl.getContext('2d') : null;
    if (!ctx || !canvasEl) return;

    const width = canvasEl.width;
    const height = canvasEl.height;

    const margin = { top: 20, right: 20, bottom: 20, left: 55 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
        const y = margin.top + chartHeight - (i / gridCount) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartWidth, y);
        ctx.stroke();

        const val = Math.round((i / gridCount) * maxY);
        ctx.fillText(val + ' K', margin.left - 8, y);
    }
}

function drawTrafficChart() {
    const canvasEl = document.getElementById('recon-sn-traffic-chart');
    const ctx = canvasEl ? canvasEl.getContext('2d') : null;
    if (!ctx || !canvasEl || trafficHistory.length === 0) return;

    const width = canvasEl.width;
    const height = canvasEl.height;
    ctx.clearRect(0, 0, width, height);

    const margin = { top: 20, right: 20, bottom: 20, left: 55 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    let maxVal = 100;
    for (const h of trafficHistory) {
        if (h.inSpeed > maxVal) maxVal = h.inSpeed;
        if (h.outSpeed > maxVal) maxVal = h.outSpeed;
    }
    maxVal = maxVal * 1.2;

    drawTrafficGrid(maxVal);

    const pointsCount = 20;
    const getX = (index) => {
        const step = chartWidth / (pointsCount - 1);
        const offset = pointsCount - trafficHistory.length;
        return margin.left + (index + offset) * step;
    };

    const getY = (speed) => {
        return margin.top + chartHeight - (speed / maxVal) * chartHeight;
    };

    _drawCurve(
        ctx,
        canvasEl,
        trafficHistory.map((h, idx) => ({ x: getX(idx), y: getY(h.inSpeed) })),
        '#30d158',
        'rgba(48, 209, 88, 0.1)'
    );

    _drawCurve(
        ctx,
        canvasEl,
        trafficHistory.map((h, idx) => ({ x: getX(idx), y: getY(h.outSpeed) })),
        '#0a84ff',
        'rgba(10, 132, 255, 0.1)'
    );
}

function _drawCurve(ctx, canvasEl, points, strokeColor, fillColor) {
    if (points.length < 2) return;
    const margin = { top: 20, right: 20, bottom: 20, left: 55 };
    const height = canvasEl.height;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(points[points.length - 1].x, height - margin.bottom);
    ctx.lineTo(points[0].x, height - margin.bottom);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
}

function exportSnmpResults() {
    if (snmpResults.length === 0) {
        showToast('暂无数据可导出', 'warning');
        return;
    }
    const headers = [
        '接口索引', '接口名称 (Name)', '接口描述 (Alias)', '接口类型 (Type)', 'MAC 地址', 
        '管理状态', '物理状态', 'MTU', '接口速率 (Speed)', '入站字节数 (InOctets)', '出站字节数 (OutOctets)',
        '入站错包', '入站丢包', '出站错包', '出站丢包',
        '对端邻居 (CDP/LLDP)', '对端端口'
    ];
    const rows = snmpResults.map(i => [
        i.index,
        i.name,
        i.alias || '',
        i.type || '',
        i.physAddress || '',
        i.adminStatus === 1 ? 'UP' : 'DOWN',
        i.operStatus === 1 ? 'UP' : 'DOWN',
        i.mtu || '',
        _formatSpeed(i.speed),
        i.inOctets || 0,
        i.outOctets || 0,
        i.inErrors || 0,
        i.inDiscards || 0,
        i.outErrors || 0,
        i.outDiscards || 0,
        i.neighbor ? i.neighbor.deviceName : '',
        i.neighbor ? i.neighbor.portName : ''
    ]);
    const filename = `snmp_interface_diagnostics_${document.getElementById('recon-sn-ip').value.trim()}.csv`;
    _exportToCsv(filename, headers, rows);
}

window.openTrafficMonitor = openTrafficMonitor;
window.initReconnaissancePage = initReconnaissancePage;
