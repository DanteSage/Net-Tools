/**
 * SFTP 可视化文件管理器前端控制器
 * @module terminal/sftp-client
 */

// ==================== 全局状态与初始化 ====================

let sftpInitialized = false;

// DOM 元素引用缓存
let sftpPanel = null;
let sftpPathBar = null;
let sftpFileList = null;
let sftpBtnBack = null;
let sftpBtnRefresh = null;
let sftpBtnMkdir = null;
let sftpBtnUpload = null;
let sftpProgressContainer = null;
let sftpProgressFilename = null;
let sftpProgressPercent = null;
let sftpProgressFill = null;
let sftpContextMenu = null;

// 右键菜单选中项缓存
let sftpContextActiveItem = null;

/**
 * 初始化 SFTP 文件管理器
 */
function initSftpClient() {
    if (sftpInitialized) return;
    
    // 缓存 DOM 元素
    sftpPanel = document.getElementById('sftp-panel');
    sftpPathBar = document.getElementById('sftp-path-bar');
    sftpFileList = document.getElementById('sftp-file-list');
    sftpBtnBack = document.getElementById('sftp-btn-back');
    sftpBtnRefresh = document.getElementById('sftp-btn-refresh');
    sftpBtnMkdir = document.getElementById('sftp-btn-mkdir');
    sftpBtnUpload = document.getElementById('sftp-btn-upload');
    sftpProgressContainer = document.getElementById('sftp-progress-container');
    sftpProgressFilename = document.getElementById('sftp-progress-filename');
    sftpProgressPercent = document.getElementById('sftp-progress-percent');
    sftpProgressFill = document.getElementById('sftp-progress-fill');
    
    // 创建右键菜单元素并追加到 body
    createSftpContextMenu();
    
    // 绑定顶部操作按钮监听
    sftpBtnBack.addEventListener('click', handleSftpBack);
    sftpBtnRefresh.addEventListener('click', handleSftpRefresh);
    sftpBtnMkdir.addEventListener('click', handleSftpMkdir);
    sftpBtnUpload.addEventListener('click', handleSftpUpload);
    
    // 注册 HTML5 拖拽上传事件
    initSftpDragAndDrop();
    
    // 监听主进程文件传输进度通知
    window.api.sftp.removeProgressListener();
    window.api.sftp.onProgress((data) => {
        const activeSession = getActiveSession();
        if (activeSession && (activeSession.connectionId === data.connectionId || activeSession.ftpConnectionId === data.connectionId)) {
            updateSftpProgress(data);
        }
    });
    
    // 全局点击关闭右键菜单
    document.addEventListener('click', hideSftpContextMenu);
    window.addEventListener('blur', hideSftpContextMenu);
    
    sftpInitialized = true;
}

// ==================== 视图切换与控制 ====================

/**
 * 切换 SFTP 面板显示状态
 */
