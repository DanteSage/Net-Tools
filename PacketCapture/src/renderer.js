// ============================================
// PacketCapture - 高性能渲染器
// 采用虚拟滚动 + 分块加载 + Web Worker
// ============================================

// requestIdleCallback polyfill
window.requestIdleCallback = window.requestIdleCallback || function(cb) {
  const start = Date.now();
  return setTimeout(() => {
    cb({ 
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
    });
  }, 1);
};
window.cancelIdleCallback = window.cancelIdleCallback || function(id) {
  clearTimeout(id);
};

// DOM 元素
const elements = {
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnClear: document.getElementById('btn-clear'),
  btnImport: document.getElementById('btn-import'),
  btnExport: document.getElementById('btn-export'),
  filterInput: document.getElementById('filter-input'),
  interfaceSelect: document.getElementById('interface-select'),
  searchInput: document.getElementById('search-input'),
  packetList: document.getElementById('packet-list'),
  packetCount: document.getElementById('packet-count'),
  displayCount: document.getElementById('display-count'),
  statusIndicator: document.getElementById('status-indicator'),
  statusText: document.getElementById('status-text'),
  adminStatus: document.getElementById('admin-status'),
  protocolTree: document.getElementById('protocol-tree'),
  hexViewer: document.getElementById('hex-viewer'),
  emptyMessage: document.getElementById('empty-message'),
  toastContainer: document.getElementById('toast-container')
};

// ============================================
// 配置常量
// ============================================
const CONFIG = {
  ROW_HEIGHT: 24,           // 每行高度 (px)
  BUFFER_ROWS: 20,          // 缓冲行数（增加预加载）
  PRELOAD_ROWS: 50,         // 预加载行数（空闲时加载）
  BATCH_SIZE: 100,          // 批量处理大小
  RENDER_THROTTLE: 16,      // 渲染节流 (ms) ~60fps
  UPDATE_THROTTLE: 100,     // 计数更新节流 (ms)
  MAX_PACKETS: 100000       // 最大数据包数
};

// ============================================
// 状态管理
// ============================================
let isCapturing = false;
let selectedPacketId = null;
let searchTerm = '';
let totalPackets = 0;
let filteredCount = 0;
let isImporting = false; // 导入时跳过 cleared 响应

// 虚拟滚动状态
const virtualState = {
  scrollTop: 0,
  viewportHeight: 0,
  startIndex: 0,
  endIndex: 0,
  visiblePackets: [],
  totalHeight: 0
};

// 缓存的数据包（主线程保留最近的用于快速访问）
let packetCache = new Map();
const CACHE_SIZE = 1000;

// 预加载缓存
let preloadedRanges = new Map(); // key: "start-end", value: packets
let lastScrollDirection = 0; // 1: 向下, -1: 向上
let lastScrollTop = 0;

// ============================================
// Web Worker 初始化
// ============================================
let worker = null;
let pendingRequests = new Map();
let requestId = 0;

function initWorker() {
  worker = new Worker('packet-worker.js');
  
  worker.onmessage = (e) => {
    const { type, data, count, total, isPreload } = e.data;
    
    switch (type) {
      case 'count':
        // Worker 计数仅用于参考
        break;
        
      case 'range':
        // 预加载数据不需要渲染，只缓存到 Worker
        if (!isPreload) {
          handleRangeData(data);
        }
        break;
        
      case 'filteredCount':
        filteredCount = count;
        updateCountDisplay();
        break;
        
      case 'packet':
        if (data) {
          showPacketDetails(data);
        }
        break;
        
      case 'cleared':
        // 导入时跳过，避免覆盖导入的计数
        if (!isImporting) {
          totalPackets = 0;
          filteredCount = 0;
          packetCache.clear();
          updateCountDisplay();
        }
        break;
    }
  };
  
  worker.onerror = (err) => {
    console.error('Worker error:', err);
    showToast('Worker 错误: ' + err.message, 'error');
  };
}

// ============================================
// 窗口控制和主题
// ============================================
document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.api.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.api.close());

let currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);

document.getElementById('theme-toggle').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
});

// ============================================
// 初始化
// ============================================
async function init() {
  initWorker();
  
  const isAdmin = await window.api.checkAdmin();
  elements.adminStatus.innerHTML = isAdmin 
    ? '<span class="admin-badge admin">✓ 管理员</span>'
    : '<span class="admin-badge no-admin">✗ 需要管理员权限</span>';

  await loadInterfaces();
  setupEventListeners();
  setupResizers();
  setupVirtualScroll();
}

// 加载网卡列表
async function loadInterfaces() {
  try {
    const interfaces = await window.api.getInterfaces();
    elements.interfaceSelect.innerHTML = '';
    
    interfaces.forEach(iface => {
      const option = document.createElement('option');
      option.value = iface.address || '0';
      option.dataset.ifIndex = iface.ifIndex || 0;
      option.textContent = iface.address 
        ? `${iface.name} (${iface.address})`
        : iface.name;
      elements.interfaceSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load interfaces:', error);
  }
}

// ============================================
// 事件监听
// ============================================
function setupEventListeners() {
  elements.btnStart.addEventListener('click', startCapture);
  elements.btnStop.addEventListener('click', stopCapture);
  elements.btnClear.addEventListener('click', clearPackets);
  elements.btnImport.addEventListener('click', importPackets);
  elements.btnExport.addEventListener('click', exportPackets);
  document.getElementById('btn-stats').addEventListener('click', showStatistics);
  document.getElementById('stats-close').addEventListener('click', hideStatistics);
  document.getElementById('stats-modal').addEventListener('click', (e) => {
    if (e.target.id === 'stats-modal') hideStatistics();
  });
  
  // 搜索（带防抖）
  let searchDebounce = null;
  elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = e.target.value.trim().toLowerCase();
      // 重置滚动位置
      const container = elements.packetList.parentElement;
      container.scrollTop = 0;
      virtualState.scrollTop = 0;
      // 直接请求数据，让 Worker 返回正确的 total
      requestVisibleRange();
    }, 200);
  });

  // 过滤器预设
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterInput.value = btn.dataset.filter;
      hideAutocomplete();
    });
  });
  
  // 过滤表达式自动补全
  setupFilterAutocomplete();

  // 监听数据包
  window.api.onPacketReceived(handlePacket);
  window.api.onCaptureError(handleError);
  window.api.onCaptureStopped(handleStopped);
}

