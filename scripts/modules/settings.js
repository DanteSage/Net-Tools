/**
 * 设置页面模块
 * 集中管理：外观、安全、存储、关于
 * @module settings
 */

// ==================== 私有函数 ====================

/**
 * 切换设置分类
 * @private
 */
function _switchSettingsSection(section) {
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === section);
    });
    document.querySelectorAll('.settings-section').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.section === section);
    });
}

/**
 * 渲染主题卡片网格
 * @private
 */
function _renderThemeGrid() {
    const grid = document.getElementById('settings-theme-grid');
    if (!grid || !window.THEMES) return;
    const current = window.getCurrentThemeKey ? window.getCurrentThemeKey() : 'dark';

    grid.innerHTML = window.THEMES.map(t => {
        const [c1, c2, c3] = t.swatch;
        const active = t.key === current ? ' active' : '';
        return `
            <button class="theme-card${active}" data-theme-key="${t.key}" title="${escapeHtml(t.name)}">
                <div class="theme-card-preview" style="background:${c1};">
                    <div class="theme-card-bar" style="background:${c3};">
                        <span style="background:${c2};"></span>
                        <span style="background:${c3};"></span>
                        <span style="background:${c3};"></span>
                    </div>
                    <div class="theme-card-body">
                        <div class="theme-card-line" style="background:${c2};width:60%;"></div>
                        <div class="theme-card-line" style="background:${c3};width:80%;"></div>
                        <div class="theme-card-line" style="background:${c3};width:45%;"></div>
                    </div>
                </div>
                <div class="theme-card-meta">
                    <span class="theme-card-name">${escapeHtml(t.name)}</span>
                    <span class="theme-card-mode">${t.mode === 'dark' ? '深色' : '浅色'}</span>
                </div>
            </button>
        `;
    }).join('');

    grid.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.dataset.themeKey;
            if (window.applyTheme) window.applyTheme(key);
        });
    });
}

/**
 * 刷新主题卡片选中态（外部切换时同步）
 * @private
 */
function _refreshThemeSwitcher() {
    const current = window.getCurrentThemeKey ? window.getCurrentThemeKey() : 'dark';
    document.querySelectorAll('#settings-theme-grid .theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.themeKey === current);
    });
}

/**
 * 更新密码状态显示
 * @private
 */
async function _refreshPasswordStatus() {
    const desc = document.getElementById('settings-password-desc');
    const badge = document.getElementById('settings-password-badge');
    if (!desc || !badge) return;
    try {
        const status = await window.api.password.getStatus();
        if (status && status.enabled) {
            desc.textContent = '已启用：每次启动应用都需要输入密码';
            badge.textContent = '已启用';
            badge.classList.add('on');
            badge.classList.remove('off');
        } else {
            desc.textContent = '未启用：启用后每次启动应用都需要输入密码';
            badge.textContent = '未启用';
            badge.classList.add('off');
            badge.classList.remove('on');
        }
    } catch (e) {
        desc.textContent = '无法获取密码状态';
    }
}

/**
 * 加载存储相关设置
 * @private
 */
async function _loadStorageSettings() {
    // 备份目录
    try {
        const backupDir = await window.api.backup.getDir();
        const input = document.getElementById('settings-backup-dir');
        if (input && backupDir) {
            input.value = backupDir;
            input.title = backupDir;
        }
    } catch (e) {
        console.error('加载备份目录失败:', e);
    }

    // 操作日志设置
    try {
        const opSettings = await window.api.oplog.getSettings();
        if (opSettings) {
            const input = document.getElementById('settings-oplog-dir');
            if (input) {
                input.value = opSettings.dir || '';
                input.title = opSettings.dir || '';
            }
            const md = document.getElementById('settings-oplog-md');
            if (md) md.checked = !!opSettings.saveMd;
            const hint = document.getElementById('settings-oplog-default-hint');
            if (hint && opSettings.defaultDir) {
                hint.textContent = '默认目录: ' + opSettings.defaultDir;
            }
        }
    } catch (e) {
        console.error('加载操作日志设置失败:', e);
    }
}

/**
 * 加载关于页信息
 * @private
 */
async function _loadAboutInfo() {
    const versionEl = document.getElementById('settings-about-version');
    const sidebarVer = document.getElementById('version-info');
    if (versionEl && sidebarVer) {
        versionEl.textContent = (sidebarVer.textContent || '').replace(/^v/i, '').trim() || '1.1.2';
    }
}

/**
 * 加载 AI 设置信息
 * @private
 */
async function _loadAiSettings() {
    try {
        const config = await window.api.copilot.getConfig();
        if (config) {
            const urlInput = document.getElementById('settings-ai-api-url');
            const keyInput = document.getElementById('settings-ai-api-key');
            const modelInput = document.getElementById('settings-ai-model');
            if (urlInput) urlInput.value = config.apiUrl || '';
            if (keyInput) keyInput.value = config.apiKey || '';
            if (modelInput) modelInput.value = config.model || '';
        }
    } catch (e) {
        console.error('加载 AI 设置失败:', e);
    }
}

// ==================== 公开函数 ====================

/**
 * 进入设置页时加载数据
 */
async function loadSettingsPage() {
    _renderThemeGrid();
    await Promise.all([
        _refreshPasswordStatus(),
        _loadStorageSettings(),
        _loadAiSettings(),
        _loadAboutInfo()
    ]);
}

