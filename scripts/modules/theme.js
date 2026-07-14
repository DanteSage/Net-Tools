/**
 * 主题管理模块
 * 参考 VS Code 经典与社区流行主题
 * @module theme
 */

// ==================== 主题元数据 ====================

/**
 * 全部可选主题
 * mode: 'dark' | 'light' 决定是否添加 data-theme="light"
 * key:  写入 data-theme-name，匹配 themes.css 中的变量覆盖
 */
const THEMES = [
    { key: 'dark',            name: 'Dark+',           mode: 'dark',  swatch: ['#1e293b', '#3b82f6', '#0f172a'] },
    { key: 'one-dark',        name: 'One Dark Pro',    mode: 'dark',  swatch: ['#282c34', '#61afef', '#21252b'] },
    { key: 'monokai',         name: 'Monokai',         mode: 'dark',  swatch: ['#272822', '#66d9ef', '#1e1f1c'] },
    { key: 'dracula',         name: 'Dracula',         mode: 'dark',  swatch: ['#282a36', '#bd93f9', '#21222c'] },
    { key: 'solarized-dark',  name: 'Solarized Dark',  mode: 'dark',  swatch: ['#002b36', '#268bd2', '#073642'] },
    { key: 'github-dark',     name: 'GitHub Dark',     mode: 'dark',  swatch: ['#0d1117', '#58a6ff', '#161b22'] },
    { key: 'light',           name: 'Light+',          mode: 'light', swatch: ['#ffffff', '#3b82f6', '#f1f5f9'] },
    { key: 'github-light',    name: 'GitHub Light',    mode: 'light', swatch: ['#ffffff', '#0969da', '#f6f8fa'] },
    { key: 'solarized-light', name: 'Solarized Light', mode: 'light', swatch: ['#fdf6e3', '#268bd2', '#eee8d5'] },
    { key: 'quiet-light',     name: 'Quiet Light',     mode: 'light', swatch: ['#f5f5f5', '#4f76b1', '#ffffff'] }
];

/**
 * 获取主题元信息
 */
function getThemeMeta(key) {
    return THEMES.find(t => t.key === key) || THEMES[0];
}

/**
 * 获取当前主题 key
 */
function getCurrentThemeKey() {
    const saved = localStorage.getItem('theme-name');
    if (saved) return saved;
    // 兼容旧版本仅有 'theme' 键的情况
    const legacy = localStorage.getItem('theme');
    if (legacy === 'dark') return 'dark';
    // 默认 Light+
    return 'light';
}

// 亮色终端主题
const lightTerminalTheme = {
    background: '#ffffff',
    foreground: '#24292f',
    cursor: '#24292f',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
};

// 暗色终端主题
const darkTerminalTheme = {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#e6edf3',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(88, 166, 255, 0.3)',
    black: '#0d1117',
    red: '#f85149',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#e6edf3',
    brightBlack: '#6e7681',
    brightRed: '#ff7b72',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff'
};

/**
 * 初始化主题
 */
function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');

    // 从本地存储加载主题
    const savedKey = getCurrentThemeKey();
    applyTheme(savedKey, { silent: true });

    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

/**
 * 应用指定主题
 * @param {string} key - 主题 key，参见 THEMES
 * @param {Object} [options]
 * @param {boolean} [options.silent] - 是否不提示 Toast
 */
function applyTheme(key, options = {}) {
    const meta = getThemeMeta(key);
    const html = document.documentElement;

    // 主题色板名（驱动 themes.css 变量覆盖）
    html.setAttribute('data-theme-name', meta.key);

    // 浅/深色基底（兼容现有 [data-theme="light"] 规则）
    if (meta.mode === 'light') {
        html.setAttribute('data-theme', 'light');
    } else {
        html.setAttribute('data-theme', '');
    }

    // 持久化
    localStorage.setItem('theme-name', meta.key);
    localStorage.setItem('theme', meta.mode);

    // 同步到主进程，让启动/密码窗口也能跟随
    if (window.api && window.api.theme && typeof window.api.theme.save === 'function') {
        window.api.theme.save({ key: meta.key, mode: meta.mode }).catch(() => {});
    }

    // 同步终端主题
    updateAllTerminalThemes(meta.mode);

    if (!options.silent) {
        showToast('已切换到 ' + meta.name, 'info');
    }
}

/**
 * 侧边栏快捷按钮：在深色主题与 Light+ 之间切换
 * 保留原等同补丁以兼容原有调用点
 */
function toggleTheme() {
    const current = getCurrentThemeKey();
    const meta = getThemeMeta(current);
    if (meta.mode === 'light') {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }
}

/**
 * 基于当前 CSS 变量解析出终端 theme
 * 让 xterm 的 background / foreground 跟随每个主题的 --terminal-bg / --terminal-fg
 * @param {string} mode - 'dark' | 'light'
 */
function _resolveTerminalTheme(mode) {
    const base = mode === 'light' ? lightTerminalTheme : darkTerminalTheme;
    const styles = getComputedStyle(document.documentElement);
    const bg = (styles.getPropertyValue('--terminal-bg') || '').trim() || base.background;
    const fg = (styles.getPropertyValue('--terminal-fg') || '').trim() || base.foreground;
    return {
        ...base,
        background: bg,
        foreground: fg,
        cursor: fg,
        cursorAccent: bg
    };
}

/**
 * 更新所有终端主题
 * @param {string} mode - 'dark' | 'light'
 */
function updateAllTerminalThemes(mode) {
    const terminalTheme = _resolveTerminalTheme(mode);

    if (typeof state !== 'undefined' && state.sessions) {
        for (const session of state.sessions.values()) {
            if (session.terminal) {
                session.terminal.options.theme = terminalTheme;
                // 触发重绘，确保非默认浅色主题（如 Solarized Light）背景立即生效
                try {
                    if (typeof session.terminal.refresh === 'function') {
                        session.terminal.refresh(0, session.terminal.rows - 1);
                    }
                } catch (_) { /* ignore */ }
            }
        }
    }
}

/**
 * 获取当前终端主题
 * 新建终端时使用，确保使用与当前主题一致的配色
 */
function getCurrentTerminalTheme() {
    const mode = localStorage.getItem('theme') || 'light';
    return _resolveTerminalTheme(mode);
}

window.THEMES = THEMES;
window.applyTheme = applyTheme;
window.getCurrentThemeKey = getCurrentThemeKey;
window.getThemeMeta = getThemeMeta;