// ============================================
// 虚拟滚动设置
// ============================================
function setupVirtualScroll() {
  const container = elements.packetList.parentElement;
  
  // 获取视口高度
  virtualState.viewportHeight = container.clientHeight;
  
  // 滚动事件（节流 + passive 模式提升性能）
  let scrollRAF = null;
  container.addEventListener('scroll', () => {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      const newScrollTop = container.scrollTop;
      
      // 检测滚动方向
      lastScrollDirection = newScrollTop > lastScrollTop ? 1 : -1;
      lastScrollTop = newScrollTop;
      virtualState.scrollTop = newScrollTop;
      
      requestVisibleRange();
      
      // 空闲时预加载下一屏数据
      schedulePreload();
      
      scrollRAF = null;
    });
  }, { passive: true }); // passive 模式，不阻止默认滚动
  
  // 监听窗口大小变化
  const resizeObserver = new ResizeObserver(() => {
    virtualState.viewportHeight = container.clientHeight;
    requestVisibleRange();
  });
  resizeObserver.observe(container);
}

// ============================================
// 预加载机制 (requestIdleCallback)
// ============================================
let preloadScheduled = false;
let idleCallbackId = null;

function schedulePreload() {
  if (preloadScheduled || !isCapturing && totalPackets === 0) return;
  preloadScheduled = true;
  
  // 取消之前的预加载
  if (idleCallbackId) {
    cancelIdleCallback(idleCallbackId);
  }
  
  // 在浏览器空闲时预加载
  idleCallbackId = requestIdleCallback((deadline) => {
    preloadScheduled = false;
    
    // 至少有 5ms 空闲时间才预加载
    if (deadline.timeRemaining() > 5) {
      preloadNextRange();
    }
  }, { timeout: 200 }); // 最多等待 200ms
}

function preloadNextRange() {
  if (filteredCount === 0) return;
  
  const visibleRows = Math.ceil(virtualState.viewportHeight / CONFIG.ROW_HEIGHT);
  const currentStart = Math.floor(virtualState.scrollTop / CONFIG.ROW_HEIGHT);
  
  let preloadStart, preloadEnd;
  
  if (lastScrollDirection >= 0) {
    // 向下滚动，预加载下方数据
    preloadStart = currentStart + visibleRows + CONFIG.BUFFER_ROWS;
    preloadEnd = preloadStart + CONFIG.PRELOAD_ROWS;
  } else {
    // 向上滚动，预加载上方数据
    preloadEnd = Math.max(0, currentStart - CONFIG.BUFFER_ROWS);
    preloadStart = Math.max(0, preloadEnd - CONFIG.PRELOAD_ROWS);
  }
  
  // 检查是否已经预加载
  const rangeKey = `${preloadStart}-${preloadEnd}`;
  if (preloadedRanges.has(rangeKey)) return;
  
  // 请求预加载数据
  worker.postMessage({
    type: 'getRange',
    data: {
      start: preloadStart,
      end: preloadEnd,
      search: searchTerm,
      isPreload: true
    }
  });
  
  // 标记已预加载（限制缓存大小）
  preloadedRanges.set(rangeKey, true);
  if (preloadedRanges.size > 10) {
    const firstKey = preloadedRanges.keys().next().value;
    preloadedRanges.delete(firstKey);
  }
}

// 请求可见范围的数据
function requestVisibleRange() {
  // 如果没有数据且没有搜索词，显示空状态
  if (totalPackets === 0) {
    renderEmptyState();
    return;
  }
  
  const startIndex = Math.floor(virtualState.scrollTop / CONFIG.ROW_HEIGHT);
  const visibleRows = Math.ceil(virtualState.viewportHeight / CONFIG.ROW_HEIGHT) || 50;
  // 请求足够多的数据（增加缓冲区）
  const requestEnd = startIndex + visibleRows + CONFIG.BUFFER_ROWS * 3;
  const bufferedStart = Math.max(0, startIndex - CONFIG.BUFFER_ROWS * 2);
  
  virtualState.startIndex = bufferedStart;
  virtualState.endIndex = requestEnd;
  
  worker.postMessage({
    type: 'getRange',
    data: {
      start: bufferedStart,
      end: requestEnd,
      search: searchTerm
    }
  });
}

// 处理从 Worker 返回的范围数据
function handleRangeData(result) {
  virtualState.visiblePackets = result.packets;
  
  // 有搜索时更新过滤后的数量
  if (searchTerm) {
    filteredCount = result.total;
  }
  
  // 更新总高度（使用显示数量）
  const displayTotal = searchTerm ? filteredCount : totalPackets;
  virtualState.totalHeight = displayTotal * CONFIG.ROW_HEIGHT;
  
  renderVirtualList();
  updateCountDisplay();
}

// 请求过滤后的数量（备用）
function requestFilteredCount() {
  worker.postMessage({
    type: 'getFilteredCount',
    data: { searchTerm }
  });
}

// ============================================
// 渲染虚拟列表
// ============================================
function renderVirtualList() {
  const container = elements.packetList.parentElement;
  // 使用显示数量
  const total = searchTerm ? filteredCount : totalPackets;
  
  if (total === 0) {
    renderEmptyState();
    return;
  }
  
  elements.emptyMessage.style.display = 'none';
  
  // 计算位置
  const offsetY = virtualState.startIndex * CONFIG.ROW_HEIGHT;
  const totalHeight = total * CONFIG.ROW_HEIGHT;
  
  // 构建 HTML
  let html = '';
  virtualState.visiblePackets.forEach((packet, i) => {
    html += createPacketRowHtml(packet, virtualState.startIndex + i);
  });
  
  // 使用 transform 定位（比 padding 性能更好）
  elements.packetList.innerHTML = html;
  elements.packetList.style.transform = `translateY(${offsetY}px)`;
  elements.packetList.style.height = `${totalHeight - offsetY}px`;
  
  // 设置容器的滚动高度
  container.style.setProperty('--total-height', `${totalHeight}px`);
  
  // 绑定点击事件
  elements.packetList.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = parseInt(tr.dataset.id);
      selectPacketById(id);
      
      // 更新选中样式
      elements.packetList.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
      tr.classList.add('selected');
    });
  });
}