// ==================== 初始化函数 ====================

/**
 * 初始化设置页面
 */
function initSettings() {
    // 分类切换
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.addEventListener('click', () => _switchSettingsSection(btn.dataset.section));
    });

    // 打开配置目录
    document.getElementById('btn-open-config-dir')?.addEventListener('click', async () => {
        try {
            const paths = await window.api.app.getPaths();
            if (paths && paths.config) {
                await window.api.shell.openPath(paths.config);
            }
        } catch (e) {
            showToast('打开配置目录失败', 'error');
        }
    });

    // 备份目录
    document.getElementById('btn-settings-backup-select')?.addEventListener('click', async () => {
        try {
            const result = await window.api.backup.selectDir();
            if (result && result.success) {
                const input = document.getElementById('settings-backup-dir');
                if (input) {
                    input.value = result.path;
                    input.title = result.path;
                }
                showToast('备份目录已更改', 'success');
                if (typeof loadBackups === 'function') loadBackups();
            }
        } catch (e) {
            showToast('修改目录失败: ' + e.message, 'error');
        }
    });
    document.getElementById('btn-settings-backup-open')?.addEventListener('click', async () => {
        try {
            const dir = await window.api.backup.getDir();
            if (dir) await window.api.shell.openPath(dir);
        } catch (e) {
            showToast('打开目录失败', 'error');
        }
    });
    document.getElementById('btn-settings-backup-reset')?.addEventListener('click', async () => {
        try {
            const result = await window.api.backup.setDir(null);
            if (result && result.success) {
                const input = document.getElementById('settings-backup-dir');
                if (input) {
                    input.value = result.path;
                    input.title = result.path;
                }
                showToast('已恢复默认备份目录', 'success');
                if (typeof loadBackups === 'function') loadBackups();
            }
        } catch (e) {
            showToast('重置失败: ' + e.message, 'error');
        }
    });

    // 操作日志目录
    document.getElementById('btn-settings-oplog-select')?.addEventListener('click', async () => {
        try {
            const result = await window.api.oplog.selectDir();
            if (result && result.success) {
                const input = document.getElementById('settings-oplog-dir');
                if (input) {
                    input.value = result.path;
                    input.title = result.path;
                }
                showToast('操作日志目录已更新', 'success');
            }
        } catch (e) {
            showToast('修改目录失败: ' + e.message, 'error');
        }
    });
    document.getElementById('btn-settings-oplog-open')?.addEventListener('click', async () => {
        try {
            await window.api.oplog.openDir();
        } catch (e) {
            showToast('打开目录失败', 'error');
        }
    });
    document.getElementById('btn-settings-oplog-reset')?.addEventListener('click', async () => {
        try {
            const result = await window.api.oplog.setDir(null);
            if (result && result.success) {
                const input = document.getElementById('settings-oplog-dir');
                if (input) {
                    input.value = result.path;
                    input.title = result.path;
                }
                showToast('已恢复默认操作日志目录', 'success');
            }
        } catch (e) {
            showToast('重置失败: ' + e.message, 'error');
        }
    });

    // 保存为 Markdown 切换
    document.getElementById('settings-oplog-md')?.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        if (checked) {
            const result = await window.api.oplog.setSaveMd(true);
            if (result && result.success) {
                showToast('已切换为 MD 格式', 'success');
            }
        } else {
            e.target.checked = true;
            const confirmed = await showConfirm({
                title: '切换保存格式',
                message: '确定要切换为 TXT 格式吗？',
                detail: 'Markdown (.md) 格式可以获得更好的阅读体验，支持标题、表格等富文本排版。',
                confirmText: '切换为 TXT',
                type: 'warning'
            });
            if (confirmed) {
                const result = await window.api.oplog.setSaveMd(false);
                if (result && result.success) {
                    e.target.checked = false;
                    showToast('已切换为 TXT 格式', 'info');
                }
            }
        }
    });

    // 关于：更新日志 / 支持作者
    document.getElementById('btn-settings-changelog')?.addEventListener('click', () => {
        document.getElementById('changelog-modal')?.classList.add('active');
    });
    document.getElementById('btn-settings-support')?.addEventListener('click', () => {
        document.getElementById('support-modal')?.classList.add('active');
    });

    // AI 设置保存
    document.getElementById('btn-save-ai-settings')?.addEventListener('click', async () => {
        try {
            const url = document.getElementById('settings-ai-api-url').value.trim();
            const key = document.getElementById('settings-ai-api-key').value;
            const model = document.getElementById('settings-ai-model').value.trim();
            
            const result = await window.api.copilot.saveConfig({
                apiUrl: url,
                apiKey: key,
                model: model
            });
            
            if (result && result.success) {
                showToast('模型配置已保存', 'success');
                if (typeof refreshCopilotPage === 'function') {
                    await refreshCopilotPage();
                }
            } else {
                showToast('保存失败', 'error');
            }
        } catch (e) {
            showToast('保存配置发生错误: ' + e.message, 'error');
        }
    });

    // 监听主题变化，刷新主题卡片选中态（其它入口切换时也同步）
    const observer = new MutationObserver(() => _refreshThemeSwitcher());
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-name']
    });
}

window.initSettings = initSettings;
window.loadSettingsPage = loadSettingsPage;
window.switchSettingsSection = _switchSettingsSection;
