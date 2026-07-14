/**
 * 批量执行变量展开逻辑
 * @module batch/variables
 */

// ==================== 正则缓存 ====================

const simpleVarRegexCache = new Map();

/**
 * 清除正则缓存
 */
function clearRegexCache() {
    simpleVarRegexCache.clear();
}

// ==================== 变量检测 ====================

/**
 * 检测命令中是否包含定义变量引用
 * @param {string} command - 命令字符串
 * @returns {string[]} 变量名列表（去重）
 */
function detectVariableReferences(command) {
    const matches = command.match(/\$\{([^}]+)\}/g) || [];
    const names = matches.map(m => m.slice(2, -1));
    return [...new Set(names)];
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 变量展开 ====================

/**
 * 展开带有定义变量的命令（异步版本）
 */
async function expandCommandsWithVariablesAsync(commands, customVars) {
    const definedVars = typeof getDefinedVariablesAsync === 'function' 
        ? await getDefinedVariablesAsync() 
        : {};
    return expandCommandsWithVariablesCore(commands, customVars, definedVars);
}

/**
 * 展开带有定义变量的命令（同步版本）
 */
function expandCommandsWithVariables(commands, customVars) {
    const definedVars = typeof getDefinedVariables === 'function' ? getDefinedVariables() : {};
    return expandCommandsWithVariablesCore(commands, customVars, definedVars);
}

/**
 * 展开带有定义变量的命令（核心逻辑）
 */
function expandCommandsWithVariablesCore(commands, customVars, definedVars) {
    const allCommands = commands.join('\n');
    const usedVarNames = detectVariableReferences(allCommands);
    
    const usedDefinedVars = {};
    const undefinedVars = [];
    let maxIterations = 1;
    
    usedVarNames.forEach(name => {
        if (definedVars[name] && Array.isArray(definedVars[name])) {
            usedDefinedVars[name] = definedVars[name];
            maxIterations = Math.max(maxIterations, definedVars[name].length);
        } else if (!customVars[name]) {
            undefinedVars.push(name);
        }
    });
    
    if (undefinedVars.length > 0) {
        console.warn('[批量执行] 未定义的变量:', undefinedVars.join(', '));
    }
    
    if (Object.keys(usedDefinedVars).length === 0) {
        const replacedCommands = commands.map(cmd => replaceSimpleVariables(cmd, customVars));
        return [replacedCommands];
    }
    
    // 预编译正则表达式
    const varRegexMap = {};
    Object.keys(usedDefinedVars).forEach(name => {
        varRegexMap[name] = new RegExp(`\\$\\{${escapeRegExp(name)}\\}`, 'g');
    });
    
    const customVarRegexMap = {};
    Object.keys(customVars).forEach(name => {
        customVarRegexMap[name] = new RegExp(`\\$\\{${escapeRegExp(name)}\\}`, 'g');
    });
    
    // 生成多组命令
    const commandGroups = [];
    for (let i = 0; i < maxIterations; i++) {
        const group = commands.map(cmd => {
            let result = cmd;
            
            Object.keys(usedDefinedVars).forEach(name => {
                const values = usedDefinedVars[name];
                const value = values[Math.min(i, values.length - 1)];
                result = result.replace(varRegexMap[name], value);
            });
            
            Object.keys(customVars).forEach(name => {
                result = result.replace(customVarRegexMap[name], customVars[name]);
            });
            
            return result;
        });
        commandGroups.push(group);
    }
    
    return commandGroups;
}

/**
 * 替换简单变量
 */
function replaceSimpleVariables(command, vars) {
    let result = command;
    Object.keys(vars).forEach(name => {
        if (!simpleVarRegexCache.has(name)) {
            simpleVarRegexCache.set(name, new RegExp(`\\$\\{${escapeRegExp(name)}\\}`, 'g'));
        }
        result = result.replace(simpleVarRegexCache.get(name), vars[name]);
    });
    return result;
}

// ==================== 展开信息 ====================

/**
 * 获取变量展开信息（异步版本）
 */
async function getVariableExpansionInfoAsync(commands, customVars = {}) {
    const definedVars = typeof getDefinedVariablesAsync === 'function' 
        ? await getDefinedVariablesAsync() 
        : {};
    return getVariableExpansionInfoCore(commands, customVars, definedVars);
}

/**
 * 获取变量展开信息（同步版本）
 */
function getVariableExpansionInfo(commands, customVars = {}) {
    const definedVars = typeof getDefinedVariables === 'function' ? getDefinedVariables() : {};
    return getVariableExpansionInfoCore(commands, customVars, definedVars);
}

/**
 * 获取变量展开信息（核心逻辑）
 */
function getVariableExpansionInfoCore(commands, customVars, definedVars) {
    const allCommands = commands.join('\n');
    const usedVarNames = detectVariableReferences(allCommands);
    
    const info = {
        hasDefinedVars: false,
        iterations: 1,
        variables: [],
        undefinedVars: [],
        totalCommands: commands.length
    };
    
    usedVarNames.forEach(name => {
        if (definedVars[name] && Array.isArray(definedVars[name])) {
            info.hasDefinedVars = true;
            info.iterations = Math.max(info.iterations, definedVars[name].length);
            info.variables.push({
                name,
                count: definedVars[name].length,
                preview: definedVars[name].slice(0, 3).join(', ') + (definedVars[name].length > 3 ? '...' : '')
            });
        } else if (!customVars[name]) {
            info.undefinedVars.push(name);
        }
    });
    
    info.totalCommands = commands.length * info.iterations;
    
    return info;
}