// 创建数据包行 HTML
function createPacketRowHtml(packet, index) {
  const protocol = (packet.protocol || 'UNKNOWN').toUpperCase();
  const protocolClass = `protocol-${protocol.toLowerCase()}`;
  const rowClass = `row-${protocol.toLowerCase()}`;
  const isSelected = selectedPacketId === packet.id;

  const time = formatTime(packet.timestamp);
  const srcAddr = packet.srcPort ? `${packet.srcIp}:${packet.srcPort}` : packet.srcIp;
  const dstAddr = packet.dstPort ? `${packet.dstIp}:${packet.dstPort}` : packet.dstIp;

  return `
    <tr data-id="${packet.id}" class="${rowClass} ${isSelected ? 'selected' : ''}" style="height: ${CONFIG.ROW_HEIGHT}px;">
      <td>${packet.id}</td>
      <td>${time}</td>
      <td>${srcAddr || '-'}</td>
      <td>${dstAddr || '-'}</td>
      <td class="${protocolClass}">${protocol}</td>
      <td>${packet.length || '-'}</td>
      <td>${escapeHtml(packet.info || '')}</td>
    </tr>
  `;
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { 
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
    });
  } catch {
    return '-';
  }
}

function renderEmptyState() {
  elements.packetList.innerHTML = '';
  elements.emptyMessage.style.display = 'flex';
}

// ============================================
// 数据包处理
// ============================================
// 批量缓冲
let packetBuffer = [];
let flushTimeout = null;

function handlePacket(packet) {
  // 添加到缓存
  packetCache.set(packet.id, packet);
  if (packetCache.size > CACHE_SIZE) {
    const firstKey = packetCache.keys().next().value;
    packetCache.delete(firstKey);
  }
  
  // 批量发送到 Worker
  packetBuffer.push(packet);
  
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushPacketBuffer, CONFIG.RENDER_THROTTLE);
  }
  
  // 更新计数（使用 packet.id 作为真实计数）
  totalPackets = packet.id;
  if (!searchTerm) {
    filteredCount = totalPackets;
  }
  throttledUpdateCount();
  
  // 隐藏空消息
  if (elements.emptyMessage.style.display !== 'none') {
    elements.emptyMessage.style.display = 'none';
  }
}

function flushPacketBuffer() {
  if (packetBuffer.length > 0) {
    worker.postMessage({ type: 'add', data: packetBuffer });
    packetBuffer = [];
  }
  flushTimeout = null;
  
  // 刷新可见区域
  requestVisibleRange();
}

// 计数更新节流
let countUpdateTimeout = null;
function throttledUpdateCount() {
  if (!countUpdateTimeout) {
    countUpdateTimeout = setTimeout(() => {
      updateCountDisplay();
      countUpdateTimeout = null;
    }, CONFIG.UPDATE_THROTTLE);
  }
}

function updateCountDisplay() {
  elements.packetCount.textContent = totalPackets.toLocaleString();
  elements.displayCount.textContent = (searchTerm ? filteredCount : totalPackets).toLocaleString();
}

// ============================================
// 选择数据包
// ============================================
function selectPacketById(id) {
  selectedPacketId = id;
  
  // 优先从缓存获取
  const cached = packetCache.get(id);
  if (cached) {
    showPacketDetails(cached);
  } else {
    // 从 Worker 获取
    worker.postMessage({ type: 'getPacketById', data: { id } });
  }
}

function showPacketDetails(packet) {
  showProtocolDetails(packet);
  showHexDump(packet);
}

// ============================================
// 抓包控制
// ============================================
async function startCapture() {
  let filter = elements.filterInput.value.trim();
  
  // 保存到历史记录
  if (filter) {
    saveFilterHistory(filter);
  }
  
  // 清除预加载缓存
  preloadedRanges.clear();
  
  const selectedOption = elements.interfaceSelect.selectedOptions[0];
  const selectedIp = selectedOption ? selectedOption.value : '0';
  
  if (selectedIp && selectedIp !== '0') {
    const ipFilter = `ip.SrcAddr == ${selectedIp} or ip.DstAddr == ${selectedIp}`;
    filter = filter ? `(${filter}) and (${ipFilter})` : ipFilter;
  }
  
  const result = await window.api.startCapture(filter);

  if (result.success) {
    isCapturing = true;
    
    // 重置状态
    worker.postMessage({ type: 'clear' });
    packetCache.clear();
    totalPackets = 0;
    filteredCount = 0;
    selectedPacketId = null;
    searchTerm = '';
    elements.searchInput.value = '';
    
    updateUI();
    renderEmptyState();
    showToast('抓包已开始', 'success');
  } else {
    showToast(result.error || '启动失败', 'error');
  }
}

async function stopCapture() {
  const result = await window.api.stopCapture();
  if (result.success) {
    isCapturing = false;
    updateUI();
    showToast('抓包已停止', 'success');
  }
}

async function clearPackets() {
  await window.api.clearPackets();
  worker.postMessage({ type: 'clear' });
  packetCache.clear();
  preloadedRanges.clear();
  totalPackets = 0;
  filteredCount = 0;
  selectedPacketId = null;
  updateCountDisplay();
  renderEmptyState();
  elements.protocolTree.innerHTML = '<div class="placeholder">选择一个数据包查看详情</div>';
  elements.hexViewer.innerHTML = '<div class="placeholder">选择一个数据包查看原始数据</div>';
  showToast('数据已清除', 'success');
}

async function exportPackets() {
  if (totalPackets === 0) {
    showToast('没有数据可导出', 'error');
    return;
  }
  const result = await window.api.exportPackets();
  if (result.success) {
    showToast(`已导出到 ${result.path}`, 'success');
  } else if (result.error !== '取消保存') {
    showToast(result.error, 'error');
  }
}

