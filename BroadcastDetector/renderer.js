/**
 * 广播与环路检测工具渲染进程逻辑 (BroadcastDetector/renderer.js)
 */

const { ipcRenderer } = require('electron');

let ppsHistory = [];
let arpMap = new Map(); // ip -> { macs: Map(mac->timestamp), activeMac, conflict }
let ipIdCache = new Map(); // ipSrc:ipId -> { firstSeen, count }
let packetStream = [];
let alarms = [];

let currentSecondBroadcastCount = 0;
let currentSecondMulticastCount = 0;
let currentSecondArpCount = 0;

let isRunning = false;
let updateInterval = null;
let arpTableInterval = null;
let loopDetected = false;
let lastLoopDetectedTime = 0;

// 模拟测试相关状态
let isSimulating = false;
let simulationInterval = null;
let simArpTimer = null;
let simLoopTimer = null;

const lastAlertTimes = new Map(); // alertType:ip -> timestamp
let streamUpdated = false;

const canvas = document.getElementById('pps-chart');
const ctx = canvas.getContext('2d');

// 初始化图表历史
for (let i = 0; i < 30; i++) {
    ppsHistory.push({ broadcast: 0, multicast: 0, arp: 0 });
}

// ==================== 初始化与界面配置 ====================

document.addEventListener('DOMContentLoaded', () => {
    initInterfaces();
    resizeCanvas();
    drawChart();

    document.getElementById('btn-start').addEventListener('click', startDetection);
    document.getElementById('btn-stop').addEventListener('click', stopDetection);
    document.getElementById('btn-simulate-test').addEventListener('click', toggleSimulation);
    document.getElementById('btn-clear-alarms').addEventListener('click', () => {
        alarms = [];
        renderAlarms();
    });

    window.addEventListener('resize', resizeCanvas);
});

function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    drawChart();
}

function getThemeColor(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
}

function showToast(message, type = 'info') {
    addAlarm(type === 'error' ? 'critical' : (type === 'warning' ? 'warning' : 'info'), '系统通知', message);
}

// ==================== 嗅探捕获引擎控制 ====================

async function initInterfaces() {
    const select = document.getElementById('interface-select');
    select.innerHTML = '<option value="">正在检测网卡列表...</option>';

    try {
        const check = await ipcRenderer.invoke('broadcastDetector:checkVersion');
        if (!check.found) {
            select.innerHTML = '<option value="">未找到 tshark，请确保安装了 Wireshark</option>';
            showToast('未找到 tshark，请确保已安装 Wireshark 并将其添加进系统环境变量中。', 'error');
            return;
        }

        const res = await ipcRenderer.invoke('broadcastDetector:getInterfaces');
        if (res.success && res.interfaces.length > 0) {
            select.innerHTML = res.interfaces.map(iface =>
                `<option value="${iface.index}">${iface.index}. ${iface.description || iface.name}</option>`
            ).join('');
        } else {
            select.innerHTML = '<option value="">未检测到可用的网卡接口</option>';
            showToast('未检测到可用的网络适配器。', 'warning');
        }
    } catch (e) {
        select.innerHTML = '<option value="">获取网卡列表异常</option>';
        showToast('获取网卡列表失败: ' + e.message, 'error');
    }
}