async function toggleSftp(forceFtp = false) {
    const session = getActiveSession();
    if (!session || (session.connectionType !== 'ssh' && session.connectionType !== 'ftp' && session.connectionType !== 'telnet') || !session.connected) {
        showToast('仅支持已连接的 SSH/FTP/Telnet 会话文件管理', 'warning');
        return;
    }
    
    initSftpClient();
    
    // 如果强制以 FTP 方式打开 SSH 伴生文件管理，且尚未建立 FTP 后台连接，则动态发起连接
    if (forceFtp && session.connectionType === 'ssh' && !session.ftpConnectionId) {
        const device = session.deviceConfig;
        if (!device || !device.host) {
            showToast('无法发起 FTP 连接：缺失设备配置信息', 'warning');
            return;
        }
        
        showToast(`正在尝试建立 SSH 伴生 FTP 连接 (${device.host}:21)...`, 'info');
        
        // 展示面板，展现连线加载中状态
        sftpPanel.classList.remove('hidden');
        session.sftpOpen = true;
        sftpFileList.innerHTML = `
            <div class="sftp-empty-state">
                <svg class="animate-spin" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16v2c5.52 0 10-4.48 10-10h-2c0 4.41-3.59 8-8 8z" style="opacity: 0.3"/>
                    <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8z"/>
                </svg>
                <span>正在建立 SSH 伴生 FTP 连接...</span>
            </div>
        `;
        
        // 重新适配终端宽度
        setTimeout(() => {
            if (session.fitAddon) {
                try { session.fitAddon.fit(); } catch (e) {}
            }
        }, 320);
        
        try {
            // 给网络交换机少许后台响应与就绪时间 (800ms)，防范第一帧高吞吐并发导致 ECONNREFUSED
            await new Promise(resolve => setTimeout(resolve, 800));
            
            const result = await window.api.ftp.connect({
                host: device.host,
                port: 21,
                username: device.username,
                password: device.password
            });
            
            if (result.success) {
                session.ftpConnectionId = result.connectionId;
                session.useFtpFallback = true;
                showToast('SSH 伴生 FTP 服务已成功挂载', 'success');
                
                // 延迟 500ms 发起首次 LIST 请求，以避开交换机连接并发繁忙引起的端口拒绝
                setTimeout(() => {
                    loadSftpDirectory(session, '/');
                }, 500);
                
                if (typeof window.updateSftpVisibility === 'function') {
                    window.updateSftpVisibility();
                }
            } else {
                sftpPanel.classList.add('hidden');
                session.sftpOpen = false;
                showToast(`FTP 连接失败: ${result.error}`, 'error');
            }
        } catch (err) {
            sftpPanel.classList.add('hidden');
            session.sftpOpen = false;
            showToast(`FTP 连接出错: ${err.message}`, 'error');
        }
        
        // 重新适配终端宽度
        setTimeout(() => {
            if (session.fitAddon) {
                try { session.fitAddon.fit(); } catch (e) {}
            }
        }, 320);
        return;
    }
    
    const isHidden = sftpPanel.classList.contains('hidden');
    
    if (isHidden) {
        // 如果是 Telnet 会话且还未在后台建立 FTP 模块连接，则动态发起连接
        if (session.connectionType === 'telnet' && !session.ftpConnectionId) {
            const device = session.deviceConfig;
            if (!device || !device.host) {
                showToast('无法发起 FTP 连接：缺失设备配置信息', 'warning');
                return;
            }
            
            showToast(`正在尝试建立交换机 FTP 后台连接 (${device.host}:21)...`, 'info');
            
            // 展示面板，展现连线加载中状态
            sftpPanel.classList.remove('hidden');
            session.sftpOpen = true;
            sftpFileList.innerHTML = `
                <div class="sftp-empty-state">
                    <svg class="animate-spin" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                        <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16v2c5.52 0 10-4.48 10-10h-2c0 4.41-3.59 8-8 8z" style="opacity: 0.3"/>
                        <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8z"/>
                    </svg>
                    <span>正在连接设备后台 FTP 模块...</span>
                </div>
            `;
            
            // 重新适配终端宽度
            setTimeout(() => {
                if (session.fitAddon) {
                    try { session.fitAddon.fit(); } catch (e) {}
                }
            }, 320);
            
            try {
                // 给后台服务 800ms 就绪时间
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const result = await window.api.ftp.connect({
                    host: device.host,
                    port: 21,
                    username: device.username,
                    password: device.password
                });
                
                if (result.success) {
                    session.ftpConnectionId = result.connectionId;
                    showToast('FTP 后台服务已成功挂载', 'success');
                    
                    // 延迟 500ms 加载以规避端口拒绝
                    setTimeout(() => {
                        loadSftpDirectory(session, '/');
                    }, 500);
                } else {
                    sftpPanel.classList.add('hidden');
                    session.sftpOpen = false;
                    showToast(`设备 FTP 模块连接失败: ${result.error}。请确认设备已在系统视图开启 FTP 并配置权限。`, 'error');
                }
            } catch (err) {
                sftpPanel.classList.add('hidden');
                session.sftpOpen = false;
                showToast(`FTP 连接出错: ${err.message}`, 'error');
            }
            
            // 重新适配终端宽度
            setTimeout(() => {
                if (session.fitAddon) {
                    try { session.fitAddon.fit(); } catch (e) {}
                }
            }, 320);
            return;
        }

        // 展示面板
        sftpPanel.classList.remove('hidden');
        session.sftpOpen = true;
        
        // 如果从未加载过该会话的目录，则加载默认根目录
        if (!session.sftpCurrentPath) {
            const defaultPath = (session.connectionType === 'ftp' || session.connectionType === 'telnet' || session.useFtpFallback) ? '/' : '.';
            loadSftpDirectory(session, defaultPath);
        } else {
            renderSftpFiles(session);
        }
    } else {
        // 收起面板
        sftpPanel.classList.add('hidden');
        session.sftpOpen = false;
    }
    
    // 重新适配终端宽度
    setTimeout(() => {
        if (session.fitAddon) {
            try { session.fitAddon.fit(); } catch (e) {}
        }
    }, 320); // 等待过渡动画完成
}