async function importPackets() {
  if (isCapturing) {
    showToast('请先停止抓包', 'error');
    return;
  }
  
  const result = await window.api.importPackets();
  if (result.success) {
    // 设置导入标志，跳过 cleared 响应
    isImporting = true;
    
    // 清空当前数据
    worker.postMessage({ type: 'clear' });
    packetCache.clear();
    preloadedRanges.clear();
    selectedPacketId = null;
    searchTerm = '';
    elements.searchInput.value = '';
    
    // 加载导入的数据包到 Worker
    worker.postMessage({ type: 'add', data: result.packets });
    
    // 更新计数
    totalPackets = result.count;
    filteredCount = result.count;
    updateCountDisplay();
    
    // 缓存导入的数据包
    result.packets.forEach(p => {
      packetCache.set(p.id, p);
    });
    
    // 延迟渲染，等待 Worker 处理完成
    if (result.count > 0) {
      elements.emptyMessage.style.display = 'none';
      setTimeout(() => {
        requestVisibleRange();
      }, 50);
    }
    
    showToast(`已导入 ${result.count} 个数据包`, 'success');
    
    // 重置导入标志
    setTimeout(() => { isImporting = false; }, 100);
  } else if (result.error !== '取消导入') {
    showToast(result.error, 'error');
    isImporting = false;
  }
}

// ============================================
// 面板调整
// ============================================
function setupResizers() {
  const resizer1 = document.getElementById('resizer1');
  const resizer2 = document.getElementById('resizer2');
  const panel1 = document.getElementById('packet-list-panel');
  const panel2 = document.getElementById('detail-panel');
  const panel3 = document.getElementById('hex-panel');
  const mainContent = document.querySelector('.main-content');
  const MIN_HEIGHT = 60;

  let startY, startH, resizeRAF, activeResizer;

  function initResize(e, resizer) {
    e.preventDefault();
    startY = e.clientY;
    activeResizer = resizer;
    
    // Wireshark 样式：resizer1 控制 panel1，resizer2 控制 panel2
    if (resizer === 1) {
      startH = panel1.offsetHeight;
    } else {
      startH = panel2.offsetHeight;
    }
    
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
  }

  function doResize(e) {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => {
      const diff = e.clientY - startY;
      const containerHeight = mainContent.clientHeight - 12; // padding + resizers
      
      if (activeResizer === 1) {
        // resizer1: 调整 panel1 的高度，panel3 自动填充剩余空间
        const maxH1 = containerHeight - panel2.offsetHeight - MIN_HEIGHT;
        const newH1 = Math.max(MIN_HEIGHT, Math.min(maxH1, startH + diff));
        
        panel1.style.flex = 'none';
        panel1.style.height = newH1 + 'px';
      } else {
        // resizer2: 调整 panel2 的高度，panel3 自动填充剩余空间
        const maxH2 = containerHeight - panel1.offsetHeight - MIN_HEIGHT;
        const newH2 = Math.max(MIN_HEIGHT, Math.min(maxH2, startH + diff));
        
        panel2.style.flex = 'none';
        panel2.style.height = newH2 + 'px';
      }
      resizeRAF = null;
    });
  }

  function stopResize() {
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    virtualState.viewportHeight = elements.packetList.parentElement.clientHeight;
    requestVisibleRange();
  }

  resizer1.addEventListener('mousedown', (e) => initResize(e, 1));
  if (resizer2) {
    resizer2.addEventListener('mousedown', (e) => initResize(e, 2));
  }
}

// ============================================
// 协议详情显示
// ============================================
function showProtocolDetails(packet) {
  let html = '';

  if (packet.layers && packet.layers.length > 0) {
    packet.layers.forEach((layer, index) => {
      const isExpanded = index < 2;
      html += `
        <div class="tree-node">
          <div class="tree-header" onclick="toggleTreeNode(this)">
            <span class="tree-icon">${isExpanded ? '▼' : '▶'}</span>
            <span class="tree-label">${layer.name}</span>
            <span class="tree-summary">${layer.short || ''}</span>
          </div>
          <div class="tree-content ${isExpanded ? 'expanded' : ''}">
            ${layer.fields.map(f => `
              <div class="tree-field">
                <span class="field-name">${f.name}:</span>
                <span class="field-value">${f.value}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
  } else {
    html = `
      <div class="tree-node">
        <div class="tree-header" onclick="toggleTreeNode(this)">
          <span class="tree-icon">▼</span>
          <span class="tree-label">数据包信息</span>
        </div>
        <div class="tree-content expanded">
          <div class="tree-field"><span class="field-name">时间:</span><span class="field-value">${packet.timestamp}</span></div>
          <div class="tree-field"><span class="field-name">源地址:</span><span class="field-value">${packet.srcIp || '-'}${packet.srcPort ? ':' + packet.srcPort : ''}</span></div>
          <div class="tree-field"><span class="field-name">目标地址:</span><span class="field-value">${packet.dstIp || '-'}${packet.dstPort ? ':' + packet.dstPort : ''}</span></div>
          <div class="tree-field"><span class="field-name">协议:</span><span class="field-value">${packet.protocol || 'UNKNOWN'}</span></div>
          <div class="tree-field"><span class="field-name">长度:</span><span class="field-value">${packet.length || '-'} bytes</span></div>
          <div class="tree-field"><span class="field-name">信息:</span><span class="field-value">${escapeHtml(packet.info || '-')}</span></div>
        </div>
      </div>
    `;
  }

  if (packet.appProtocol) {
    html += `
      <div class="tree-node">
        <div class="tree-header" onclick="toggleTreeNode(this)">
          <span class="tree-icon">▶</span>
          <span class="tree-label">应用层</span>
          <span class="tree-summary">${packet.appProtocol}</span>
        </div>
        <div class="tree-content">
          <div class="tree-field"><span class="field-name">协议:</span><span class="field-value">${packet.appProtocol}</span></div>
          ${packet.payloadLen ? `<div class="tree-field"><span class="field-name">载荷长度:</span><span class="field-value">${packet.payloadLen} bytes</span></div>` : ''}
        </div>
      </div>
    `;
  }

  elements.protocolTree.innerHTML = html;
}

window.toggleTreeNode = function(header) {
  const icon = header.querySelector('.tree-icon');
  const content = header.nextElementSibling;
  
  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    icon.textContent = '▶';
  } else {
    content.classList.add('expanded');
    icon.textContent = '▼';
  }
};

// ============================================
// 十六进制显示
// ============================================
function showHexDump(packet) {
  const bytes = packet.rawBytes || [];
  if (bytes.length === 0) {
    elements.hexViewer.innerHTML = '<div class="placeholder">无原始数据可显示</div>';
    return;
  }

  let html = '';
  const bytesPerLine = 16;

  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const offset = i.toString(16).padStart(8, '0').toUpperCase();
    const lineBytes = bytes.slice(i, i + bytesPerLine);
    
    let hexPart = '';
    for (let j = 0; j < bytesPerLine; j++) {
      if (j < lineBytes.length) {
        hexPart += `<span>${lineBytes[j].toString(16).padStart(2, '0').toUpperCase()}</span> `;
      } else {
        hexPart += '   ';
      }
      if (j === 7) hexPart += ' ';
    }

    let asciiPart = '';
    for (let j = 0; j < lineBytes.length; j++) {
      const b = lineBytes[j];
      asciiPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
    }

    html += `<div class="hex-line">
      <span class="hex-offset">${offset}</span>
      <span class="hex-bytes">${hexPart}</span>
      <span class="hex-ascii">${escapeHtml(asciiPart)}</span>
    </div>`;
  }

  elements.hexViewer.innerHTML = html;
}

