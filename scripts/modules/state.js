/**
 * 全局状态管理模块
 * @module state
 */

// 全局状态对象
const state = {
    devices: [],
    templates: [],
    functions: [],
    oplogs: [],
    connectionHistory: [],
    // 多标签页终端会话管理
    sessions: new Map(),
    activeSessionId: null,
    sessionCounter: 0,
    oplogCounter: 0
};

/**
 * 创建会话数据结构
 * @param {string} deviceId - 设备ID
 * @param {string} deviceName - 设备名称
 * @param {string} connectionType - 连接类型 ('ssh' | 'serial')
 * @returns {Object} 会话对象
 */
function createSession(deviceId, deviceName, connectionType) {
    return {
        id: `session_${++state.sessionCounter}`,
        deviceId,
        deviceName,
        connectionId: null,
        connectionType,
        terminal: null,
        terminalWriteController: null,
        terminalRendererController: null,
        fitAddon: null,
        searchAddon: null,
        connected: false,
        encoding: 'utf-8',
        logging: false,
        logData: null
    };
}

/**
 * 创建操作日志数据结构
 * @param {Object} session - 会话对象
 * @returns {Object} 操作日志对象
 */
function createOplog(session) {
    return {
        id: `oplog_${Date.now()}_${++state.oplogCounter}`,
        sessionId: session.id,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        deviceType: session.deviceType || 'default',
        connectionType: session.connectionType,
        startTime: new Date().toISOString(),
        endTime: null,
        content: ''
    };
}

/**
 * 获取当前活动会话
 * @returns {Object|null} 当前活动会话或null
 */
function getActiveSession() {
    return state.activeSessionId ? state.sessions.get(state.activeSessionId) : null;
}

/**
 * 根据连接ID查找会话
 * @param {string} connectionId - 连接ID
 * @returns {Object|null} 会话对象或null
 */
function findSessionByConnectionId(connectionId) {
    for (const session of state.sessions.values()) {
        if (session.connectionId === connectionId) {
            return session;
        }
    }
    return null;
}