async function startDetection() {
    if (isSimulating) {
        toggleSimulation(); // 启动真机检测前先停止模拟器
    }

    const select = document.getElementById('interface-select');
    const interfaceIndex = select.value;
    if (!interfaceIndex) {
        showToast('请选择一个有效的网络适配器。', 'error');
        return;
    }

    // 重置状态与数据
    ppsHistory = [];
    for (let i = 0; i < 30; i++) ppsHistory.push({ broadcast: 0, multicast: 0, arp: 0 });
    arpMap.clear();
    ipIdCache.clear();
    packetStream = [];
    alarms = [];
    currentSecondBroadcastCount = 0;
    currentSecondMulticastCount = 0;
    currentSecondArpCount = 0;
    loopDetected = false;
    lastAlertTimes.clear();

    updateArpTable();
    updateStreamTable();
    renderAlarms();

    const selectedName = select.options[select.selectedIndex].text;
    showToast(`正在启动对适配器 [${selectedName}] 的嗅探捕获...`, 'info');

    const res = await ipcRenderer.invoke('broadcastDetector:start', { interfaceIndex });
    if (res.success) {
        isRunning = true;
        document.getElementById('btn-start').style.display = 'none';
        document.getElementById('btn-stop').style.display = 'inline-flex';
        select.disabled = true;

        document.getElementById('status-dot').className = 'status-dot active';
        document.getElementById('status-text').textContent = '正在检测';

        addAlarm('info', 'ℹ️ DETECTOR_STARTED', `监听接口 [${selectedName}] 已启动。过滤规则: arp or ether dst ff:ff:ff:ff:ff:ff or multicast`);

        // 1. 每 1 秒累加并刷新图表统计
        updateInterval = setInterval(() => {
            ppsHistory.push({
                broadcast: currentSecondBroadcastCount,
                multicast: currentSecondMulticastCount,
                arp: currentSecondArpCount
            });
            if (ppsHistory.length > 30) ppsHistory.shift();

            // 重置计数
            currentSecondBroadcastCount = 0;
            currentSecondMulticastCount = 0;
            currentSecondArpCount = 0;

            // 清理过期的 IP ID 映射
            cleanupIpIdCache();

            // 评估网络健康状况
            evaluateLoopRisk();
            checkBroadcastStorm();

            // 更新 UI 和图表
            updateStatsPanel();
            drawChart();
        }, 1000);

        // 2. Throttled 界面列表刷出定时器（600ms 刷新一次以最大化渲染性能）
        arpTableInterval = setInterval(() => {
            updateArpTable();
            updateStreamTable();
        }, 600);

    } else {
        showToast(`启动网络嗅探失败: ${res.error || '未知错误'}`, 'error');
    }
}

async function stopDetection() {
    await ipcRenderer.invoke('broadcastDetector:stop');
    isRunning = false;

    document.getElementById('btn-start').style.display = 'inline-flex';
    document.getElementById('btn-stop').style.display = 'none';
    document.getElementById('interface-select').disabled = false;

    document.getElementById('status-dot').className = 'status-dot';
    document.getElementById('status-text').textContent = '已停止';

    addAlarm('info', 'ℹ️ DETECTOR_STOPPED', '监听检测已停止运行。');

    if (updateInterval) clearInterval(updateInterval);
    if (arpTableInterval) clearInterval(arpTableInterval);
}

// ==================== 模拟测试功能实现 ====================

