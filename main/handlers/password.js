/**
 * 启动密码保护 IPC 处理模块
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASSWORD_CONFIG_VERSION = 2;
const PASSWORD_SCHEME = 'scrypt-v1';
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_PENDING_PASSWORD_OPERATIONS = 32;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;
const SCRYPT_OPTIONS = Object.freeze({
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
});

const INVALID_CONFIG_ERROR = '密码配置损坏，无法验证';
const SAVE_CONFIG_ERROR = '保存密码配置失败';

let defaultPasswordService = null;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeCanonicalBase64(value, expectedLength) {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length % 4 !== 0
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        return null;
    }

    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== expectedLength || decoded.toString('base64') !== value) {
        return null;
    }
    return decoded;
}

function parsePasswordConfig(config) {
    if (!isPlainObject(config)) {
        return { state: 'invalid' };
    }

    if (config.version === PASSWORD_CONFIG_VERSION) {
        if (config.enabled === false) {
            return { state: 'disabled', format: 'v2' };
        }
        if (config.enabled !== true || !isPlainObject(config.credential)) {
            return { state: 'invalid' };
        }

        const { scheme, salt, hash } = config.credential;
        if (scheme !== PASSWORD_SCHEME) {
            return { state: 'invalid' };
        }

        const decodedSalt = decodeCanonicalBase64(salt, SALT_LENGTH);
        const decodedHash = decodeCanonicalBase64(hash, HASH_LENGTH);
        if (!decodedSalt || !decodedHash) {
            return { state: 'invalid' };
        }

        return {
            state: 'enabled',
            format: 'v2',
            salt: decodedSalt,
            hash: decodedHash
        };
    }

    if (config.version !== undefined) {
        return { state: 'invalid' };
    }

    // 旧版本没有格式标记。只在密码验证成功后将其一次性迁移到 v2。
    if (config.enabled === false) {
        return { state: 'disabled', format: 'legacy' };
    }
    if (config.enabled === true
        && typeof config.password === 'string'
        && config.password.length > 0) {
        return {
            state: 'enabled',
            format: 'legacy',
            storedPassword: config.password
        };
    }

    return { state: 'invalid' };
}

function validatePasswordInput(password, { newPassword = false } = {}) {
    if (typeof password !== 'string' || password.length === 0) {
        return newPassword ? '请输入新密码' : '请输入密码';
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位`;
    }
    if (newPassword && password.length < MIN_PASSWORD_LENGTH) {
        return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`;
    }
    return null;
}

function createPasswordService(options = {}) {
    const passwordFile = options.passwordFile;
    const fsModule = options.fs || fs;
    const cryptoModule = options.crypto || crypto;
    const safeStorage = options.safeStorage || null;
    const logger = options.logger || console;
    const platform = options.platform || process.platform;

    if (typeof passwordFile !== 'string' || passwordFile.length === 0) {
        throw new TypeError('passwordFile is required');
    }

    const configDir = path.dirname(passwordFile);
    let operationQueue = Promise.resolve();
    let pendingOperations = 0;

    function logError(message, error) {
        if (logger && typeof logger.error === 'function') {
            logger.error(message, error);
        }
    }

    function readPasswordRecord() {
        let rawConfig;
        try {
            rawConfig = fsModule.readFileSync(passwordFile, 'utf8');
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return { state: 'missing' };
            }
            logError('读取密码配置失败:', error);
            return { state: 'invalid' };
        }

        try {
            return parsePasswordConfig(JSON.parse(rawConfig));
        } catch (error) {
            logError('解析密码配置失败:', error);
            return { state: 'invalid' };
        }
    }

    function savePasswordConfig(config) {
        let temporaryFile = null;
        try {
            fsModule.mkdirSync(configDir, { recursive: true, mode: 0o700 });
            const suffix = cryptoModule.randomBytes(8).toString('hex');
            temporaryFile = `${passwordFile}.${process.pid}.${suffix}.tmp`;
            fsModule.writeFileSync(
                temporaryFile,
                `${JSON.stringify(config, null, 2)}\n`,
                { encoding: 'utf8', mode: 0o600, flag: 'wx' }
            );
            fsModule.renameSync(temporaryFile, passwordFile);
            temporaryFile = null;
            return true;
        } catch (error) {
            logError('保存密码配置失败:', error);
            if (temporaryFile) {
                try {
                    fsModule.unlinkSync(temporaryFile);
                } catch (_) {
                    // 临时文件可能尚未创建或已被 rename。
                }
            }
            return false;
        }
    }

    function derivePasswordHash(password, salt) {
        return new Promise((resolve, reject) => {
            try {
                cryptoModule.scrypt(
                    password,
                    salt,
                    HASH_LENGTH,
                    SCRYPT_OPTIONS,
                    (error, derivedKey) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(Buffer.from(derivedKey));
                    }
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    async function createCredential(password) {
        const salt = cryptoModule.randomBytes(SALT_LENGTH);
        const hash = await derivePasswordHash(password, salt);
        return {
            scheme: PASSWORD_SCHEME,
            salt: salt.toString('base64'),
            hash: hash.toString('base64')
        };
    }

    function secureCompareStrings(left, right) {
        const leftDigest = cryptoModule.createHash('sha256').update(left, 'utf8').digest();
        const rightDigest = cryptoModule.createHash('sha256').update(right, 'utf8').digest();
        return cryptoModule.timingSafeEqual(leftDigest, rightDigest);
    }

    function canDecryptLegacyPassword() {
        try {
            return !!safeStorage
                && typeof safeStorage.isEncryptionAvailable === 'function'
                && typeof safeStorage.decryptString === 'function'
                && safeStorage.isEncryptionAvailable();
        } catch (_) {
            return false;
        }
    }

    function decodeLegacyCiphertextCandidate(value) {
        if (typeof value !== 'string'
            || value.length === 0
            || value.length % 4 !== 0
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
            return null;
        }

        const decoded = Buffer.from(value, 'base64');
        if (decoded.length === 0 || decoded.toString('base64') !== value) {
            return null;
        }
        return decoded;
    }

    function isSafeStorageAvailable() {
        try {
            if (!safeStorage
                || typeof safeStorage.isEncryptionAvailable !== 'function'
                || !safeStorage.isEncryptionAvailable()) {
                return false;
            }
            if (platform === 'linux'
                && typeof safeStorage.getSelectedStorageBackend === 'function') {
                return safeStorage.getSelectedStorageBackend() !== 'basic_text';
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function verifyLegacyPassword(storedPassword, inputPassword) {
        // 旧格式没有明文/密文标记；规范 Base64 必须成功解密，不能回退为原串密码。
        const encrypted = decodeLegacyCiphertextCandidate(storedPassword);
        if (encrypted) {
            if (!canDecryptLegacyPassword()) {
                return {
                    matches: false,
                    error: '系统安全存储不可用，无法验证旧版密码'
                };
            }
            try {
                const decryptedPassword = safeStorage.decryptString(encrypted);
                if (typeof decryptedPassword !== 'string') {
                    throw new TypeError('safeStorage returned a non-string password');
                }
                return {
                    matches: secureCompareStrings(decryptedPassword, inputPassword)
                };
            } catch (_) {
                return { matches: false, error: '旧版密码无法解密' };
            }
        }

        return {
            matches: secureCompareStrings(storedPassword, inputPassword)
        };
    }

    async function verifyRecord(record, inputPassword) {
        if (record.format === 'v2') {
            const derivedHash = await derivePasswordHash(inputPassword, record.salt);
            return {
                matches: cryptoModule.timingSafeEqual(record.hash, derivedHash)
            };
        }
        return verifyLegacyPassword(record.storedPassword, inputPassword);
    }

    function enqueuePasswordOperation(operation) {
        if (pendingOperations >= MAX_PENDING_PASSWORD_OPERATIONS) {
            return Promise.resolve({
                success: false,
                error: '密码操作过于频繁，请稍后重试'
            });
        }

        pendingOperations += 1;
        const result = operationQueue.then(operation, operation);
        operationQueue = result.then(
            () => undefined,
            () => undefined
        );
        return result.finally(() => {
            pendingOperations -= 1;
        });
    }

    function createEnabledConfig(credential) {
        return {
            version: PASSWORD_CONFIG_VERSION,
            enabled: true,
            credential
        };
    }

    function isRecordPasswordRequired(record) {
        return record.state !== 'missing' && record.state !== 'disabled';
    }

    async function verifyPasswordUnlocked(inputPassword) {
        const validationError = validatePasswordInput(inputPassword);
        if (validationError) {
            return { success: false, error: validationError };
        }

        const record = readPasswordRecord();
        if (record.state === 'missing' || record.state === 'disabled') {
            return { success: true };
        }
        if (record.state === 'invalid') {
            return { success: false, error: INVALID_CONFIG_ERROR };
        }

        try {
            const verification = await verifyRecord(record, inputPassword);
            if (verification.error) {
                return { success: false, error: verification.error };
            }
            if (!verification.matches) {
                return { success: false, error: '密码错误' };
            }

            if (record.format === 'legacy') {
                const credential = await createCredential(inputPassword);
                if (!savePasswordConfig(createEnabledConfig(credential))) {
                    return { success: false, error: '密码存储升级失败' };
                }
            }

            return { success: true };
        } catch (error) {
            logError('验证密码失败:', error);
            return { success: false, error: '密码验证失败' };
        }
    }

    async function setPasswordUnlocked(newPassword) {
        const validationError = validatePasswordInput(newPassword, { newPassword: true });
        if (validationError) {
            return { success: false, error: validationError };
        }

        const record = readPasswordRecord();
        if (record.state === 'invalid') {
            return { success: false, error: INVALID_CONFIG_ERROR };
        }
        if (record.state === 'enabled') {
            return { success: false, error: '密码保护已启用' };
        }

        try {
            const credential = await createCredential(newPassword);
            const saved = savePasswordConfig(createEnabledConfig(credential));
            return saved
                ? { success: true }
                : { success: false, error: SAVE_CONFIG_ERROR };
        } catch (error) {
            logError('生成密码摘要失败:', error);
            return { success: false, error: '密码设置失败' };
        }
    }

    async function changePasswordUnlocked(oldPassword, newPassword) {
        const oldPasswordError = validatePasswordInput(oldPassword);
        if (oldPasswordError) {
            return { success: false, error: oldPasswordError };
        }
        const newPasswordError = validatePasswordInput(newPassword, { newPassword: true });
        if (newPasswordError) {
            return { success: false, error: newPasswordError };
        }

        const record = readPasswordRecord();
        if (record.state === 'missing' || record.state === 'disabled') {
            return { success: false, error: '密码保护未启用' };
        }
        if (record.state === 'invalid') {
            return { success: false, error: INVALID_CONFIG_ERROR };
        }

        try {
            const verification = await verifyRecord(record, oldPassword);
            if (verification.error) {
                return { success: false, error: verification.error };
            }
            if (!verification.matches) {
                return { success: false, error: '原密码错误' };
            }

            const credential = await createCredential(newPassword);
            const saved = savePasswordConfig(createEnabledConfig(credential));
            return saved
                ? { success: true }
                : { success: false, error: SAVE_CONFIG_ERROR };
        } catch (error) {
            logError('修改密码失败:', error);
            return { success: false, error: '密码修改失败' };
        }
    }

    async function disablePasswordUnlocked(currentPassword) {
        const validationError = validatePasswordInput(currentPassword);
        if (validationError) {
            return { success: false, error: validationError };
        }

        const record = readPasswordRecord();
        if (record.state === 'missing' || record.state === 'disabled') {
            return { success: true };
        }
        if (record.state === 'invalid') {
            return { success: false, error: INVALID_CONFIG_ERROR };
        }

        try {
            const verification = await verifyRecord(record, currentPassword);
            if (verification.error) {
                return { success: false, error: verification.error };
            }
            if (!verification.matches) {
                return { success: false, error: '密码错误' };
            }

            const saved = savePasswordConfig({
                version: PASSWORD_CONFIG_VERSION,
                enabled: false
            });
            return saved
                ? { success: true }
                : { success: false, error: SAVE_CONFIG_ERROR };
        } catch (error) {
            logError('禁用密码保护失败:', error);
            return { success: false, error: '密码验证失败' };
        }
    }

    function isPasswordRequired() {
        return isRecordPasswordRequired(readPasswordRecord());
    }

    function verifyPassword(inputPassword) {
        return enqueuePasswordOperation(() => verifyPasswordUnlocked(inputPassword));
    }

    function setPassword(newPassword) {
        return enqueuePasswordOperation(() => setPasswordUnlocked(newPassword));
    }

    function changePassword(oldPassword, newPassword) {
        return enqueuePasswordOperation(() => (
            changePasswordUnlocked(oldPassword, newPassword)
        ));
    }

    function disablePassword(currentPassword) {
        return enqueuePasswordOperation(() => disablePasswordUnlocked(currentPassword));
    }

    function getStatus() {
        const record = readPasswordRecord();
        return {
            enabled: isRecordPasswordRequired(record),
            encryptionAvailable: isSafeStorageAvailable(),
            configurationValid: record.state !== 'invalid'
        };
    }

    return {
        changePassword,
        disablePassword,
        getStatus,
        isPasswordRequired,
        readPasswordRecord,
        setPassword,
        verifyPassword
    };
}

function getDefaultPasswordService() {
    if (!defaultPasswordService) {
        const electron = require('electron');
        const configDir = path.join(electron.app.getPath('userData'), 'config');
        defaultPasswordService = createPasswordService({
            passwordFile: path.join(configDir, 'password.json'),
            safeStorage: electron.safeStorage
        });
    }
    return defaultPasswordService;
}

/**
 * 注册密码保护相关 IPC 处理程序
 */
