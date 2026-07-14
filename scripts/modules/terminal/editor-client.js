/**
 * 远程可视化文本编辑器前端控制器
 * @module terminal/editor-client
 */

let editorInitialized = false;

// DOM 元素缓存
let editorDrawer = null;
let editorBackdrop = null;
let editorFilename = null;
let editorFilepath = null;
let editorLineCount = null;
let editorCharCount = null;
let editorTextarea = null;
let editorGutter = null;
let btnSave = null;
let btnToggleWrap = null;
let btnClose = null;
let selectEditorEncoding = null;

// 编辑状态缓存
let editorActiveSession = null;
let editorActiveFilename = null;
let editorActivePath = null;
let editorOriginalContent = '';

/**
 * 初始化编辑器模块并绑定事件
 */
function initRemoteEditor() {
    if (editorInitialized) return;

    // 缓存元素
    editorDrawer = document.getElementById('remote-editor-drawer');
    editorBackdrop = document.getElementById('remote-editor-backdrop');
    editorFilename = document.getElementById('remote-editor-filename');
    editorFilepath = document.getElementById('remote-editor-filepath');
    editorLineCount = document.getElementById('editor-line-count');
    editorCharCount = document.getElementById('editor-char-count');
    editorTextarea = document.getElementById('remote-editor-textarea');
    editorGutter = document.getElementById('remote-editor-gutter');
    btnSave = document.getElementById('btn-editor-save');
    btnToggleWrap = document.getElementById('btn-editor-toggle-wrap');
    btnClose = document.getElementById('btn-editor-close');
    selectEditorEncoding = document.getElementById('select-editor-encoding');

    // 1. 文本框变化监听以维护行号和字数统计
    editorTextarea.addEventListener('input', () => {
        updateGutterAndStats();
    });

    // 2. 文本框滚动与行号绝对同步
    editorTextarea.addEventListener('scroll', () => {
        editorGutter.scrollTop = editorTextarea.scrollTop;
    });

    // 3. 高级快捷输入辅助监听 (Tab 转空格、回车对齐缩进)
    editorTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editorTextarea.selectionStart;
            const end = editorTextarea.selectionEnd;
            const val = editorTextarea.value;
            editorTextarea.value = val.substring(0, start) + "    " + val.substring(end);
            editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 4;
            updateGutterAndStats();
        } else if (e.key === 'Enter') {
            // 实现回车自动前导对齐 (Auto-indent)
            const start = editorTextarea.selectionStart;
            const val = editorTextarea.value;
            
            // 抓取当前光标所在行的文本
            const lastNewline = val.lastIndexOf('\n', start - 1);
            const currentLine = val.substring(lastNewline + 1, start);
            
            // 抓取前导空白并匹配继承
            const match = currentLine.match(/^\s*/);
            if (match && match[0].length > 0) {
                e.preventDefault();
                const indent = match[0];
                editorTextarea.value = val.substring(0, start) + "\n" + indent + val.substring(start);
                editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 1 + indent.length;
                updateGutterAndStats();
            }
        }
    });

    // 4. 自动换行切换控制
    btnToggleWrap.addEventListener('click', () => {
        const isWrap = editorTextarea.classList.toggle('wrap-active');
        const span = btnToggleWrap.querySelector('span');
        if (span) {
            span.textContent = `自动换行: ${isWrap ? '开' : '关'}`;
        }
        // 状态更新后强制刷新行号对齐
        setTimeout(updateGutterAndStats, 50);
    });

    // 5. 头部控制事件绑定
    btnSave.addEventListener('click', saveRemoteFile);
    btnClose.addEventListener('click', handleCloseEditorRequest);
    editorBackdrop.addEventListener('click', handleCloseEditorRequest);

    // 6. 全局 Ctrl+S 键盘事件注册
    document.addEventListener('keydown', (e) => {
        if (!editorDrawer.classList.contains('hidden') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            saveRemoteFile();
        }
    });
    
    // 7. 编码选择下拉框监听
    if (selectEditorEncoding) {
        selectEditorEncoding.addEventListener('change', handleEditorEncodingChange);
    }

    editorInitialized = true;
}

/**
 * 刷新行号指示器及字数统计
 */