/**
 * 为 SSH 会话尝试建立后台 FTP 降级通道
 * @param {Object} session - 会话对象
 * @returns {Promise<boolean>} 是否连接成功
 */
async function tryFtpFallbackForSsh(session) {
    if (!session || !session.deviceConfig) return false;
    const device = session.deviceConfig;
    if (!device.host) return false;
    
    showToast(`SFTP 不可用，正在尝试建立备用 FTP 连接 (${device.host}:21)...`, 'info');
    try {
        const result = await window.api.ftp.connect({
            host: device.host,
            port: 21,
            username: device.username,
            password: device.password
        });
        
        if (result.success) {
            session.ftpConnectionId = result.connectionId;
            session.useFtpFallback = true;
            showToast('已成功通过备用 FTP 连接建立文件管理通道!', 'success');
            
            // 刷新标签页的 SFTP 按钮文字
            if (typeof window.updateSftpVisibility === 'function') {
                window.updateSftpVisibility();
            }
            return true;
        }
    } catch (e) {
        console.error('FTP fallback connection error:', e);
    }
    return false;
}

// ==================== 数据加载与渲染 ====================

/**
 * 载入 SFTP 目录列表
 * @param {Object} session - 会话对象
 * @param {string} path - 远程路径
 */
async function loadSftpDirectory(session, path) {
    const connId = (session.connectionType === 'telnet' || session.useFtpFallback) ? session.ftpConnectionId : session.connectionId;
    if (!session || !connId) return;
    
    // 渲染载入中状态
    sftpFileList.innerHTML = `
        <div class="sftp-empty-state">
            <svg class="animate-spin" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16v2c5.52 0 10-4.48 10-10h-2c0 4.41-3.59 8-8 8z" style="opacity: 0.3"/>
                <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8z"/>
            </svg>
            <span>加载目录中...</span>
        </div>
    `;
    
    try {
        const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet' || session.useFtpFallback) ? 'ftp' : 'sftp';
        const result = await window.api[apiType].list(connId, path);
        if (result.success) {
            session.sftpCurrentPath = result.currentPath;
            session.sftpFiles = result.files;
            
            // 如果面板仍是打开状态，则渲染
            if (session.sftpOpen && getActiveSession()?.id === session.id) {
                renderSftpFiles(session);
            }
        } else {
            // SFTP 失败时，如果尚未尝试过 FTP fallback，则尝试 FTP fallback
            if (apiType === 'sftp' && !session.ftpConnectionId && !session.useFtpFallback && session.deviceConfig) {
                const fallbackSuccess = await tryFtpFallbackForSsh(session);
                if (fallbackSuccess) {
                    loadSftpDirectory(session, '/');
                    return;
                }
            }
            
            sftpFileList.innerHTML = `
                <div class="sftp-empty-state">
                    <span style="color: var(--text-danger);">读取失败: ${result.error}</span>
                </div>
            `;
            showToast(`${apiType.toUpperCase()} 读取失败: ` + result.error, 'error');
        }
    } catch (e) {
        // SFTP 失败时，如果尚未尝试过 FTP fallback，则尝试 FTP fallback
        const isSftp = !(session.connectionType === 'ftp' || session.connectionType === 'telnet' || session.useFtpFallback);
        if (isSftp && !session.ftpConnectionId && !session.useFtpFallback && session.deviceConfig) {
            const fallbackSuccess = await tryFtpFallbackForSsh(session);
            if (fallbackSuccess) {
                loadSftpDirectory(session, '/');
                return;
            }
        }
        
        sftpFileList.innerHTML = `
            <div class="sftp-empty-state">
                <span style="color: var(--text-danger);">读取出错</span>
            </div>
        `;
        showToast('SFTP 读取错误', 'error');
    }
}

/**
 * 渲染 SFTP 文件列表
 * @param {Object} session - 会话对象
 */