function registerPasswordHandlers(dependencies = {}) {
    const electron = dependencies.ipcMain ? null : require('electron');
    const ipc = dependencies.ipcMain || electron.ipcMain;
    const passwordService = dependencies.passwordService
        || (dependencies.passwordFile
            ? createPasswordService(dependencies)
            : getDefaultPasswordService());

    ipc.handle('password:isEnabled', async () => passwordService.isPasswordRequired());
    ipc.handle('password:verify', async (event, inputPassword) => (
        passwordService.verifyPassword(inputPassword)
    ));
    ipc.handle('password:set', async (event, newPassword) => (
        passwordService.setPassword(newPassword)
    ));
    ipc.handle('password:change', async (event, payload = {}) => {
        const { oldPassword, newPassword } = payload || {};
        return passwordService.changePassword(oldPassword, newPassword);
    });
    ipc.handle('password:disable', async (event, currentPassword) => (
        passwordService.disablePassword(currentPassword)
    ));
    ipc.handle('password:getStatus', async () => passwordService.getStatus());

    return passwordService;
}

/**
 * 检查是否需要密码验证（供主进程调用）
 */
function isPasswordRequired(passwordService = getDefaultPasswordService()) {
    return passwordService.isPasswordRequired();
}

module.exports = {
    HASH_LENGTH,
    MAX_PASSWORD_LENGTH,
    MAX_PENDING_PASSWORD_OPERATIONS,
    MIN_PASSWORD_LENGTH,
    PASSWORD_CONFIG_VERSION,
    PASSWORD_SCHEME,
    SALT_LENGTH,
    SCRYPT_OPTIONS,
    createPasswordService,
    isPasswordRequired,
    parsePasswordConfig,
    registerPasswordHandlers
};
