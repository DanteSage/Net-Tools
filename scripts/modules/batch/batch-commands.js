/**
 * 批量执行命令编辑
 * @module batch/commands
 */

// ==================== 命令编辑器 ====================

/**
 * 初始化命令编辑器
 */
function initCommandEditor() {
    const textarea = document.getElementById('batch-commands');
    
    document.getElementById('btn-load-template')?.addEventListener('click', () => {
        if (typeof showTemplateSelector === 'function') {
            showTemplateSelector();
        } else {
            showToast('模板模块未加载', 'error');
        }
    });
    
    document.getElementById('btn-save-as-template')?.addEventListener('click', () => {
        if (typeof showSaveTemplateModal === 'function') {
            showSaveTemplateModal();
        } else {
            showToast('模板模块未加载', 'error');
        }
    });
    
    document.getElementById('btn-insert-variable')?.addEventListener('click', showVariableInsertMenu);
    
    // 命令行数统计
    textarea?.addEventListener('input', updateCommandLineCount);
    updateCommandLineCount();
    
    // 清空命令按钮
    document.getElementById('btn-clear-commands')?.addEventListener('click', () => {
        if (textarea && textarea.value.trim()) {
            textarea.value = '';
            updateCommandLineCount();
            showToast('已清空命令', 'info');
        }
    });
    
    // 初始化执行选项联动
    initOptionToggleLinks();
}

/**
 * 更新命令行数统计
 */
function updateCommandLineCount() {
    const textarea = document.getElementById('batch-commands');
    const countEl = document.getElementById('batch-cmd-line-count');
    if (!textarea || !countEl) return;
    
    const text = textarea.value.trim();
    const lines = text ? text.split('\n').filter(l => l.trim()).length : 0;
    countEl.textContent = `${lines} 行`;
}

/**
 * 初始化执行选项开关联动
 */
function initOptionToggleLinks() {
    const togglePairs = [
        { checkbox: 'batch-opt-parallel', input: 'batch-parallel-count' },
        { checkbox: 'batch-opt-timeout', input: 'batch-timeout' },
        { checkbox: 'batch-opt-cmd-delay', input: 'batch-cmd-delay' },
        { checkbox: 'batch-opt-retry', input: 'batch-retry-count' }
    ];
    
    togglePairs.forEach(({ checkbox, input }) => {
        const cb = document.getElementById(checkbox);
        const inp = document.getElementById(input);
        if (!cb || !inp) return;
        
        const optionItem = inp.closest('.option-item');
        
        // 初始状态
        if (!cb.checked && optionItem) {
            optionItem.classList.add('disabled');
        }
        
        // 监听变化
        cb.addEventListener('change', () => {
            if (optionItem) {
                optionItem.classList.toggle('disabled', !cb.checked);
            }
        });
    });
}

/**
 * 显示变量插入菜单
 */
async function showVariableInsertMenu() {
    const definedVars = typeof getDefinedVariablesAsync === 'function' 
        ? await getDefinedVariablesAsync() 
        : {};
    const varNames = Object.keys(definedVars);
    
    if (varNames.length === 0) {
        showToast('暂无定义变量，请先在"定义变量"页面创建', 'warning');
        return;
    }
    
    const existing = document.querySelector('.variable-insert-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'variable-insert-menu';
    menu.innerHTML = `
        <div class="menu-header">选择要插入的变量</div>
        ${varNames.map(name => `
            <div class="menu-item" data-var="${name}">
                <span class="var-name">\${${escapeHtml(name)}}</span>
                <span class="var-count">${definedVars[name].length}个值</span>
            </div>
        `).join('')}
    `;
    
    const btn = document.getElementById('btn-insert-variable');
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            insertVariableToEditor(item.dataset.var);
            menu.remove();
        });
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

/**
 * 在编辑器中插入变量引用
 */
function insertVariableToEditor(varName) {
    const textarea = document.getElementById('batch-commands');
    if (!textarea) return;
    
    const varRef = '${' + varName + '}';
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    textarea.value = text.substring(0, start) + varRef + text.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + varRef.length, start + varRef.length);
}

// ==================== 简单变量管理 ====================

/**
 * 初始化变量管理
 */
function initVariables() {
    document.getElementById('btn-add-batch-var')?.addEventListener('click', addVariable);
    
    document.querySelectorAll('#batch-variables .btn-remove-var').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.variable-item')?.remove();
        });
    });
}

/**
 * 添加变量
 */
function addVariable() {
    const container = document.getElementById('batch-variables');
    if (!container) return;
    
    const item = document.createElement('div');
    item.className = 'variable-item';
    item.innerHTML = `
        <input type="text" placeholder="变量名" class="var-name">
        <input type="text" placeholder="值" class="var-value">
        <button class="btn btn-sm btn-icon btn-remove-var">×</button>
    `;
    
    item.querySelector('.btn-remove-var').addEventListener('click', () => item.remove());
    container.appendChild(item);
}

/**
 * 获取自定义变量（简单键值对）
 */
function getCustomVariables() {
    const vars = {};
    document.querySelectorAll('#batch-variables .variable-item').forEach(item => {
        const name = item.querySelector('.var-name')?.value.trim();
        const value = item.querySelector('.var-value')?.value || '';
        if (name) vars[name] = value;
    });
    return vars;
}
