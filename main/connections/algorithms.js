/**
 * SSH 算法配置模块
 * 统一管理 SSH 连接的加密算法配置，支持各种网络设备
 */

/**
 * SSH 算法配置（兼容老旧网络设备）
 */
const SSH_ALGORITHMS = {
    kex: [
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group-exchange-sha1',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group1-sha1'
    ],
    serverHostKey: [
        'ssh-rsa',
        'ssh-dss',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'ssh-ed25519',
        'rsa-sha2-256',
        'rsa-sha2-512'
    ],
    cipher: [
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes256-cbc',
        'aes192-cbc',
        'aes128-cbc',
        '3des-cbc'
    ],
    hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512',
        'hmac-sha1',
        'hmac-md5',
        'hmac-sha1-96',
        'hmac-md5-96'
    ]
};

/**
 * 简化版算法配置（用于批量执行等场景）
 * 注意：需要支持华为等老旧设备的 DH 组
 */
const SSH_ALGORITHMS_SIMPLE = {
    kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group-exchange-sha1',
        'diffie-hellman-group18-sha512',
        'diffie-hellman-group16-sha512',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group1-sha1'
    ],
    serverHostKey: [
        'ssh-rsa',
        'ssh-dss',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'ssh-ed25519',
        'rsa-sha2-256',
        'rsa-sha2-512'
    ],
    cipher: [
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-cbc',
        'aes192-cbc',
        'aes256-cbc',
        '3des-cbc'
    ],
    hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512',
        'hmac-sha1',
        'hmac-md5',
        'hmac-sha1-96',
        'hmac-md5-96'
    ]
};

/**
 * 创建 SSH 连接配置
 * @param {Object} config - 基础配置
 * @param {boolean} simple - 是否使用简化版算法
 * @returns {Object} 完整的 SSH 连接配置
 */
function createSSHConfig(config, simple = false) {
    const algorithms = simple ? SSH_ALGORITHMS_SIMPLE : SSH_ALGORITHMS;
    
    const sshConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: config.timeout || 10000,
        keepaliveInterval: Number.isFinite(Number(config.keepaliveInterval))
            ? Math.max(0, Math.floor(Number(config.keepaliveInterval)))
            : 15000,
        keepaliveCountMax: Number.isFinite(Number(config.keepaliveCountMax))
            ? Math.max(1, Math.floor(Number(config.keepaliveCountMax)))
            : 3,
        algorithms
    };
    
    // 添加密码认证
    if (config.password) {
        sshConfig.password = config.password;
    }
    
    // 添加私钥认证
    if (config.privateKey) {
        const fs = require('fs');
        try {
            sshConfig.privateKey = fs.readFileSync(config.privateKey);
        } catch (e) {
            console.error('读取私钥失败:', e);
        }
    }
    
    return sshConfig;
}

module.exports = {
    SSH_ALGORITHMS,
    SSH_ALGORITHMS_SIMPLE,
    createSSHConfig
};
