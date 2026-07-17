const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    PASSWORD_CONFIG_VERSION,
    PASSWORD_SCHEME,
    createPasswordService,
    registerPasswordHandlers
} = require('../main/handlers/password');

function createSafeStorageFake({ available = true, backend = 'dpapi' } = {}) {
    const state = {
        available,
        backend,
        decryptCalls: 0,
        encryptCalls: 0
    };

    return {
        state,
        isEncryptionAvailable: () => state.available,
        getSelectedStorageBackend: () => state.backend,
        encryptString(password) {
            state.encryptCalls += 1;
            return Buffer.from(`legacy:${password}`, 'utf8');
        },
        decryptString(encrypted) {
            state.decryptCalls += 1;
            const value = encrypted.toString('utf8');
            if (!value.startsWith('legacy:')) {
                throw new Error('not a legacy ciphertext');
            }
            return value.slice('legacy:'.length);
        }
    };
}

function createHarness(options = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'password-storage-'));
    const passwordFile = path.join(tempDir, 'config', 'password.json');
    const service = createPasswordService({
        passwordFile,
        safeStorage: options.safeStorage,
        fs: options.fs,
        crypto: options.crypto,
        platform: options.platform,
        logger: { error() {} }
    });

    return {
        passwordFile,
        service,
        cleanup() {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    };
}

function readRawConfig(passwordFile) {
    return fs.readFileSync(passwordFile, 'utf8');
}

function readConfig(passwordFile) {
    return JSON.parse(readRawConfig(passwordFile));
}

function writeConfig(passwordFile, value) {
    fs.mkdirSync(path.dirname(passwordFile), { recursive: true });
    fs.writeFileSync(
        passwordFile,
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        'utf8'
    );
}

