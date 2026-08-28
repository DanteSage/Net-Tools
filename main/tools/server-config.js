const {
    requireDirectory,
    requireIPv4,
    requireInteger,
    requirePlainObject,
    requireString,
    validationError
} = require('../utils/security');

function requireBoolean(value, name) {
    if (typeof value !== 'boolean') {
        throw validationError(`${name}格式不正确`);
    }
    return value;
}

function requirePassword(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
        throw validationError('密码长度必须在 1 至 256 个字符之间');
    }
    return value;
}

function validateListenHost(config) {
    const host = requireIPv4(config.host ?? '127.0.0.1', '监听地址', { allowWildcard: true });
    if (host === '0.0.0.0' && config.exposeAllInterfaces !== true) {
        throw validationError('监听全部网卡需要显式确认');
    }
    return host;
}

function validateFtpServerConfig(input) {
    const config = requirePlainObject(input, 'FTP 服务配置');
    const username = requireString(config.username, '用户名', { maxLength: 64 });
    if (username.toLowerCase() === 'anonymous' && config.allowAnonymous !== true) {
        throw validationError('匿名访问需要显式确认');
    }
    return {
        port: requireInteger(config.port, '端口', 1, 65535),
        host: validateListenHost(config),
        username,
        password: requirePassword(config.password),
        rootDirectory: requireDirectory(config.rootDirectory, 'FTP 根目录'),
        timeout: requireInteger(config.timeout, '超时时间', 5, 3600)
    };
}

function validateTftpServerConfig(input) {
    const config = requirePlainObject(input, 'TFTP 服务配置');
    return {
        port: requireInteger(config.port, '端口', 1, 65535),
        host: validateListenHost(config),
        rootDirectory: requireDirectory(config.rootDirectory, 'TFTP 根目录'),
        writable: requireBoolean(config.writable ?? false, '写入权限'),
        timeout: requireInteger(config.timeout, '超时时间', 1, 60),
        retries: requireInteger(config.retries, '重试次数', 1, 20),
        maxBlockSize: requireInteger(config.maxBlockSize, '最大块大小', 512, 65464)
    };
}

function ipv4ToNumber(ip) {
    return ip.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

function validateSubnetMask(mask) {
    const number = ipv4ToNumber(mask);
    const inverted = (~number) >>> 0;
    if (number === 0 || inverted < 3 || (inverted & (inverted + 1)) !== 0) {
        throw validationError('子网掩码格式不正确');
    }
    return mask;
}

function validateDhcpServerConfig(input) {
    const config = requirePlainObject(input, 'DHCP 服务配置');
    const interfaceIp = requireIPv4(config.interfaceIp, '网卡地址');
    const startIp = requireIPv4(config.startIp, '起始地址');
    const endIp = requireIPv4(config.endIp, '结束地址');
    const subnetMask = validateSubnetMask(requireIPv4(config.subnetMask, '子网掩码', { allowWildcard: true }));
    const maskNumber = ipv4ToNumber(subnetMask);
    const interfaceNetwork = (ipv4ToNumber(interfaceIp) & maskNumber) >>> 0;
    const broadcast = (interfaceNetwork | ((~maskNumber) >>> 0)) >>> 0;
    const startNumber = ipv4ToNumber(startIp);
    const endNumber = ipv4ToNumber(endIp);
    if (((ipv4ToNumber(startIp) & maskNumber) >>> 0) !== interfaceNetwork ||
        ((ipv4ToNumber(endIp) & maskNumber) >>> 0) !== interfaceNetwork) {
        throw validationError('DHCP 地址池必须与所选网卡位于同一网段');
    }
    if (startNumber > endNumber) {
        throw validationError('DHCP 起始地址不能大于结束地址');
    }
    if (startNumber <= interfaceNetwork || endNumber >= broadcast) {
        throw validationError('DHCP 地址池不能包含网络地址或广播地址');
    }
    const interfaceNumber = ipv4ToNumber(interfaceIp);
    if (interfaceNumber >= startNumber && interfaceNumber <= endNumber) {
        throw validationError('DHCP 地址池不能包含服务端网卡地址');
    }
    const gateway = config.gateway ? requireIPv4(config.gateway, '默认网关') : null;
    if (gateway && ((ipv4ToNumber(gateway) & maskNumber) >>> 0) !== interfaceNetwork) {
        throw validationError('默认网关必须与所选网卡位于同一网段');
    }
    const dnsList = Array.isArray(config.dnsList) ? config.dnsList : [];
    if (dnsList.length > 3) throw validationError('DNS 地址数量不能超过 3 个');
    return {
        interfaceIp,
        startIp,
        endIp,
        subnetMask,
        gateway,
        dnsList: dnsList.map((ip, index) => requireIPv4(ip, `DNS ${index + 1}`)),
        leaseTime: requireInteger(config.leaseTime, '租期', 60, 604800)
    };
}

function validateNetcatListenConfig(input) {
    const config = requirePlainObject(input, 'Netcat 监听配置');
    return {
        port: requireInteger(config.port, '端口', 1, 65535),
        host: validateListenHost(config)
    };
}

module.exports = {
    validateDhcpServerConfig,
    validateFtpServerConfig,
    validateNetcatListenConfig,
    validateTftpServerConfig
};