function renderSftpFiles(session) {
    if (!session || !session.sftpFiles) return;
    
    // 更新面包屑导航栏
    renderSftpBreadcrumbs(session, session.sftpCurrentPath);
    
    if (session.sftpFiles.length === 0) {
        sftpFileList.innerHTML = `
            <div class="sftp-empty-state">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" style="opacity: 0.4;">
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                <span>文件夹为空</span>
            </div>
        `;
        return;
    }
    
    // 按目录在前，文件在后排定，并按名称字母排序
    const sortedFiles = [...session.sftpFiles].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });
    
    sftpFileList.innerHTML = '';
    
    // 构建拖动遮罩元素
    const dragOverlay = document.createElement('div');
    dragOverlay.className = 'sftp-drag-overlay';
    dragOverlay.innerHTML = `
        <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
        </svg>
        <span>释放鼠标以上传到当前文件夹</span>
    `;
    sftpFileList.appendChild(dragOverlay);
    
    // 渲染每一个文件项
    sortedFiles.forEach(file => {
        const item = document.createElement('div');
        item.className = 'sftp-file-item';
        item.dataset.name = file.name;
        item.dataset.dir = file.isDirectory ? 'true' : 'false';
        
        // 区分文件夹和文件图标
        const iconHtml = file.isDirectory ? `
            <span class="sftp-file-icon folder">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
            </span>
        ` : `
            <span class="sftp-file-icon file">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
            </span>
        `;
        
        const sizeText = file.isDirectory ? '--' : formatBytes(file.size);
        const timeText = formatDate(file.mtime);
        
        item.innerHTML = `
            <div class="sftp-file-name-wrapper" title="${file.name}">
                ${iconHtml}
                <span class="sftp-file-name">${file.name}</span>
            </div>
            <div class="sftp-col-size">${sizeText}</div>
            <div class="sftp-col-time">${timeText}</div>
        `;
        
        // 双击事件：文件夹进入，文本文件在线编辑，常规二进制文件触发下载
        item.addEventListener('dblclick', () => {
            const remoteFullPath = session.sftpCurrentPath === '/' ? '/' + file.name : session.sftpCurrentPath + '/' + file.name;
            if (file.isDirectory) {
                loadSftpDirectory(session, remoteFullPath);
            } else if (isTextFile(file.name)) {
                openRemoteFileEditor(session, file.name, remoteFullPath);
            } else {
                handleSftpDownload(session, file.name, remoteFullPath);
            }
        });
        
        // 单击选中高亮
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            sftpFileList.querySelectorAll('.sftp-file-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
        });
        
        // 右键上下文菜单
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sftpFileList.querySelectorAll('.sftp-file-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            showSftpContextMenu(e.clientX, e.clientY, session, file);
        });
        
        sftpFileList.appendChild(item);
    });
}

/**
 * 渲染路径面包屑
 */