function toggleSimulation() {
    const btn = document.getElementById('btn-simulate-test');
    if (isSimulating) {
        isSimulating = false;
        clearInterval(simulationInterval);
        clearInterval(updateInterval);
        clearInterval(arpTableInterval);
        clearTimeout(simArpTimer);
        clearTimeout(simLoopTimer);

        btn.textContent = '模拟数据测试';
        btn.style.background = 'var(--out-color)';

        document.getElementById('status-dot').className = 'status-dot';
        document.getElementById('status-text').textContent = '准备就绪';
        document.getElementById('interface-select').disabled = false;
        document.getElementById('btn-start').disabled = false;

        addAlarm('info', 'ℹ️ SIMULATION_STOPPED', '模拟测试模式已关闭。');
        isRunning = false;
    } else {
        if (isRunning) {
            stopDetection();
        }
        isSimulating = true;
        isRunning = true;

        btn.textContent = '停止模拟测试';
        btn.style.background = 'var(--err-color)';

        document.getElementById('interface-select').disabled = true;
        document.getElementById('btn-start').disabled = true;
        document.getElementById('status-dot').className = 'status-dot active';
        document.getElementById('status-text').textContent = '模拟测试中';

        // 重置数据
        ppsHistory = [];
        for (let i = 0; i < 30; i++) ppsHistory.push({ broadcast: 0, multicast: 0, arp: 0 });
        arpMap.clear();
        ipIdCache.clear();
        packetStream = [];
        alarms = [];
        currentSecondBroadcastCount = 0;
        currentSecondMulticastCount = 0;
        currentSecondArpCount = 0;
        loopDetected = false;
        lastAlertTimes.clear();

        updateArpTable();
        updateStreamTable();
        renderAlarms();

        addAlarm('info', 'ℹ️ SIMULATION_STARTED', '模拟测试模式启动。系统正自动构造二层虚拟广播流量、ARP 欺骗包与物理环路包进行算法校验。');

        // 100ms 产生一批模拟数据
        simulationInterval = setInterval(() => {
            const batch = [];
            const now = Date.now() / 1000;

            // 模拟组播流量 (每100ms随机 1~4个)
            const mcCount = Math.floor(Math.random() * 4) + 1;
            for (let i = 0; i < mcCount; i++) {
                batch.push({
                    timestamp: now,
                    length: 64 + Math.floor(Math.random() * 64),
                    ethSrc: '00:e0:fc:11:aa:bb',
                    ethDst: '01:00:5e:00:00:fb',
                    ipSrc: '192.168.1.115',
                    ipDst: '224.0.0.251',
                    ipProto: '17'
                });
            }

            // 模拟广播流量 (每100ms随机 1~2个)
            const bcCount = Math.floor(Math.random() * 2) + 1;
            for (let i = 0; i < bcCount; i++) {
                batch.push({
                    timestamp: now,
                    length: 128 + Math.floor(Math.random() * 128),
                    ethSrc: '00:e0:fc:22:bb:cc',
                    ethDst: 'ff:ff:ff:ff:ff:ff',
                    ipSrc: '192.168.1.201',
                    ipDst: '255.255.255.255',
                    ipProto: '17'
                });
            }

            // 偶然产生一些正常 ARP 请求
            if (Math.random() < 0.3) {
                const randomIp = `192.168.1.${Math.floor(Math.random() * 100) + 10}`;
                batch.push({
                    timestamp: now,
                    length: 42,
                    ethSrc: '00:0c:29:ff:ee:dd',
                    ethDst: 'ff:ff:ff:ff:ff:ff',
                    arpOpcode: '1',
                    arpSrcIp: '192.168.1.99',
                    arpDstIp: randomIp,
                    arpSrcMac: '00:0c:29:ff:ee:dd'
                });
            }

            handlePackets(batch);
        }, 100);

        // 每秒图表更新
        updateInterval = setInterval(() => {
            ppsHistory.push({
                broadcast: currentSecondBroadcastCount,
                multicast: currentSecondMulticastCount,
                arp: currentSecondArpCount
            });
            if (ppsHistory.length > 30) ppsHistory.shift();

            currentSecondBroadcastCount = 0;
            currentSecondMulticastCount = 0;
            currentSecondArpCount = 0;

            cleanupIpIdCache();
            evaluateLoopRisk();
            checkBroadcastStorm();

            updateStatsPanel();
            drawChart();
        }, 1000);

        // 列表展示刷新
        arpTableInterval = setInterval(() => {
            updateArpTable();
            updateStreamTable();
        }, 600);

        // 周期性生成欺骗与环路异常流量
        scheduleSimulatedEvents();
    }
}

