const COMMON_INVOKE_CHANNELS = ['theme:get'];
const COMMON_RECEIVE_CHANNELS = ['theme:changed'];

const TOOL_IPC_SCOPES = Object.freeze({
    ping: {
        invoke: ['ping:start', 'ping:stop'],
        receive: ['ping:result', 'ping:complete']
    },
    portscanner: {
        invoke: ['scan-ports', 'stop-scan', 'quick-test'],
        receive: ['scan-progress']
    },
    traceroute: {
        invoke: [
            'traceroute:reverseDns',
            'traceroute:start',
            'traceroute:stop',
            'traceroute:trippy-start',
            'traceroute:trippy-stop',
            'traceroute:lookup-geoip'
        ],
        receive: [
            'traceroute:hop',
            'traceroute:complete',
            'traceroute:trippy-state',
            'traceroute:trippy-update'
        ]
    },
    netcat: {
        invoke: ['netcat:*'],
        receive: ['netcat:*']
    },
    'tshark-analyzer': {
        invoke: ['tshark:*'],
        receive: ['tshark:*'],
        capabilities: ['external-links']
    },
    'broadcast-detector': {
        invoke: ['broadcastDetector:*'],
        receive: ['broadcastDetector:*'],
        capabilities: ['external-links']
    },
    'ftp-client': {
        invoke: ['ftp:*'],
        receive: ['ftp:progress', 'ftp:log:*'],
        capabilities: ['filesystem', 'path', 'system']
    },
    'ftp-server': {
        invoke: ['ftpServer:*'],
        receive: ['ftpServer:log'],
        capabilities: ['exists', 'system']
    },
    'tftp-server': {
        invoke: ['tftpServer:*'],
        send: ['tftpServer:confirm-close'],
        receive: ['tftpServer:*'],
        capabilities: ['exists', 'system']
    },
    'dhcp-server': {
        invoke: ['dhcpServer:start', 'dhcpServer:stop'],
        send: ['dhcpServer:confirm-close', 'dhcpServer:revoke-lease'],
        receive: ['dhcpServer:*'],
        capabilities: ['system']
    },
    speedtest: {
        receive: ['server-info'],
        capabilities: ['external-links', 'clipboard']
    },
    'dns-lookup': {
        invoke: ['dns:*'],
        receive: ['dns:*']
    },
    subnetting: {},
    'ipv6-subnetting': {},
    'packet-capture': {
        invoke: [
            'start-capture',
            'stop-capture',
            'clear-packets',
            'export-packets',
            'import-packets',
            'check-admin',
            'check-service',
            'start-service',
            'get-interfaces',
            'get-statistics',
            'window-minimize',
            'window-maximize',
            'window-close'
        ],
        receive: ['packet-received', 'capture-error', 'capture-stopped']
    }
});

function matchesChannel(rule, channel) {
    if (rule.endsWith('*')) return channel.startsWith(rule.slice(0, -1));
    return channel === rule;
}

function getToolScope(toolId) {
    return TOOL_IPC_SCOPES[toolId] || null;
}

function isChannelAllowed(toolId, action, channel) {
    if (typeof channel !== 'string') return false;
    const scope = getToolScope(toolId);
    if (!scope) return false;

    const common = action === 'invoke'
        ? COMMON_INVOKE_CHANNELS
        : action === 'receive'
            ? COMMON_RECEIVE_CHANNELS
            : [];
    const rules = [...common, ...(scope[action] || [])];
    return rules.some(rule => matchesChannel(rule, channel));
}

function hasCapability(toolId, capability) {
    const scope = getToolScope(toolId);
    return !!scope && (scope.capabilities || []).includes(capability);
}

module.exports = {
    TOOL_IPC_SCOPES,
    getToolScope,
    hasCapability,
    isChannelAllowed
};