function updateGutterAndStats() {
    if (!editorTextarea || !editorGutter) return;
    
    const text = editorTextarea.value;
    const lines = text.split('\n');
    const lineCount = lines.length;
    
    // 生成纯文本形式行号，避免大量 DOM 渲染开销
    let gutterContent = '';
    for (let i = 1; i <= lineCount; i++) {
        gutterContent += i + '\n';
    }
    
    editorGutter.textContent = gutterContent;
    
    // 强制同步绝对滚动高度
    editorGutter.scrollTop = editorTextarea.scrollTop;
    
    // 更新顶栏数据标签
    editorLineCount.innerText = `${lineCount} 行`;
    editorCharCount.innerText = `${text.length} 字符`;
}

/**
 * 调起远程文本编辑器抽屉并拉取内容
 * @param {Object} session - 会话对象
 * @param {string} filename - 文件名
 * @param {string} remotePath - 远程绝对路径
 */
async function openRemoteFileEditor(session, filename, remotePath) {
    if (!session || !remotePath) return;
    
    initRemoteEditor();
    
    // 初始化编辑状态变量
    editorActiveSession = session;
    editorActiveFilename = filename;
    editorActivePath = remotePath;
    editorOriginalContent = '';
    
    // 呈现编辑器滑出状态
    editorDrawer.classList.remove('hidden');
    editorFilename.innerText = filename;
    editorFilepath.innerText = remotePath;
    
    if (selectEditorEncoding) {
        selectEditorEncoding.value = session.encoding || 'utf-8';
    }
    
    // 置空并置于加载中状态
    editorTextarea.value = '';
    editorTextarea.disabled = true;
    editorTextarea.placeholder = '正在从远程服务器安全读取配置，请稍候...';
    updateGutterAndStats();
    
    try {
        const apiType = (session.connectionType === 'ftp' || session.connectionType === 'telnet' || session.useFtpFallback) ? 'ftp' : 'sftp';
        const connId = (session.connectionType === 'telnet' || session.useFtpFallback) ? session.ftpConnectionId : session.connectionId;
        const selectedEncoding = selectEditorEncoding ? selectEditorEncoding.value : (session.encoding || 'utf-8');
        
        const result = await window.api[apiType].readText(connId, remotePath, selectedEncoding);
        if (result.success) {
            editorTextarea.value = result.content;
            editorOriginalContent = result.content;
            editorTextarea.disabled = false;
            editorTextarea.placeholder = '';
            
            // 同步会话里的当前文件编码
            session.encoding = selectedEncoding;
            
            // 渲染行号并对齐
            updateGutterAndStats();
            editorTextarea.focus();
            // 重置光标至最前端
            editorTextarea.selectionStart = editorTextarea.selectionEnd = 0;
        } else {
            showToast('读取远程文件失败: ' + result.error, 'error');
            closeEditorDrawerDirectly();
        }
    } catch (err) {
        showToast('读取远程文件抛出异常: ' + err.message, 'error');
        closeEditorDrawerDirectly();
    }
}

/**
 * 执行文件内容保存并覆写写回主机
 */
async function saveRemoteFile() {
    if (!editorActiveSession || !editorActivePath) return;
    
    const textContent = editorTextarea.value;
    
    // 展示保存中 Loading 效果
    btnSave.classList.add('btn-editor-saving');
    const btnSpan = btnSave.querySelector('span');
    if (btnSpan) btnSpan.textContent = '正在写入远端...';
    
    try {
        const apiType = (editorActiveSession.connectionType === 'ftp' || editorActiveSession.connectionType === 'telnet' || editorActiveSession.useFtpFallback) ? 'ftp' : 'sftp';
        const connId = (editorActiveSession.connectionType === 'telnet' || editorActiveSession.useFtpFallback) ? editorActiveSession.ftpConnectionId : editorActiveSession.connectionId;
        const selectedEncoding = selectEditorEncoding ? selectEditorEncoding.value : (editorActiveSession.encoding || 'utf-8');
        
        showToast(`正在异步写回 ${editorActiveFilename}...`, 'info');
        
        const result = await window.api[apiType].writeText(connId, editorActivePath, textContent, selectedEncoding);
        if (result.success) {
            editorOriginalContent = textContent; // 将修改后缓存同步
            showToast(`文件 ${editorActiveFilename} 远程覆盖保存成功!`, 'success');
            
            // 如果会话管理器当前依然被打开，触发一次原生的刷新加载动作以保证文件大小修改能即时更新在列表中
            if (typeof handleSftpRefresh === 'function') {
                handleSftpRefresh();
            }
        } else {
            showToast('远程写入失败: ' + result.error, 'error');
        }
    } catch (e) {
        showToast('远程写入异常: ' + e.message, 'error');
    } finally {
        btnSave.classList.remove('btn-editor-saving');
        if (btnSpan) btnSpan.textContent = '保存 (Ctrl+S)';
    }
}