function scheduleSimulatedEvents() {
    if (!isSimulating) return;

    // 每 7 秒模拟一次 ARP 欺骗
    simArpTimer = setTimeout(() => {
        if (!isSimulating) return;
        const now = Date.now() / 1000;
        const targetIp = '192.168.1.1'; // 网关

        // 1. 发送正常的网关 ARP
        const pkt1 = {
            timestamp: now,
            length: 42,
            ethSrc: '00:00:5e:00:01:01', // 正常路由器 MAC
            ethDst: 'ff:ff:ff:ff:ff:ff',
            arpOpcode: '2',
            arpSrcIp: targetIp,
            arpDstIp: '192.168.1.115',
            arpSrcMac: '00:00:5e:00:01:01'
        };

        // 2. 150ms 后发送欺骗网关 ARP (不同MAC)
        setTimeout(() => {
            if (!isSimulating) return;
            const pkt2 = {
                timestamp: now + 0.15,
                length: 42,
                ethSrc: 'f4:0f:1b:22:33:44', // 黑客 MAC
                ethDst: 'ff:ff:ff:ff:ff:ff',
                arpOpcode: '2',
                arpSrcIp: targetIp,
                arpDstIp: '192.168.1.115',
                arpSrcMac: 'f4:0f:1b:22:33:44'
            };
            handlePackets([pkt1, pkt2]);
        }, 150);

        // 递归
        scheduleSimulatedEvents();
    }, 7000);

    // 在开启后 4 秒及后续每 10 秒模拟一次局部环路风暴
    simLoopTimer = setTimeout(() => {
        if (!isSimulating) return;
        const now = Date.now() / 1000;
        const stormPackets = [];

        // 产生 65 个具有完全相同 IP ID 的数据包，模拟因环路导致的二层多端口无限复制
        for (let i = 0; i < 65; i++) {
            stormPackets.push({
                timestamp: now,
                length: 1200,
                ethSrc: '00:0c:29:aa:bb:cc',
                ethDst: 'ff:ff:ff:ff:ff:ff',
                ipSrc: '172.16.5.22',
                ipDst: '255.255.255.255',
                ipProto: '17',
                ipId: '8888' // 相同的 IP ID
            });
        }

        handlePackets(stormPackets);
    }, 4000);
}

// ==================== 流量分析与核心检测算法 ====================

ipcRenderer.on('broadcastDetector:packets', (event, packets) => {
    if (!isRunning || isSimulating) return; // 模拟测试中忽略真实网络包，避免干扰
    handlePackets(packets);
});

function handlePackets(packets) {
    for (const pkt of packets) {
        // 1. 分类统计 (用于 PPS 曲线)
        const isArp = !!pkt.arpOpcode;
        const isBroadcast = pkt.ethDst === 'ff:ff:ff:ff:ff:ff' || pkt.ipDst === '255.255.255.255';
        const isMulticast = !isBroadcast && (pkt.ethDst.startsWith('01:00:5e') || pkt.ethDst.startsWith('33:33') || _isMulticastIp(pkt.ipDst));

        if (isArp) {
            currentSecondArpCount++;
        } else if (isBroadcast) {
            currentSecondBroadcastCount++;
        } else if (isMulticast) {
            currentSecondMulticastCount++;
        }

        // 2. 环路检测 (IP ID 碰撞检测法)
        if (pkt.ipId && pkt.ipSrc) {
            const key = `${pkt.ipSrc}:${pkt.ipId}`;
            const now = Date.now();
            let cache = ipIdCache.get(key);
            if (!cache) {
                ipIdCache.set(key, { firstSeen: now, count: 1 });
            } else {
                cache.count++;
                if (cache.count > 50) {
                    triggerLoopAlert(pkt.ipSrc, pkt.ethSrc, cache.count);
                }
            }
        }

        // 3. ARP 漂移/欺骗检测
        if (isArp && pkt.arpSrcIp && pkt.arpSrcMac) {
            const ip = pkt.arpSrcIp;
            const mac = pkt.arpSrcMac.toLowerCase();
            const now = Date.now();

            let record = arpMap.get(ip);
            if (!record) {
                arpMap.set(ip, { macs: new Map([[mac, now]]), activeMac: mac, conflict: false });
            } else {
                record.macs.set(mac, now);

                // 移除 15s 未更新的陈旧 MAC 映射，适配网卡物理切换的场景
                for (const [m, time] of record.macs.entries()) {
                    if (now - time > 15000) {
                        record.macs.delete(m);
                    }
                }

                if (record.macs.size > 1) {
                    const macList = Array.from(record.macs.keys());
                    if (shouldAlert('arp_spoof', ip, 15000)) {
                        addAlarm('critical', '⚠️ ARP_DRIFT_DETECTED', `IP [${ip}] 发生 MAC 漂移冲突！检测到多个绑定 MAC: [${macList.join(', ')}]，可能存在 ARP 中间人欺骗/网关劫持攻击。`);
                    }
                    record.conflict = true;
                } else {
                    record.conflict = false;
                    record.activeMac = mac;
                }
            }
        }

        // 4. 追加到实时包活动数据流中
        addPacketToStream(pkt);
    }
}