// ============================================
// 工具函数
// ============================================
function handleError(error) {
  showToast(`错误: ${error}`, 'error');
}

function handleStopped() {
  isCapturing = false;
  updateUI();
}

function updateUI() {
  elements.btnStart.disabled = isCapturing;
  elements.btnStop.disabled = !isCapturing;
  
  if (isCapturing) {
    elements.statusIndicator.classList.add('running');
    elements.statusText.textContent = '正在抓包...';
  } else {
    elements.statusIndicator.classList.remove('running');
    elements.statusText.textContent = '就绪';
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// 统计弹窗
// ============================================
async function showStatistics() {
  const stats = await window.api.getStatistics();
  
  document.getElementById('stat-total').textContent = stats.total.toLocaleString();
  
  const protocolColors = {
    TCP: '#60a5fa', UDP: '#4ade80', ICMP: '#fbbf24', DNS: '#c084fc', 
    HTTP: '#22d3ee', HTTPS: '#2dd4bf', Unknown: '#94a3b8'
  };
  const maxProto = Math.max(...Object.values(stats.protocols), 1);
  document.getElementById('stat-protocols').innerHTML = Object.entries(stats.protocols)
    .sort((a, b) => b[1] - a[1])
    .map(([proto, count]) => `
      <div class="stat-bar">
        <span class="stat-bar-label">${proto}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width: ${(count / maxProto * 100).toFixed(1)}%; background: ${protocolColors[proto] || '#94a3b8'}"></div>
        </div>
        <span class="stat-bar-value">${count}</span>
      </div>
    `).join('');
  
  document.getElementById('stat-sources').innerHTML = Object.entries(stats.topSources)
    .map(([ip, count]) => `
      <div class="stat-list-item">
        <span class="stat-list-ip">${ip}</span>
        <span class="stat-list-count">${count}</span>
      </div>
    `).join('') || '<div style="color: var(--text-muted); text-align: center; padding: 20px;">暂无数据</div>';
  
  document.getElementById('stat-destinations').innerHTML = Object.entries(stats.topDestinations)
    .map(([ip, count]) => `
      <div class="stat-list-item">
        <span class="stat-list-ip">${ip}</span>
        <span class="stat-list-count">${count}</span>
      </div>
    `).join('') || '<div style="color: var(--text-muted); text-align: center; padding: 20px;">暂无数据</div>';
  
  document.getElementById('stats-modal').style.display = 'flex';
}

function hideStatistics() {
  document.getElementById('stats-modal').style.display = 'none';
}

// ============================================
// WinDivert 过滤表达式自动补全
// ============================================
const FILTER_KEYWORDS = [
  // === 协议过滤 ===
  { keyword: 'tcp', desc: 'TCP 协议', category: 'protocol' },
  { keyword: 'udp', desc: 'UDP 协议', category: 'protocol' },
  { keyword: 'icmp', desc: 'ICMP 协议', category: 'protocol' },
  { keyword: 'icmpv6', desc: 'ICMPv6 协议', category: 'protocol' },
  { keyword: 'ip', desc: 'IPv4 数据包', category: 'protocol' },
  { keyword: 'ipv6', desc: 'IPv6 数据包', category: 'protocol' },
  
  // === 方向过滤 ===
  { keyword: 'inbound', desc: '入站流量', category: 'direction' },
  { keyword: 'outbound', desc: '出站流量', category: 'direction' },
  { keyword: 'loopback', desc: '本地回环', category: 'direction' },
  { keyword: 'impostor', desc: '伪装包', category: 'direction' },
  
  // === IP 字段 ===
  { keyword: 'ip.SrcAddr', desc: '源 IP 地址', category: 'field' },
  { keyword: 'ip.DstAddr', desc: '目标 IP 地址', category: 'field' },
  { keyword: 'ip.Protocol', desc: 'IP 协议号', category: 'field' },
  { keyword: 'ip.TTL', desc: '生存时间', category: 'field' },
  { keyword: 'ip.Length', desc: 'IP 包总长度', category: 'field' },
  { keyword: 'ip.Id', desc: 'IP 标识符', category: 'field' },
  { keyword: 'ip.Checksum', desc: 'IP 头校验和', category: 'field' },
  { keyword: 'ip.DF', desc: '不分片标志', category: 'field' },
  { keyword: 'ip.MF', desc: '更多分片标志', category: 'field' },
  { keyword: 'ip.FragOff', desc: '分片偏移', category: 'field' },
  { keyword: 'ip.HdrLength', desc: 'IP 头长度', category: 'field' },
  
  // === IPv6 字段 ===
  { keyword: 'ipv6.SrcAddr', desc: '源 IPv6 地址', category: 'field' },
  { keyword: 'ipv6.DstAddr', desc: '目标 IPv6 地址', category: 'field' },
  { keyword: 'ipv6.NextHdr', desc: '下一头部类型', category: 'field' },
  { keyword: 'ipv6.HopLimit', desc: '跳数限制', category: 'field' },
  { keyword: 'ipv6.Length', desc: '负载长度', category: 'field' },
  { keyword: 'ipv6.TrafficClass', desc: '流量类别', category: 'field' },
  { keyword: 'ipv6.FlowLabel', desc: '流标签', category: 'field' },
  
  // === TCP 字段 ===
  { keyword: 'tcp.SrcPort', desc: 'TCP 源端口', category: 'field' },
  { keyword: 'tcp.DstPort', desc: 'TCP 目标端口', category: 'field' },
  { keyword: 'tcp.SeqNum', desc: '序列号', category: 'field' },
  { keyword: 'tcp.AckNum', desc: '确认号', category: 'field' },
  { keyword: 'tcp.Window', desc: '窗口大小', category: 'field' },
  { keyword: 'tcp.Checksum', desc: 'TCP 校验和', category: 'field' },
  { keyword: 'tcp.UrgPtr', desc: '紧急指针', category: 'field' },
  { keyword: 'tcp.HdrLength', desc: 'TCP 头长度', category: 'field' },
  { keyword: 'tcp.PayloadLength', desc: 'TCP 负载长度', category: 'field' },
  // TCP 标志
  { keyword: 'tcp.Syn', desc: 'SYN 标志 (连接请求)', category: 'flag' },
  { keyword: 'tcp.Ack', desc: 'ACK 标志 (确认)', category: 'flag' },
  { keyword: 'tcp.Fin', desc: 'FIN 标志 (连接结束)', category: 'flag' },
  { keyword: 'tcp.Rst', desc: 'RST 标志 (连接重置)', category: 'flag' },
  { keyword: 'tcp.Psh', desc: 'PSH 标志 (推送)', category: 'flag' },
  { keyword: 'tcp.Urg', desc: 'URG 标志 (紧急)', category: 'flag' },
  { keyword: 'tcp.Ece', desc: 'ECE 标志', category: 'flag' },
  { keyword: 'tcp.Cwr', desc: 'CWR 标志', category: 'flag' },
  
  // === UDP 字段 ===
  { keyword: 'udp.SrcPort', desc: 'UDP 源端口', category: 'field' },
  { keyword: 'udp.DstPort', desc: 'UDP 目标端口', category: 'field' },
  { keyword: 'udp.Length', desc: 'UDP 数据报长度', category: 'field' },
  { keyword: 'udp.Checksum', desc: 'UDP 校验和', category: 'field' },
  { keyword: 'udp.PayloadLength', desc: 'UDP 负载长度', category: 'field' },
  
  // === ICMP 字段 ===
  { keyword: 'icmp.Type', desc: 'ICMP 类型', category: 'field' },
  { keyword: 'icmp.Code', desc: 'ICMP 代码', category: 'field' },
  { keyword: 'icmp.Checksum', desc: 'ICMP 校验和', category: 'field' },
  { keyword: 'icmp.Body', desc: 'ICMP 数据体', category: 'field' },
  
  // === ICMPv6 字段 ===
  { keyword: 'icmpv6.Type', desc: 'ICMPv6 类型', category: 'field' },
  { keyword: 'icmpv6.Code', desc: 'ICMPv6 代码', category: 'field' },
  { keyword: 'icmpv6.Checksum', desc: 'ICMPv6 校验和', category: 'field' },
  
  // === 运算符 ===
  { keyword: '==', desc: '等于', category: 'operator' },
  { keyword: '!=', desc: '不等于', category: 'operator' },
  { keyword: '>', desc: '大于', category: 'operator' },
  { keyword: '<', desc: '小于', category: 'operator' },
  { keyword: '>=', desc: '大于等于', category: 'operator' },
  { keyword: '<=', desc: '小于等于', category: 'operator' },
  { keyword: 'and', desc: '逻辑与 (&&)', category: 'operator' },
  { keyword: 'or', desc: '逻辑或 (||)', category: 'operator' },
  { keyword: 'not', desc: '逻辑非 (!)', category: 'operator' },
  { keyword: '?', desc: '条件运算符', category: 'operator' },
  
  // === 常量 ===
  { keyword: 'true', desc: '捕获所有流量', category: 'const' },
  { keyword: 'false', desc: '不捕获任何流量', category: 'const' },
  
  // === 常用过滤表达式示例 ===
  // IP 地址过滤
  { keyword: 'ip.SrcAddr == 192.168.1.1', desc: '按源IP过滤', category: 'example' },
  { keyword: 'ip.DstAddr == 192.168.1.1', desc: '按目标IP过滤', category: 'example' },
  { keyword: 'ip.SrcAddr == 192.168.1.0/24', desc: '按源IP网段过滤', category: 'example' },
  { keyword: 'ip.DstAddr == 192.168.1.0/24', desc: '按目标IP网段过滤', category: 'example' },
  { keyword: 'ip.SrcAddr != 127.0.0.1', desc: '排除本地源地址', category: 'example' },
  
  // 端口过滤
  { keyword: 'tcp.DstPort == 80', desc: 'HTTP 流量 (80)', category: 'example' },
  { keyword: 'tcp.DstPort == 443', desc: 'HTTPS 流量 (443)', category: 'example' },
  { keyword: 'tcp.DstPort == 22', desc: 'SSH 流量 (22)', category: 'example' },
  { keyword: 'tcp.DstPort == 3389', desc: 'RDP 流量 (3389)', category: 'example' },
  { keyword: 'tcp.DstPort == 3306', desc: 'MySQL 流量 (3306)', category: 'example' },
  { keyword: 'tcp.DstPort == 6379', desc: 'Redis 流量 (6379)', category: 'example' },
  { keyword: 'udp.DstPort == 53', desc: 'DNS 查询 (53)', category: 'example' },
  { keyword: 'udp.DstPort == 123', desc: 'NTP 时间同步 (123)', category: 'example' },
  { keyword: 'udp.DstPort == 67 or udp.DstPort == 68', desc: 'DHCP 流量', category: 'example' },
  
  // 端口范围
  { keyword: 'tcp.DstPort >= 1 and tcp.DstPort <= 1024', desc: '知名端口范围', category: 'example' },
  { keyword: 'tcp.DstPort > 49152', desc: '动态/私有端口', category: 'example' },
  
  // TCP 标志组合
  { keyword: 'tcp.Syn', desc: '包含 SYN 的包', category: 'example' },
  { keyword: 'tcp.Syn and not tcp.Ack', desc: 'TCP 连接请求 (SYN)', category: 'example' },
  { keyword: 'tcp.Syn and tcp.Ack', desc: 'TCP 连接响应 (SYN-ACK)', category: 'example' },
  { keyword: 'tcp.Fin', desc: 'TCP 连接结束 (FIN)', category: 'example' },
  { keyword: 'tcp.Rst', desc: 'TCP 连接重置 (RST)', category: 'example' },
  { keyword: 'tcp.Psh and tcp.Ack', desc: 'TCP 数据推送', category: 'example' },
  
  // 方向组合
  { keyword: 'inbound and tcp', desc: '入站 TCP 流量', category: 'example' },
  { keyword: 'outbound and tcp', desc: '出站 TCP 流量', category: 'example' },
  { keyword: 'not loopback', desc: '排除本地回环', category: 'example' },
  
  // 复合过滤
  { keyword: 'tcp.SrcPort == 80 or tcp.DstPort == 80', desc: 'HTTP 双向流量', category: 'example' },
  { keyword: 'tcp.SrcPort == 443 or tcp.DstPort == 443', desc: 'HTTPS 双向流量', category: 'example' },
  { keyword: 'udp.SrcPort == 53 or udp.DstPort == 53', desc: 'DNS 双向流量', category: 'example' },
  { keyword: '(tcp.DstPort == 80 or tcp.DstPort == 443) and outbound', desc: '出站 Web 流量', category: 'example' },
  { keyword: 'tcp and ip.DstAddr == 192.168.1.1', desc: '发往指定 IP 的 TCP', category: 'example' },
  
  // ICMP 过滤
  { keyword: 'icmp.Type == 8', desc: 'ICMP Echo 请求 (Ping)', category: 'example' },
  { keyword: 'icmp.Type == 0', desc: 'ICMP Echo 响应 (Pong)', category: 'example' },
  { keyword: 'icmp.Type == 3', desc: 'ICMP 目标不可达', category: 'example' },
  { keyword: 'icmp.Type == 11', desc: 'ICMP 超时', category: 'example' },
  
  // 包长度过滤
  { keyword: 'ip.Length > 1000', desc: '大数据包 (>1000字节)', category: 'example' },
  { keyword: 'ip.Length < 100', desc: '小数据包 (<100字节)', category: 'example' },
  { keyword: 'tcp.PayloadLength > 0', desc: '有负载的 TCP 包', category: 'example' },
  { keyword: 'tcp.PayloadLength == 0', desc: '无负载的 TCP 包', category: 'example' },
  
  // TTL 过滤
  { keyword: 'ip.TTL == 64', desc: 'Linux/Android 系统', category: 'example' },
  { keyword: 'ip.TTL == 128', desc: 'Windows 系统', category: 'example' },
  { keyword: 'ip.TTL < 10', desc: '低 TTL 包 (跟踪路由)', category: 'example' },
];

let autocompleteIndex = -1;

// 历史记录
const FILTER_HISTORY_KEY = 'packetcapture_filter_history';
const MAX_HISTORY = 10;

function getFilterHistory() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFilterHistory(filter) {
  if (!filter || filter.trim().length < 2) return;
  const history = getFilterHistory().filter(h => h !== filter);
  history.unshift(filter);
  if (history.length > MAX_HISTORY) history.pop();
  localStorage.setItem(FILTER_HISTORY_KEY, JSON.stringify(history));
}

// 类别名称映射
const CATEGORY_NAMES = {
  history: '🕒 历史记录',
  protocol: '📡 协议',
  direction: '↔️ 方向',
  field: '📋 字段',
  flag: '🚩 标志',
  operator: '⚙️ 运算符',
  const: '📌 常量',
  example: '💡 示例'
};

// 上下文智能提示
function getContextKeywords(inputValue) {
  const lastWord = getLastWord(inputValue);
  const beforeLastWord = inputValue.substring(0, inputValue.length - lastWord.length).trim();
  
  // 如果输入了 "ip." 只显示 IP 字段
  if (lastWord.startsWith('ip.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('ip.'));
  }
  if (lastWord.startsWith('ipv6.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('ipv6.'));
  }
  if (lastWord.startsWith('tcp.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('tcp.'));
  }
  if (lastWord.startsWith('udp.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('udp.'));
  }
  if (lastWord.startsWith('icmp.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('icmp.'));
  }
  if (lastWord.startsWith('icmpv6.')) {
    return FILTER_KEYWORDS.filter(k => k.keyword.startsWith('icmpv6.'));
  }
  
  // 如果前面有字段名，提示运算符
  if (beforeLastWord.match(/\.(SrcAddr|DstAddr|SrcPort|DstPort|TTL|Length|Type|Code|Protocol)$/i)) {
    return FILTER_KEYWORDS.filter(k => k.category === 'operator');
  }
  
  // 如果前面有运算符，提示常量或示例
  if (beforeLastWord.match(/(==|!=|>|<|>=|<=)\s*$/)) {
    return FILTER_KEYWORDS.filter(k => k.category === 'const' || k.category === 'example');
  }
  
  // 如果前面有 and/or，提示协议和字段
  if (beforeLastWord.match(/(and|or|not)\s*$/i)) {
    return FILTER_KEYWORDS.filter(k => 
      k.category === 'protocol' || k.category === 'direction' || 
      k.category === 'field' || k.category === 'flag'
    );
  }
  
  return FILTER_KEYWORDS;
}

// 模糊匹配
function fuzzyMatch(keyword, search) {
  const kw = keyword.toLowerCase();
  const s = search.toLowerCase();
  
  // 精确前缀匹配优先
  if (kw.startsWith(s)) return { match: true, score: 100 };
  
  // 包含匹配
  if (kw.includes(s)) return { match: true, score: 50 };
  
  // 模糊匹配（字符顺序匹配）
  let si = 0;
  for (let ki = 0; ki < kw.length && si < s.length; ki++) {
    if (kw[ki] === s[si]) si++;
  }
  if (si === s.length) return { match: true, score: 20 };
  
  return { match: false, score: 0 };
}

function setupFilterAutocomplete() {
  const input = elements.filterInput;
  const dropdown = document.getElementById('filter-autocomplete');
  
  // 点击输入框时显示历史和常用
  input.addEventListener('focus', () => {
    if (input.value.trim() === '') {
      showHistoryAndCommon();
    }
  });
  
  input.addEventListener('input', () => {
    const value = input.value;
    const lastWord = getLastWord(value);
    
    if (lastWord.length < 1) {
      if (value.trim() === '') {
        showHistoryAndCommon();
      } else {
        hideAutocomplete();
      }
      return;
    }
    
    // 获取上下文相关关键词
    const contextKeywords = getContextKeywords(value);
    
    // 模糊匹配并排序
    const matches = contextKeywords
      .map(item => ({ ...item, ...fuzzyMatch(item.keyword, lastWord) }))
      .filter(item => item.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    
    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }
    
    showAutocomplete(matches, lastWord);
  });
  
  input.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('visible')) {
      // Enter 时保存历史
      if (e.key === 'Enter') {
        saveFilterHistory(input.value.trim());
      }
      return;
    }
    
    const items = dropdown.querySelectorAll('.autocomplete-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
      updateAutocompleteSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
      updateAutocompleteSelection(items);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (autocompleteIndex >= 0 && items[autocompleteIndex]) {
        e.preventDefault();
        selectAutocompleteItem(items[autocompleteIndex].dataset.keyword, items[autocompleteIndex].dataset.replace === 'true');
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  });
  
  input.addEventListener('blur', () => {
    setTimeout(hideAutocomplete, 200);
  });
  
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      selectAutocompleteItem(item.dataset.keyword, item.dataset.replace === 'true');
    }
  });
}

// 显示历史和常用
function showHistoryAndCommon() {
  const dropdown = document.getElementById('filter-autocomplete');
  autocompleteIndex = -1;
  
  const history = getFilterHistory();
  const common = FILTER_KEYWORDS.filter(k => k.category === 'protocol' || k.category === 'example').slice(0, 6);
  
  let html = '';
  
  // 历史记录
  if (history.length > 0) {
    html += `<div class="autocomplete-category">${CATEGORY_NAMES.history}</div>`;
    html += history.map(h => `
      <div class="autocomplete-item history-item" data-keyword="${escapeHtml(h)}" data-replace="true">
        <span class="keyword">${escapeHtml(h)}</span>
        <span class="desc">点击使用</span>
      </div>
    `).join('');
  }
  
  // 常用
  html += `<div class="autocomplete-category">${CATEGORY_NAMES.protocol}</div>`;
  html += common.filter(k => k.category === 'protocol').map(item => `
    <div class="autocomplete-item" data-keyword="${item.keyword}">
      <span class="keyword">${item.keyword}</span>
      <span class="desc">${item.desc}</span>
    </div>
  `).join('');
  
  html += `<div class="autocomplete-category">${CATEGORY_NAMES.example}</div>`;
  html += common.filter(k => k.category === 'example').map(item => `
    <div class="autocomplete-item" data-keyword="${item.keyword}" data-replace="true">
      <span class="keyword">${item.keyword}</span>
      <span class="desc">${item.desc}</span>
    </div>
  `).join('');
  
  dropdown.innerHTML = html;
  dropdown.classList.add('visible');
}

function getLastWord(text) {
  // 获取最后一个单词（在空格、括号或运算符后）
  const match = text.match(/[a-zA-Z0-9._\/]+$/)
  return match ? match[0] : '';
}

function showAutocomplete(matches, searchWord) {
  const dropdown = document.getElementById('filter-autocomplete');
  autocompleteIndex = -1;
  
  // 按类别分组
  const grouped = {};
  matches.forEach(item => {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });
  
  let html = '';
  const categoryOrder = ['protocol', 'direction', 'field', 'flag', 'operator', 'const', 'example'];
  
  categoryOrder.forEach(cat => {
    if (grouped[cat] && grouped[cat].length > 0) {
      html += `<div class="autocomplete-category">${CATEGORY_NAMES[cat] || cat}</div>`;
      html += grouped[cat].map(item => {
        // 高亮匹配部分
        const highlighted = highlightMatch(item.keyword, searchWord);
        const isExample = item.category === 'example';
        return `
          <div class="autocomplete-item" data-keyword="${item.keyword}" data-replace="${isExample}">
            <span class="keyword">${highlighted}</span>
            <span class="desc">${item.desc}</span>
          </div>
        `;
      }).join('');
    }
  });
  
  dropdown.innerHTML = html;
  dropdown.classList.add('visible');
}

// 高亮匹配文字
function highlightMatch(text, search) {
  if (!search) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) + 
         '<b>' + escapeHtml(text.substring(idx, idx + search.length)) + '</b>' + 
         escapeHtml(text.substring(idx + search.length));
}

function hideAutocomplete() {
  const dropdown = document.getElementById('filter-autocomplete');
  if (dropdown) {
    dropdown.classList.remove('visible');
    autocompleteIndex = -1;
  }
}

function updateAutocompleteSelection(items) {
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === autocompleteIndex);
  });
  // 滚动到可见区域
  if (items[autocompleteIndex]) {
    items[autocompleteIndex].scrollIntoView({ block: 'nearest' });
  }
}

function selectAutocompleteItem(keyword, replaceAll = false) {
  const input = elements.filterInput;
  
  if (replaceAll) {
    // 替换整个输入框（用于历史和示例）
    input.value = keyword;
  } else {
    const value = input.value;
    const lastWord = getLastWord(value);
    // 替换最后一个单词
    const newValue = value.substring(0, value.length - lastWord.length) + keyword;
    input.value = newValue;
  }
  
  input.focus();
  hideAutocomplete();
}

// ============================================
// 启动
// ============================================
init();