/**
 * 拦截并询问关闭编辑器请求
 */
async function handleCloseEditorRequest() {
    const currentVal = editorTextarea.value;
    if (currentVal !== editorOriginalContent) {
        // 使用美化的 HSL 弹出式提示模态框询问未保存更改
        const confirmExit = await showConfirm({
            title: '未保存更改',
            message: `您对「${editorActiveFilename}」的修改尚未保存，确认退出编辑器吗？`,
            detail: '未保存的编辑内容将永久丢失，且无法撤销！',
            confirmText: '丢弃并退出',
            type: 'warning'
        });
        if (!confirmExit) return;
    }
    closeEditorDrawerDirectly();
}

/**
 * 直接关闭抽屉面板
 */
function closeEditorDrawerDirectly() {
    if (editorDrawer) {
        editorDrawer.classList.add('hidden');
    }
    editorActiveSession = null;
    editorActiveFilename = null;
    editorActivePath = null;
    editorOriginalContent = '';
}

/**
 * 切换编辑器文件编码并从远程服务器重新加载内容
 */
async function handleEditorEncodingChange() {
    if (!editorActiveSession || !editorActivePath) return;
    
    const selectedEncoding = selectEditorEncoding.value;
    
    // 检查是否有未保存的修改
    const currentVal = editorTextarea.value;
    if (currentVal !== editorOriginalContent) {
        const confirmReload = await showConfirm({
            title: '未保存的修改',
            message: '切换编码将重新读取远程文件，您当前的未保存修改将会丢失。是否继续？',
            confirmText: '丢弃并切换',
            type: 'warning'
        });
        if (!confirmReload) {
            // 回退为先前的编码
            selectEditorEncoding.value = editorActiveSession.encoding || 'utf-8';
            return;
        }
    }
    
    // 重新拉取内容
    editorTextarea.value = '';
    editorTextarea.disabled = true;
    editorTextarea.placeholder = `正在使用 ${selectedEncoding.toUpperCase()} 编码从远程服务器重新读取配置，请稍候...`;
    updateGutterAndStats();
    
    try {
        const apiType = (editorActiveSession.connectionType === 'ftp' || editorActiveSession.connectionType === 'telnet' || editorActiveSession.useFtpFallback) ? 'ftp' : 'sftp';
        const connId = (editorActiveSession.connectionType === 'telnet' || editorActiveSession.useFtpFallback) ? editorActiveSession.ftpConnectionId : editorActiveSession.connectionId;
        
        const result = await window.api[apiType].readText(connId, editorActivePath, selectedEncoding);
        if (result.success) {
            editorTextarea.value = result.content;
            editorOriginalContent = result.content;
            editorTextarea.disabled = false;
            editorTextarea.placeholder = '';
            
            // 同步会话状态编码
            editorActiveSession.encoding = selectedEncoding;
            
            updateGutterAndStats();
            editorTextarea.focus();
            showToast(`文件已成功使用 ${selectedEncoding.toUpperCase()} 编码重新加载`, 'success');
        } else {
            showToast('读取远程文件失败: ' + result.error, 'error');
            closeEditorDrawerDirectly();
        }
    } catch (err) {
        showToast('读取远程文件抛出异常: ' + err.message, 'error');
        closeEditorDrawerDirectly();
    }
}

// 暴露为全局模块接口
window.openRemoteFileEditor = openRemoteFileEditor;
window.closeEditorDrawerDirectly = closeEditorDrawerDirectly;