ipcRenderer.on('broadcastDetector:error', (event, err) => {
    if (isRunning) {
        addAlarm('warning', '检测引擎警告', String(err));
    }
});

ipcRenderer.on('broadcastDetector:stopped', () => {
    if (isRunning) {
        stopDetection();
    }
});

function _isMulticastIp(ip) {
    if (!ip) return false;
    if (ip.startsWith('ff') || ip.startsWith('FF')) return true;
    const parts = ip.split('.');
    if (parts.length === 4) {
        const first = parseInt(parts[0]);
        return first >= 224 && first <= 239;
    }
    return false;
}

function shouldAlert(type, key, intervalMs = 15000) {
    const now = Date.now();
    const alertKey = `${type}:${key}`;
    const lastAlert = lastAlertTimes.get(alertKey);
    if (!lastAlert || (now - lastAlert > intervalMs)) {
        lastAlertTimes.set(alertKey, now);
        return true;
    }
    return false;
}

function triggerLoopAlert(srcIp, srcMac, duplicates) {
    loopDetected = true;
    lastLoopDetectedTime = Date.now();
    if (shouldAlert('loop_detect', srcIp, 10000)) {
        addAlarm('critical', '⚠️ L2_LOOP_DETECTED', `网路二层环路告警：检测到 IP ID 碰撞！源 IP: [${srcIp}], MAC: [${srcMac}]，数据包在环路中被复制发送了 ${duplicates} 次。请排查物理布线或 STP (生成树协议) 配置。`);
    }
}

function cleanupIpIdCache() {
    const now = Date.now();
    for (const [key, cache] of ipIdCache.entries()) {
        if (now - cache.firstSeen > 5000) {
            ipIdCache.delete(key);
        }
    }
}

function evaluateLoopRisk() {
    const now = Date.now();
    const statVal = document.getElementById('stat-loop-risk');

    if (loopDetected && (now - lastLoopDetectedTime < 10000)) {
        statVal.textContent = '高风险';
        statVal.className = 'stat-val critical';
    } else {
        loopDetected = false;
        statVal.textContent = '安全';
        statVal.className = 'stat-val normal';
    }
}

function checkBroadcastStorm() {
    const lastSample = ppsHistory[ppsHistory.length - 1];
    if (!lastSample) return;

    const bPps = lastSample.broadcast;
    const totalPps = bPps + lastSample.multicast + lastSample.arp;

    if (bPps > 500) {
        const ratio = totalPps > 0 ? (bPps / totalPps * 100).toFixed(1) : 0;
        if (shouldAlert('broadcast_storm', 'global', 20000)) {
            addAlarm('warning', '⚠️ BROADCAST_STORM', `网络广播风暴告警：广播速率达到 ${bPps} PPS，占比为 ${ratio}%。请排查风暴源设备或开启交换机风暴控制 (Storm Control)。`);
        }
    }
}

// ==================== UI 渲染与折线图绘制 ====================

function addAlarm(type, title, desc) {
    const timeStr = new Date().toLocaleTimeString();
    const alarm = { type, title, desc, time: timeStr };
    alarms.unshift(alarm);
    if (alarms.length > 50) alarms.pop();
    renderAlarms();
}

function renderAlarms() {
    const container = document.getElementById('alarm-list');
    if (alarms.length === 0) {
        container.innerHTML = `<div class="alarm-empty">暂无安全和物理故障警告，网络状态良好</div>`;
        return;
    }

    container.innerHTML = alarms.map(al => `
        <div class="alarm-item ${al.type}">
            <div class="alarm-meta">
                <span class="alarm-title ${al.type}">${al.title}</span>
                <span>${al.time}</span>
            </div>
            <div class="alarm-desc">${al.desc}</div>
        </div>
    `).join('');
}