function renderSftpBreadcrumbs(session, path) {
    sftpPathBar.innerHTML = '';
    
    // 首节点：服务器根目录
    const rootNode = document.createElement('span');
    rootNode.className = 'sftp-breadcrumb-node';
    rootNode.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="display:inline-block; vertical-align:-2px;">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>根目录
    `;
    rootNode.addEventListener('click', () => loadSftpDirectory(session, '/'));
    sftpPathBar.appendChild(rootNode);
    
    if (path === '/' || !path) {
        rootNode.classList.add('active');
        return;
    }
    
    // 拆分各级路径并组装
    const parts = path.split('/').filter(p => p);
    let cumulativePath = '';
    
    parts.forEach((part, index) => {
        cumulativePath += '/' + part;
        
        // 渲染分隔符
        const separator = document.createElement('span');
        separator.className = 'sftp-breadcrumb-separator';
        separator.innerText = '/';
        sftpPathBar.appendChild(separator);
        
        // 渲染节点
        const node = document.createElement('span');
        node.className = 'sftp-breadcrumb-node';
        node.innerText = part;
        
        if (index === parts.length - 1) {
            node.classList.add('active');
        } else {
            const targetPath = cumulativePath;
            node.addEventListener('click', () => loadSftpDirectory(session, targetPath));
        }
        
        sftpPathBar.appendChild(node);
    });
    
    // 自动滑动到面包屑最右端
    setTimeout(() => { sftpPathBar.scrollLeft = sftpPathBar.scrollWidth; }, 50);
}

// ==================== 顶部交互操作处理器 ====================

/**
 * 返回上一级目录
 */
function handleSftpBack() {
    const session = getActiveSession();
    if (!session || !session.sftpCurrentPath || session.sftpCurrentPath === '/') return;
    
    const parts = session.sftpCurrentPath.split('/').filter(p => p);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    loadSftpDirectory(session, parentPath);
}

/**
 * 刷新当前文件夹
 */
function handleSftpRefresh() {
    const session = getActiveSession();
    if (!session || !session.sftpCurrentPath) return;
    loadSftpDirectory(session, session.sftpCurrentPath);
}

/**
 * 新建文件夹
 */
async function handleSftpMkdir() {
    const session = getActiveSession();
    if (!session || !session.sftpCurrentPath) return;
    
    // 使用美化的 HSL 弹出式提示模态框代替 native prompt
    const folderName = await showPrompt({
        title: '新建文件夹',
        message: '请输入新文件夹的名称',
        placeholder: '文件夹名称'
    });
    if (!folderName || !folderName.trim()) return;
    
    const fullPath = session.sftpCurrentPath === '/' ? '/' + folderName.trim() : session.sftpCurrentPath + '/' + folderName.trim();
    
    showToast('正在创建文件夹...', 'info');
    const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet') ? 'ftp' : 'sftp';
    const connId = session.connectionType === 'telnet' ? session.ftpConnectionId : session.connectionId;
    const result = await window.api[apiType].mkdir(connId, fullPath);
    if (result.success) {
        showToast('新建文件夹成功', 'success');
        loadSftpDirectory(session, session.sftpCurrentPath);
    } else {
        showToast('新建文件夹失败: ' + result.error, 'error');
    }
}

/**
 * 点击上传本地文件
 */
async function handleSftpUpload() {
    const session = getActiveSession();
    if (!session || !session.sftpCurrentPath) return;
    
    // 唤起原生打开文件对话框
    const localFilePath = await window.api.dialog.openFile({
        filters: [{ name: '所有文件', extensions: ['*'] }]
    });
    
    if (!localFilePath) return;
    
    // 获取文件名
    const filename = localFilePath.replace(/\\/g, '/').split('/').pop();
    const remoteFullPath = session.sftpCurrentPath === '/' ? '/' + filename : session.sftpCurrentPath + '/' + filename;
    
    await executeSftpUpload(session, localFilePath, remoteFullPath);
}

// ==================== 底层上传与下载执行器 ====================

/**
 * 执行 SFTP 上传
 */
async function executeSftpUpload(session, localPath, remotePath) {
    const filename = localPath.replace(/\\/g, '/').split('/').pop();
    
    // 初始化并展示进度条
    sftpProgressContainer.classList.remove('hidden');
    sftpProgressFilename.innerText = `正在上传: ${filename}`;
    sftpProgressPercent.innerText = '0%';
    sftpProgressFill.style.width = '0%';
    
    showToast(`开始上传 ${filename}...`, 'info');
    
    try {
        const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet') ? 'ftp' : 'sftp';
        const connId = session.connectionType === 'telnet' ? session.ftpConnectionId : session.connectionId;
        const result = await window.api[apiType].upload(connId, localPath, remotePath);
        sftpProgressContainer.classList.add('hidden');
        
        if (result.success) {
            showToast(`文件 ${filename} 上传成功!`, 'success');
            // 如果还在当前目录，则重载
            if (getActiveSession()?.id === session.id) {
                loadSftpDirectory(session, session.sftpCurrentPath);
            }
        } else {
            showToast(`文件 ${filename} 上传失败: ${result.error}`, 'error');
        }
    } catch (e) {
        sftpProgressContainer.classList.add('hidden');
        showToast(`上传出错: ${e.message}`, 'error');
    }
}

/**
 * 处理常规文件下载
 */
async function handleSftpDownload(session, filename, remoteFullPath) {
    // 调起保存对话框询问本地路径
    const localPath = await window.api.dialog.saveFile({
        defaultPath: filename,
        filters: [{ name: '所有文件', extensions: ['*'] }]
    });
    
    if (!localPath) return;
    
    // 展示进度面板
    sftpProgressContainer.classList.remove('hidden');
    sftpProgressFilename.innerText = `正在下载: ${filename}`;
    sftpProgressPercent.innerText = '0%';
    sftpProgressFill.style.width = '0%';
    
    showToast(`开始下载 ${filename}...`, 'info');
    
    try {
        const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet') ? 'ftp' : 'sftp';
        const connId = session.connectionType === 'telnet' ? session.ftpConnectionId : session.connectionId;
        const result = await window.api[apiType].download(connId, remoteFullPath, localPath);
        sftpProgressContainer.classList.add('hidden');
        
        if (result.success) {
            showToast(`文件 ${filename} 下载成功!`, 'success');
        } else {
            showToast(`文件 ${filename} 下载失败: ${result.error}`, 'error');
        }
    } catch (e) {
        sftpProgressContainer.classList.add('hidden');
        showToast(`下载出错: ${e.message}`, 'error');
    }
}

/**
 * 实时更新文件传输进度条
 */
function updateSftpProgress(data) {
    const percent = Math.round((data.transferred / data.total) * 100) || 0;
    const filename = data.localPath.replace(/\\/g, '/').split('/').pop();
    
    sftpProgressContainer.classList.remove('hidden');
    sftpProgressFilename.innerText = `${data.direction === 'upload' ? '正在上传' : '正在下载'}: ${filename}`;
    sftpProgressPercent.innerText = `${percent}%`;
    sftpProgressFill.style.width = `${percent}%`;
}

// ==================== HTML5 拖拽上传事件绑定 ====================

/**
 * 绑定拖拽事件
 */
function initSftpDragAndDrop() {
    // 阻止浏览器默认拖拽打开文件行为
    sftpFileList.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sftpFileList.classList.add('drag-over');
    });
    
    sftpFileList.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sftpFileList.classList.add('drag-over');
    });
    
    sftpFileList.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 仅在移出根容器时移除高亮样式
        if (e.target === sftpFileList || e.relatedTarget === null) {
            sftpFileList.classList.remove('drag-over');
        }
    });
    
    sftpFileList.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        sftpFileList.classList.remove('drag-over');
        
        const session = getActiveSession();
        if (!session || !session.sftpCurrentPath) return;
        
        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        
        // 遍历拖入的本地文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            const localPath = window.api.fs.getPathForFile(file);
            if (!localPath) continue;
            
            const filename = file.name;
            const remoteFullPath = session.sftpCurrentPath === '/' ? '/' + filename : session.sftpCurrentPath + '/' + filename;
            
            // 执行上传
            await executeSftpUpload(session, localPath, remoteFullPath);
        }
    });
}

// ==================== 右键上下文菜单管理 ====================

/**
 * 动态创建 SFTP 右键菜单
 */
function createSftpContextMenu() {
    if (document.getElementById('sftp-context-menu')) return;
    
    sftpContextMenu = document.createElement('div');
    sftpContextMenu.id = 'sftp-context-menu';
    sftpContextMenu.className = 'terminal-context-menu sftp-context-menu';
    sftpContextMenu.innerHTML = `
        <div class="context-menu-item" id="sftp-menu-edit">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
            <span>在线编辑</span>
        </div>
        <div class="context-menu-item" id="sftp-menu-download">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            <span>下载</span>
        </div>
        <div class="context-menu-item" id="sftp-menu-rename">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
            <span>重命名</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" id="sftp-menu-delete" style="color: var(--text-danger);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            <span>删除</span>
        </div>
    `;
    document.body.appendChild(sftpContextMenu);

    // 绑定右键项点击监听
    document.getElementById('sftp-menu-edit').addEventListener('click', () => {
        if (sftpContextActiveItem) {
            const { session, file } = sftpContextActiveItem;
            if (file.isDirectory) {
                showToast('目录不支持在线编辑', 'warning');
            } else {
                const remoteFullPath = session.sftpCurrentPath === '/' ? '/' + file.name : session.sftpCurrentPath + '/' + file.name;
                openRemoteFileEditor(session, file.name, remoteFullPath);
            }
        }
    });
    
    // 绑定右键项点击监听
    document.getElementById('sftp-menu-download').addEventListener('click', () => {
        if (sftpContextActiveItem) {
            const { session, file } = sftpContextActiveItem;
            if (file.isDirectory) {
                showToast('暂不支持可视化目录下载，请双击进入下载具体文件', 'warning');
            } else {
                const remoteFullPath = session.sftpCurrentPath === '/' ? '/' + file.name : session.sftpCurrentPath + '/' + file.name;
                handleSftpDownload(session, file.name, remoteFullPath);
            }
        }
    });
    
    document.getElementById('sftp-menu-rename').addEventListener('click', async () => {
        if (sftpContextActiveItem) {
            const { session, file } = sftpContextActiveItem;
            // 使用美化的 HSL 弹出式提示模态框代替 native prompt
            const newName = await showPrompt({
                title: '重命名',
                message: `请输入「${file.name}」的新名称`,
                defaultValue: file.name,
                placeholder: '新名称'
            });
            if (!newName || !newName.trim() || newName.trim() === file.name) return;
            
            const oldPath = session.sftpCurrentPath === '/' ? '/' + file.name : session.sftpCurrentPath + '/' + file.name;
            const newPath = session.sftpCurrentPath === '/' ? '/' + newName.trim() : session.sftpCurrentPath + '/' + newName.trim();
            
            showToast('正在重命名...', 'info');
            const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet') ? 'ftp' : 'sftp';
            const connId = session.connectionType === 'telnet' ? session.ftpConnectionId : session.connectionId;
            const result = await window.api[apiType].rename(connId, oldPath, newPath);
            if (result.success) {
                showToast('重命名成功', 'success');
                loadSftpDirectory(session, session.sftpCurrentPath);
            } else {
                showToast('重命名失败: ' + result.error, 'error');
            }
        }
    });
    
    document.getElementById('sftp-menu-delete').addEventListener('click', async () => {
        if (sftpContextActiveItem) {
            const { session, file } = sftpContextActiveItem;
            // 使用美化的 HSL 确认模态框代替 native confirm
            const confirmDel = await showConfirm({
                title: '确认删除',
                message: `您确定要删除 ${file.isDirectory ? '文件夹' : '文件'} 「${file.name}」吗？`,
                detail: file.isDirectory ? '此操作将递归删除文件夹下的所有内容且无法撤销！' : '此操作无法撤销。',
                confirmText: '删除',
                type: 'danger'
            });
            if (!confirmDel) return;
            
            const fullPath = session.sftpCurrentPath === '/' ? '/' + file.name : session.sftpCurrentPath + '/' + file.name;
            
            showToast('正在删除...', 'info');
            const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet') ? 'ftp' : 'sftp';
            const connId = session.connectionType === 'telnet' ? session.ftpConnectionId : session.connectionId;
            let result;
            if (file.isDirectory) {
                result = await window.api[apiType].rmdir(connId, fullPath);
            } else {
                result = await window.api[apiType].delete(connId, fullPath);
            }
            
            if (result.success) {
                showToast('删除成功', 'success');
                loadSftpDirectory(session, session.sftpCurrentPath);
            } else {
                showToast('删除失败: ' + result.error, 'error');
            }
        }
    });
}

/**
 * 呼出 SFTP 右键菜单
 */
function showSftpContextMenu(x, y, session, file) {
    sftpContextActiveItem = { session, file };
    
    // 隐藏/显示下载选项（目录暂不支持下载）
    const downloadItem = document.getElementById('sftp-menu-download');
    downloadItem.style.display = file.isDirectory ? 'none' : 'flex';
    
    // 隐藏/显示编辑选项（目录或非常规文本不支持编辑）
    const editItem = document.getElementById('sftp-menu-edit');
    if (editItem) {
        editItem.style.display = (file.isDirectory || !isTextFile(file.name)) ? 'none' : 'flex';
    }
    
    sftpContextMenu.style.left = `${x}px`;
    sftpContextMenu.style.top = `${y}px`;
    sftpContextMenu.classList.add('show');
}

/**
 * 隐藏右键菜单
 */
function hideSftpContextMenu() {
    if (sftpContextMenu) {
        sftpContextMenu.classList.remove('show');
    }
}

// ==================== 格式化与辅助工具函数 ====================

/**
 * 字节单位转换格式化
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 日期格式化
 */
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * 辅助方法：判断文件是否属于受支持的常规文本文件格式类型
 */
function isTextFile(filename) {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    const textExtensions = ['conf', 'sh', 'ini', 'json', 'txt', 'cfg', 'yml', 'yaml', 'xml', 'html', 'css', 'js', 'py', 'log', 'md'];
    return textExtensions.includes(ext) || !filename.includes('.'); // 类似 hosts/config 等无后缀配置文件也默认作为文本格式进行识别支持
}