test.describe('Password storage security', () => {
    test('uses salted scrypt when safeStorage is unavailable', async () => {
        const safeStorage = createSafeStorageFake({ available: false });
        const harness = createHarness({ safeStorage });
        const password = 'unavailable-storage-password';

        try {
            await expect(harness.service.setPassword(password)).resolves.toEqual({ success: true });

            const rawConfig = readRawConfig(harness.passwordFile);
            const config = JSON.parse(rawConfig);
            expect(rawConfig).not.toContain(password);
            expect(config).toEqual({
                version: PASSWORD_CONFIG_VERSION,
                enabled: true,
                credential: {
                    scheme: PASSWORD_SCHEME,
                    salt: expect.any(String),
                    hash: expect.any(String)
                }
            });
            expect(config).not.toHaveProperty('password');
            expect(safeStorage.state.encryptCalls).toBe(0);
            expect(safeStorage.state.decryptCalls).toBe(0);

            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });
            await expect(harness.service.verifyPassword('wrong-password')).resolves.toEqual({
                success: false,
                error: '密码错误'
            });
            expect(harness.service.getStatus()).toEqual({
                enabled: true,
                encryptionAvailable: false,
                configurationValid: true
            });
        } finally {
            harness.cleanup();
        }
    });

    test('v2 verification is independent of safeStorage availability and backend', async () => {
        const safeStorage = createSafeStorageFake({ available: true, backend: 'basic_text' });
        const harness = createHarness({ safeStorage, platform: 'linux' });
        const password = 'portable-scrypt-password';

        try {
            await expect(harness.service.setPassword(password)).resolves.toEqual({ success: true });
            expect(harness.service.getStatus().encryptionAvailable).toBe(false);

            safeStorage.state.available = false;
            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });

            safeStorage.state.available = true;
            safeStorage.state.backend = 'dpapi';
            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });
            expect(safeStorage.state.encryptCalls).toBe(0);
            expect(safeStorage.state.decryptCalls).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    test('the same password receives a different random salt each time', async () => {
        const first = createHarness();
        const second = createHarness();
        const password = 'same-password-different-salt';

        try {
            await expect(first.service.setPassword(password)).resolves.toEqual({ success: true });
            await expect(second.service.setPassword(password)).resolves.toEqual({ success: true });

            const firstCredential = readConfig(first.passwordFile).credential;
            const secondCredential = readConfig(second.passwordFile).credential;
            expect(firstCredential.salt).not.toBe(secondCredential.salt);
            expect(firstCredential.hash).not.toBe(secondCredential.hash);
        } finally {
            first.cleanup();
            second.cleanup();
        }
    });

    test('migrates a legacy plaintext password only after successful verification', async () => {
        const safeStorage = createSafeStorageFake({ available: false });
        const harness = createHarness({ safeStorage });
        const password = 'legacy-plaintext-password';
        const legacyConfig = JSON.stringify({ enabled: true, password }, null, 2);

        try {
            writeConfig(harness.passwordFile, legacyConfig);
            await expect(harness.service.verifyPassword('wrong-password')).resolves.toEqual({
                success: false,
                error: '密码错误'
            });
            expect(readRawConfig(harness.passwordFile)).toBe(legacyConfig);

            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });
            const migratedRaw = readRawConfig(harness.passwordFile);
            expect(migratedRaw).not.toContain(password);
            expect(readConfig(harness.passwordFile)).toEqual({
                version: PASSWORD_CONFIG_VERSION,
                enabled: true,
                credential: {
                    scheme: PASSWORD_SCHEME,
                    salt: expect.any(String),
                    hash: expect.any(String)
                }
            });
        } finally {
            harness.cleanup();
        }
    });

    test('migrates a legacy safeStorage ciphertext and then works without safeStorage', async () => {
        const safeStorage = createSafeStorageFake({ available: true });
        const harness = createHarness({ safeStorage });
        const password = 'abcd';

        try {
            const encryptedPassword = safeStorage.encryptString(password).toString('base64');
            safeStorage.state.encryptCalls = 0;
            writeConfig(harness.passwordFile, {
                enabled: true,
                password: encryptedPassword
            });

            await expect(harness.service.verifyPassword('wrong-password')).resolves.toEqual({
                success: false,
                error: '密码错误'
            });
            expect(readConfig(harness.passwordFile).password).toBe(encryptedPassword);

            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });
            expect(readRawConfig(harness.passwordFile)).not.toContain(encryptedPassword);
            expect(safeStorage.state.decryptCalls).toBe(2);
            expect(safeStorage.state.encryptCalls).toBe(0);

            safeStorage.state.available = false;
            await expect(harness.service.verifyPassword(password)).resolves.toEqual({ success: true });
            expect(safeStorage.state.decryptCalls).toBe(2);
        } finally {
            harness.cleanup();
        }
    });

    test('does not accept an undecryptable legacy ciphertext as the password itself', async () => {
        const safeStorage = createSafeStorageFake({ available: false });
        const harness = createHarness({ safeStorage });
        const password = 'abcd';

        try {
            const encryptedPassword = safeStorage.encryptString(password).toString('base64');
            safeStorage.state.encryptCalls = 0;
            const legacyConfig = JSON.stringify({
                enabled: true,
                password: encryptedPassword
            }, null, 2);
            writeConfig(harness.passwordFile, legacyConfig);

            await expect(harness.service.verifyPassword(encryptedPassword)).resolves.toEqual({
                success: false,
                error: '系统安全存储不可用，无法验证旧版密码'
            });
            await expect(harness.service.verifyPassword(password)).resolves.toEqual({
                success: false,
                error: '系统安全存储不可用，无法验证旧版密码'
            });
            expect(readRawConfig(harness.passwordFile)).toBe(legacyConfig);
            expect(safeStorage.state.decryptCalls).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    test('serializes legacy migration and disable so a late write cannot re-enable protection', async () => {
        const harness = createHarness();
        const password = 'legacy-race-password';

        try {
            writeConfig(harness.passwordFile, {
                enabled: true,
                password
            });

            const [verifyResult, disableResult] = await Promise.all([
                harness.service.verifyPassword(password),
                harness.service.disablePassword(password)
            ]);

            expect(verifyResult).toEqual({ success: true });
            expect(disableResult).toEqual({ success: true });
            expect(readConfig(harness.passwordFile)).toEqual({
                version: PASSWORD_CONFIG_VERSION,
                enabled: false
            });
            expect(harness.service.isPasswordRequired()).toBe(false);
        } finally {
            harness.cleanup();
        }
    });

    test('fails closed for malformed and unknown password records without running scrypt', async () => {
        let scryptCalls = 0;
        const countingCrypto = Object.create(crypto);
        countingCrypto.scrypt = (...args) => {
            scryptCalls += 1;
            return crypto.scrypt(...args);
        };
        const harness = createHarness({ crypto: countingCrypto });
        const invalidRecords = [
            '{invalid json',
            { version: 99, enabled: true, credential: {} },
            {
                version: PASSWORD_CONFIG_VERSION,
                enabled: true,
                credential: { scheme: 'unknown', salt: 'AAAA', hash: 'AAAA' }
            },
            {
                version: PASSWORD_CONFIG_VERSION,
                enabled: true,
                credential: {
                    scheme: PASSWORD_SCHEME,
                    salt: Buffer.alloc(15).toString('base64'),
                    hash: Buffer.alloc(32).toString('base64')
                }
            },
            {
                version: PASSWORD_CONFIG_VERSION,
                enabled: true,
                credential: {
                    scheme: PASSWORD_SCHEME,
                    salt: Buffer.alloc(16).toString('base64'),
                    hash: Buffer.alloc(31).toString('base64')
                }
            }
        ];

        try {
            for (const invalidRecord of invalidRecords) {
                writeConfig(harness.passwordFile, invalidRecord);
                expect(harness.service.isPasswordRequired()).toBe(true);
                expect(harness.service.getStatus()).toEqual({
                    enabled: true,
                    encryptionAvailable: false,
                    configurationValid: false
                });
                await expect(harness.service.verifyPassword('valid-password')).resolves.toEqual({
                    success: false,
                    error: '密码配置损坏，无法验证'
                });
            }
            expect(scryptCalls).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    test('validates main-process inputs and protects set, change and disable operations', async () => {
        const harness = createHarness();
        const oldPassword = 'original-secure-password';
        const newPassword = 'replacement-secure-password';

        try {
            await expect(harness.service.setPassword('abc')).resolves.toEqual({
                success: false,
                error: '密码长度至少 4 位'
            });
            expect(fs.existsSync(harness.passwordFile)).toBe(false);

            await expect(harness.service.setPassword(oldPassword)).resolves.toEqual({ success: true });
            const originalConfig = readRawConfig(harness.passwordFile);
            await expect(harness.service.setPassword('unauthorized-replacement')).resolves.toEqual({
                success: false,
                error: '密码保护已启用'
            });
            expect(readRawConfig(harness.passwordFile)).toBe(originalConfig);

            await expect(harness.service.changePassword('wrong-password', newPassword)).resolves.toEqual({
                success: false,
                error: '原密码错误'
            });
            expect(readRawConfig(harness.passwordFile)).toBe(originalConfig);

            await expect(harness.service.changePassword(oldPassword, newPassword)).resolves.toEqual({ success: true });
            const changedRaw = readRawConfig(harness.passwordFile);
            expect(changedRaw).not.toContain(oldPassword);
            expect(changedRaw).not.toContain(newPassword);
            await expect(harness.service.verifyPassword(oldPassword)).resolves.toEqual({
                success: false,
                error: '密码错误'
            });
            await expect(harness.service.verifyPassword(newPassword)).resolves.toEqual({ success: true });

            await expect(harness.service.disablePassword('wrong-password')).resolves.toEqual({
                success: false,
                error: '密码错误'
            });
            await expect(harness.service.disablePassword(newPassword)).resolves.toEqual({ success: true });
            expect(readConfig(harness.passwordFile)).toEqual({
                version: PASSWORD_CONFIG_VERSION,
                enabled: false
            });
            expect(harness.service.isPasswordRequired()).toBe(false);
        } finally {
            harness.cleanup();
        }
    });

    test('an atomic replace failure leaves the previous password config intact', async () => {
        const harness = createHarness();
        const oldPassword = 'atomic-old-password';
        const newPassword = 'atomic-new-password';

        try {
            await expect(harness.service.setPassword(oldPassword)).resolves.toEqual({ success: true });
            const originalConfig = readRawConfig(harness.passwordFile);
            const failingFs = new Proxy(fs, {
                get(target, property) {
                    if (property === 'renameSync') {
                        return () => {
                            const error = new Error('simulated rename failure');
                            error.code = 'EACCES';
                            throw error;
                        };
                    }
                    const value = target[property];
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
            const failingService = createPasswordService({
                passwordFile: harness.passwordFile,
                fs: failingFs,
                logger: { error() {} }
            });

            await expect(failingService.changePassword(oldPassword, newPassword)).resolves.toEqual({
                success: false,
                error: '保存密码配置失败'
            });
            expect(readRawConfig(harness.passwordFile)).toBe(originalConfig);
            expect(fs.readdirSync(path.dirname(harness.passwordFile)))
                .toEqual(['password.json']);
            await expect(harness.service.verifyPassword(oldPassword)).resolves.toEqual({ success: true });
        } finally {
            harness.cleanup();
        }
    });

    test('password:isEnabled returns a strict boolean and never a credential', async () => {
        const harness = createHarness();
        const handlers = new Map();
        const ipcMain = {
            handle(channel, handler) {
                handlers.set(channel, handler);
            }
        };

        try {
            registerPasswordHandlers({ ipcMain, passwordService: harness.service });
            const isEnabled = handlers.get('password:isEnabled');

            await expect(isEnabled()).resolves.toBe(false);
            await expect(harness.service.setPassword('strict-boolean-password')).resolves.toEqual({ success: true });
            const enabledResult = await isEnabled();
            expect(enabledResult).toBe(true);
            expect(typeof enabledResult).toBe('boolean');
        } finally {
            harness.cleanup();
        }
    });
});