function updateStatsPanel() {
    const lastSample = ppsHistory[ppsHistory.length - 1];
    if (!lastSample) return;

    const bPps = lastSample.broadcast;
    const mPps = lastSample.multicast;
    const aPps = lastSample.arp;
    const totalPps = bPps + mPps + aPps;

    const ratio = totalPps > 0 ? (bPps / totalPps * 100).toFixed(1) : '0.0';

    const ratioEl = document.getElementById('stat-broadcast-ratio');
    ratioEl.textContent = `${ratio}%`;
    const ratioVal = parseFloat(ratio);
    if (ratioVal > 30) {
        ratioEl.className = 'stat-val critical';
    } else if (ratioVal > 15) {
        ratioEl.className = 'stat-val warning';
    } else {
        ratioEl.className = 'stat-val normal';
    }

    const ppsEl = document.getElementById('stat-pps');
    ppsEl.textContent = bPps;
    if (bPps > 500) {
        ppsEl.className = 'stat-val critical';
    } else if (bPps > 200) {
        ppsEl.className = 'stat-val warning';
    } else {
        ppsEl.className = 'stat-val normal';
    }
}

function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const margin = { top: 20, right: 15, bottom: 25, left: 45 };
    const width = canvas.width - margin.left - margin.right;
    const height = canvas.height - margin.top - margin.bottom;

    if (width <= 0 || height <= 0) return;

    // 动态算取自适应 Y 轴最大 PPS
    let maxPps = 10;
    for (const h of ppsHistory) {
        maxPps = Math.max(maxPps, h.broadcast, h.multicast, h.arp);
    }
    maxPps = Math.ceil(maxPps / 10) * 10;

    // 绘制横向网格与刻度
    ctx.strokeStyle = getThemeColor('--hr');
    ctx.lineWidth = 1;
    ctx.fillStyle = getThemeColor('--text-muted');
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
        const y = margin.top + (height / gridLines) * i;
        const val = Math.round(maxPps - (maxPps / gridLines) * i);

        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + width, y);
        ctx.stroke();

        ctx.fillText(val, margin.left - 8, y);
    }

    // 绘制时间轴底标
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 6; i++) {
        const x = margin.left + (width / 6) * i;
        const timeOffset = -30 + 5 * i;
        ctx.fillText(`${timeOffset}s`, x, margin.top + height + 6);
    }

    // 独立绘制三种数据曲线
    function drawLine(key, colorHex, strokeColorHex) {
        if (ppsHistory.length === 0) return;

        const getX = (idx) => margin.left + (width / 29) * idx;
        const getY = (val) => margin.top + height - (val / maxPps) * height;

        ctx.beginPath();
        ctx.moveTo(getX(0), getY(ppsHistory[0][key]));
        for (let i = 1; i < ppsHistory.length; i++) {
            ctx.lineTo(getX(i), getY(ppsHistory[i][key]));
        }

        ctx.strokeStyle = strokeColorHex;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 渐变面积填充
        ctx.lineTo(getX(ppsHistory.length - 1), margin.top + height);
        ctx.lineTo(getX(0), margin.top + height);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + height);
        gradient.addColorStop(0, colorHex + '25'); // 约 15% 透明度
        gradient.addColorStop(1, colorHex + '00');
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    // 组播: 蓝色
    drawLine('multicast', '#3b82f6', '#3b82f6');
    // 广播: 靛紫色
    drawLine('broadcast', '#4f46e5', '#4f46e5');
    // ARP: 绿色
    drawLine('arp', '#10b981', '#10b981');
}

