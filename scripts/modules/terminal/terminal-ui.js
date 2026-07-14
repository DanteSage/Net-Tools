/**
 * 终端UI模块 - 右键菜单、搜索栏
 * @module terminal/ui
 */

// 搜索状态
let searchState = { isOpen: false, currentIndex: 0, totalMatches: 0 };

// ==================== 右键菜单 ====================

/**
 * 初始化右键菜单
 */
function initContextMenu() {
    const menu = document.getElementById('terminal-context-menu');
    
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;
            const session = getActiveSession();
            
            switch (action) {
                case 'copy':
                    if (session && session.terminal) {
                        const selection = session.terminal.getSelection();
                        if (selection) {
                            await navigator.clipboard.writeText(selection);
                            showToast('已复制到剪贴板', 'success');
                        }
                    }
                    break;
                case 'paste':
                    if (session && session.connected) {
                        const text = await navigator.clipboard.readText();
                        if (text) sendToSession(session, text);
                    }
                    break;
                case 'selectAll':
                    if (session && session.terminal) session.terminal.selectAll();
                    break;
                case 'clear':
                    clearActiveTerminal();
                    break;
                case 'find':
                    toggleSearchBar();
                    break;
            }
            hideContextMenu();
        });
    });
    
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#terminal-container')) hideContextMenu();
    });
}

/**
 * 显示右键菜单
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {Object} session - 会话对象
 */
function showContextMenu(x, y, session) {
    const menu = document.getElementById('terminal-context-menu');
    const menuWidth = 200, menuHeight = 220;
    
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');
    
    const copyItem = menu.querySelector('[data-action="copy"]');
    const pasteItem = menu.querySelector('[data-action="paste"]');
    
    if (session && session.terminal) {
        copyItem.style.opacity = session.terminal.getSelection().length > 0 ? '1' : '0.5';
    }
    pasteItem.style.opacity = (session && session.connected) ? '1' : '0.5';
}

/**
 * 隐藏右键菜单
 */
function hideContextMenu() {
    document.getElementById('terminal-context-menu').classList.remove('show');
}

// ==================== 搜索功能 ====================

/**
 * 初始化搜索功能
 */
function initSearch() {
    const searchInput = document.getElementById('search-input');
    const prevBtn = document.getElementById('search-prev');
    const nextBtn = document.getElementById('search-next');
    const closeBtn = document.getElementById('search-close');
    
    searchInput.addEventListener('input', () => performSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.shiftKey ? searchPrevious() : searchNext();
        } else if (e.key === 'Escape') {
            hideSearchBar();
        }
    });
    
    prevBtn.addEventListener('click', searchPrevious);
    nextBtn.addEventListener('click', searchNext);
    closeBtn.addEventListener('click', hideSearchBar);
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            const activePage = document.querySelector('.page.active');
            if (activePage && activePage.id === 'page-terminal' && !e.target.closest('.xterm')) {
                e.preventDefault();
                toggleSearchBar();
            }
        }
    });
}

/**
 * 切换搜索栏显示
 */
function toggleSearchBar() {
    const searchBar = document.getElementById('terminal-search-bar');
    const searchInput = document.getElementById('search-input');
    
    if (searchState.isOpen) {
        hideSearchBar();
    } else {
        searchBar.classList.add('show');
        searchState.isOpen = true;
        searchInput.focus();
        searchInput.select();
    }
}

/**
 * 隐藏搜索栏
 */
function hideSearchBar() {
    const searchBar = document.getElementById('terminal-search-bar');
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    
    searchBar.classList.remove('show');
    searchState.isOpen = false;
    searchInput.value = '';
    searchCount.textContent = '';
    
    const session = getActiveSession();
    if (session && session.searchAddon) session.searchAddon.clearDecorations();
    if (session && session.terminal) session.terminal.focus();
}

/**
 * 执行搜索
 * @param {string} query - 搜索关键词
 */
function performSearch(query) {
    const session = getActiveSession();
    const searchCount = document.getElementById('search-count');
    
    if (!session || !session.searchAddon || !query) {
        searchCount.textContent = '';
        return;
    }
    
    const found = session.searchAddon.findNext(query, { caseSensitive: false, wholeWord: false, regex: false, incremental: true });
    searchCount.textContent = found ? '已找到匹配' : '无匹配';
    searchCount.style.color = found ? '' : '#f85149';
}

/**
 * 搜索下一个
 */
function searchNext() {
    const session = getActiveSession();
    const searchInput = document.getElementById('search-input');
    if (session && session.searchAddon && searchInput.value) {
        session.searchAddon.findNext(searchInput.value, { caseSensitive: false, wholeWord: false, regex: false });
    }
}

/**
 * 搜索上一个
 */
function searchPrevious() {
    const session = getActiveSession();
    const searchInput = document.getElementById('search-input');
    if (session && session.searchAddon && searchInput.value) {
        session.searchAddon.findPrevious(searchInput.value, { caseSensitive: false, wholeWord: false, regex: false });
    }
}