function updateArpTable() {
    const tbody = document.getElementById('arp-table-body');
    const countEl = document.getElementById('arp-count');

    if (arpMap.size === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">等待捕获 ARP 流量...</td></tr>`;
        countEl.textContent = '设备数: 0';
        return;
    }

    countEl.textContent = `设备数: ${arpMap.size}`;

    // 按 IP 大小排序
    const sortedIps = Array.from(arpMap.keys()).sort((a, b) => {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
            if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
        }
        return 0;
    });

    tbody.innerHTML = sortedIps.map(ip => {
        const record = arpMap.get(ip);
        const macs = Array.from(record.macs.keys());
        const timeStr = new Date(Math.max(...record.macs.values())).toLocaleTimeString();

        let statusHtml = '<span style="color: var(--in-color);">正常</span>';
        let rowClass = '';

        if (record.conflict) {
            statusHtml = `<span style="color: var(--err-color); font-weight: bold;">⚠️ 漂移冲突</span><span class="conflict-badge">欺骗风险</span>`;
            rowClass = 'class="danger-row"';
        }

        return `
            <tr ${rowClass}>
                <td>${ip}</td>
                <td>${macs.join('<br>')}</td>
                <td>${timeStr}</td>
                <td>${statusHtml}</td>
            </tr>
        `;
    }).join('');
}

function addPacketToStream(pkt) {
    packetStream.unshift(pkt);
    if (packetStream.length > 20) {
        packetStream.pop();
    }
    streamUpdated = true;
}

function updateStreamTable() {
    if (!streamUpdated) return;
    streamUpdated = false;

    const tbody = document.getElementById('stream-table-body');
    if (packetStream.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">等待数据包流入...</td></tr>`;
        return;
    }

    tbody.innerHTML = packetStream.map(pkt => {
        const timeStr = new Date(pkt.timestamp * 1000).toLocaleTimeString();
        let proto = pkt.arpOpcode ? 'ARP' : (pkt.ipProto ? getProtoName(pkt.ipProto) : 'ETHER');
        let info = '';

        if (pkt.arpOpcode) {
            const op = pkt.arpOpcode === '1' ? 'Request' : (pkt.arpOpcode === '2' ? 'Reply' : `Op:${pkt.arpOpcode}`);
            if (pkt.arpOpcode === '1') {
                info = `Who has ${pkt.arpDstIp}? Tell ${pkt.arpSrcIp}`;
            } else if (pkt.arpOpcode === '2') {
                info = `${pkt.arpSrcIp} is at ${pkt.arpSrcMac}`;
            } else {
                info = `ARP ${op}`;
            }
        } else {
            info = `${pkt.ipSrc || pkt.ethSrc} → ${pkt.ipDst || pkt.ethDst}`;
        }

        return `
            <tr>
                <td>${timeStr}</td>
                <td>${pkt.ethSrc}</td>
                <td>${pkt.ipSrc || '-'}</td>
                <td><span class="badge ${proto.toLowerCase()}">${proto}</span></td>
                <td>${pkt.length}</td>
                <td style="text-align: left; font-family: sans-serif; word-break: break-all;">${info}</td>
            </tr>
        `;
    }).join('');
}

function getProtoName(num) {
    const names = { '1': 'ICMP', '2': 'IGMP', '6': 'TCP', '17': 'UDP', '58': 'ICMPv6', 'arp': 'ARP' };
    return names[num] || `IP:${num}`;
}

// 监听主进程广播的主题变更事件
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

// Initial theme setup
const _qs = new URLSearchParams(location.search);
const _qsMode = _qs.get('mode');
const _qsTheme = _qs.get('theme');
if (_qsMode || _qsTheme) {
    applyTheme({ mode: _qsMode, key: _qsTheme });
} else {
    ipcRenderer.invoke('theme:get').then(theme => {
        applyTheme(theme);
        resizeCanvas();
    }).catch(() => {});
}

ipcRenderer.on('theme:changed', (event, theme) => {
    applyTheme(theme);
    // 延迟重绘以保证 CSS 变量加载就绪
    setTimeout(() => {
        resizeCanvas();
    }, 80);
});

// 控制说明卡片的折叠与展开
window.toggleReferenceCard = function() {
    const card = document.getElementById('reference-card');
    const body = document.getElementById('reference-body');
    const icon = document.getElementById('reference-toggle-icon');
    
    if (body.style.display === 'none') {
        body.style.display = 'block';
        icon.textContent = '▲';
        card.classList.remove('collapsed');
    } else {
        body.style.display = 'none';
        icon.textContent = '▼';
        card.classList.add('collapsed');
    }
};
