/**
 * 资产勘测 (Asset Reconnaissance) 主进程模块
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');
const snmp = require('net-snmp');
const { promisify } = require('util');
const { app, ipcMain, safeStorage } = require('electron');

const resolve4 = promisify(dns.resolve4);
dns.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']); // 使用公共 DNS 提高解析速度与稳定性

let subdomainScanCancelled = false;
let fingerprintScanCancelled = false;
let activeSnmpSession = null;
let activeSnmpNeighborSession = null;
let snmpScanCancelled = false;

const SNMP_INTERFACE_TIMEOUT = 8000;
const SNMP_INTERFACE_RETRIES = 1;
const SNMP_INTERFACE_BACKOFF = 1.2;
const SNMP_WALK_MAX_REPETITIONS = 5;
const SNMP_MAX_WALK_ROWS = 4096;
const SNMP_ATTR_BATCH_SIZE = 4;
const SNMP_ATTR_CONCURRENCY = 2;
const SNMP_NEIGHBOR_MAX_REPETITIONS = 4;
const SNMP_NEIGHBOR_TIMEOUT = 5000;

// 常用子域名字典 (约 200 个常用词，避免单机执行过慢，同时覆盖 80% 的资产)
const COMMON_SUBDOMAINS = [
    'www', 'mail', 'dev', 'test', 'api', 'admin', 'login', 'portal', 'm', 'blog', 
    'vpn', 'oa', 'git', 'svn', 'secure', 'news', 'shop', 'store', 'app', 'static', 
    'assets', 'media', 'images', 'img', 'css', 'js', 'download', 'update', 'docs', 'wiki', 
    'help', 'support', 'feedback', 'forums', 'chat', 'demo', 'beta', 'alpha', 'staging', 'prod', 
    'status', 'monitor', 'zabbix', 'grafana', 'prometheus', 'elk', 'elastic', 'log', 'logs', 'backup', 
    'db', 'sql', 'mysql', 'oracle', 'redis', 'mongo', 'ldap', 'ad', 'active', 'dns', 
    'ns1', 'ns2', 'ns3', 'ns4', 'smtp', 'pop', 'imap', 'webmail', 'exchange', 'mail2', 
    'cloud', 'storage', 's3', 'cdn', 'ftp', 'sftp', 'files', 'share', 'sync', 'nas', 
    'router', 'switch', 'firewall', 'gateway', 'fw', 'rt', 'sw', 'ap', 'wifi', 'lan', 
    'internal', 'intranet', 'local', 'corp', 'office', 'staff', 'member', 'user', 'client', 'partner', 
    'hr', 'crm', 'erp', 'billing', 'pay', 'payment', 'finance', 'report', 'stats', 'analytics', 
    'job', 'career', 'hrportal', 'training', 'learn', 'course', 'school', 'edu', 'library', 'search', 
    'find', 'query', 'service', 'ws', 'xml', 'json', 'soap', 'rest', 'auth', 'oauth', 
    'sso', 'cas', 'idp', 'saml', 'sign', 'verify', 'code', 'token', 'key', 'cert', 
    'ssl', 'ts', 'time', 'ntp', 'clock', 'syslog', 'agent', 'node', 'cluster', 'server', 
    'host', 'pc', 'workstation', 'terminal', 'device', 'printer', 'camera', 'cctv', 'dvr', 'nvr', 
    'iot', 'smart', 'home', 'play', 'game', 'video', 'audio', 'music', 'live', 'stream', 
    'tv', 'movie', 'radio', 'podcast', 'channel', 'hub', 'box', 'link', 'go', 'to', 
    'short', 'url', 'map', 'gps', 'weather', 'news', 'press', 'info', 'about', 'contact'
];

// 内置轻量级 Web 指纹识别特征库
const FINGERPRINT_DB = [
    { name: 'WordPress', rules: [{ type: 'body', pattern: 'wp-content/' }] },
    { name: 'ThinkPHP', rules: [{ type: 'header', key: 'x-powered-by', pattern: 'ThinkPHP' }, { type: 'cookie', pattern: 'think_lang' }] },
    { name: 'Shiro', rules: [{ type: 'header', key: 'set-cookie', pattern: 'rememberMe=deleteMe' }] },
    { name: 'Tomcat', rules: [{ type: 'header', key: 'server', pattern: 'Apache-Coyote' }, { type: 'title', pattern: 'Apache Tomcat' }] },
    { name: 'Nginx', rules: [{ type: 'header', key: 'server', pattern: 'nginx' }] },
    { name: 'Apache', rules: [{ type: 'header', key: 'server', pattern: 'Apache' }] },
    { name: 'IIS', rules: [{ type: 'header', key: 'server', pattern: 'Microsoft-IIS' }] },
    { name: 'WebLogic', rules: [{ type: 'body', pattern: 'weblogic.jsp' }, { type: 'header', key: 'server', pattern: 'WebLogic' }] },
    { name: 'Spring Boot', rules: [{ type: 'body', pattern: 'Whitelabel Error Page' }, { type: 'cookie', pattern: 'JSESSIONID' }] },
    { name: '海康威视摄像头', rules: [{ type: 'title', pattern: 'Hikvision' }, { type: 'body', pattern: 'doc/page/login.asp' }] },
    { name: '华为设备', rules: [{ type: 'title', pattern: 'Huawei' }, { type: 'title', pattern: '华为' }] },
    { name: 'H3C设备', rules: [{ type: 'title', pattern: 'H3C' }, { type: 'body', pattern: 'h3c_logo' }] },
    { name: 'Cisco设备', rules: [{ type: 'title', pattern: 'Cisco' }, { type: 'header', key: 'server', pattern: 'Cisco' }] },
    { name: 'phpMyAdmin', rules: [{ type: 'body', pattern: 'pma_username' }, { type: 'title', pattern: 'phpMyAdmin' }] }
];

/**
 * 获取配置文件路径
 */
function getConfigPath() {
    return path.join(app.getPath('userData'), 'reconnaissance-config.json');
}

/**
 * 读取配置
 */
function loadConfig() {
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.fofaKey_encrypted && safeStorage.isEncryptionAvailable()) {
                try {
                    config.fofaKey = safeStorage.decryptString(Buffer.from(config.fofaKey_encrypted, 'base64'));
                } catch (_) {}
            }
            return {
                fofaEmail: config.fofaEmail || '',
                fofaKey: config.fofaKey || ''
            };
        }
    } catch (_) {}
    return { fofaEmail: '', fofaKey: '' };
}

/**
 * 保存配置
 */
function saveConfig(config) {
    try {
        const configPath = getConfigPath();
        const configToSave = {
            fofaEmail: config.fofaEmail || ''
        };
        
        if (config.fofaKey) {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(config.fofaKey);
                configToSave.fofaKey_encrypted = encrypted.toString('base64');
            } else {
                configToSave.fofaKey = config.fofaKey;
            }
        }
        
        fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * HTTPS GET 请求封装
 */
function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 NetTools/1.1',
                ...headers
            }
        };

        const req = https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                data: data
            }));
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request Timeout'));
        });
    });
}

/**
 * HTTP/HTTPS Probe (指纹识别探测)
 */
function probeWeb(host, port, ssl = false) {
    return new Promise((resolve) => {
        const protocol = ssl ? 'https' : 'http';
        const url = `${protocol}://${host}:${port}/`;

        const httpModule = ssl ? https : require('http');
        const options = {
            hostname: host,
            port: port,
            path: '/',
            method: 'GET',
            timeout: 4000,
            headers: {
                'User-Agent': 'Mozilla/5.0 NetTools/1.1'
            }
        };

        const req = httpModule.request(options, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                if (body.length < 50000) body += chunk; // 限制返回长度避免内存溢出
            });
            res.on('end', () => {
                resolve({
                    success: true,
                    url: url,
                    status: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });

        req.on('error', () => {
            resolve({ success: false, url: url });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, url: url, error: 'timeout' });
        });
        req.end();
    });
}

/**
 * 执行指纹匹配规则
 */
function matchFingerprints(res) {
    if (!res || !res.success) return [];
    
    const headers = res.headers || {};
    const body = res.body || '';
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const detected = [];

    for (const finger of FINGERPRINT_DB) {
        let matched = false;
        for (const rule of finger.rules) {
            if (rule.type === 'body' && body.includes(rule.pattern)) {
                matched = true;
            } else if (rule.type === 'title' && title.includes(rule.pattern)) {
                matched = true;
            } else if (rule.type === 'header') {
                const headerVal = headers[rule.key.toLowerCase()];
                if (headerVal) {
                    if (Array.isArray(headerVal)) {
                        matched = headerVal.some(val => val.toLowerCase().includes(rule.pattern.toLowerCase()));
                    } else if (typeof headerVal === 'string') {
                        matched = headerVal.toLowerCase().includes(rule.pattern.toLowerCase());
                    }
                }
            } else if (rule.type === 'cookie') {
                const cookieVal = headers['set-cookie'];
                if (cookieVal && cookieVal.some(c => c.toLowerCase().includes(rule.pattern.toLowerCase()))) {
                    matched = true;
                }
            }
        }
        if (matched) {
            detected.push(finger.name);
        }
    }
    return detected;
}

/**
 * 遍历 LLDP 邻居表 (仅 Walk 主机名与接口描述列，大幅提速)
 */
function createSnmpSession(ip, params, overrides = {}) {
    const version = (params && params.version) || '2c';
    if (version === '3') {
        const username = params.username || '';
        const authProto = params.authProto || 'none';
        const authPass = params.authPass || '';
        const privProto = params.privProto || 'none';
        const privPass = params.privPass || '';

        let level = snmp.SecurityLevel.noAuthNoPriv;
        const user = { name: username };

        if (authProto !== 'none') {
            if (privProto !== 'none') {
                level = snmp.SecurityLevel.authPriv;
            } else {
                level = snmp.SecurityLevel.authNoPriv;
            }

            user.level = level;
            user.authProtocol = snmp.AuthProtocols[authProto];
            user.authKey = authPass;

            if (privProto !== 'none') {
                user.privProtocol = snmp.PrivProtocols[privProto];
                user.privKey = privPass;
            }
        } else {
            user.level = level;
        }

        return snmp.createV3Session(ip, user, {
            port: 161,
            timeout: SNMP_INTERFACE_TIMEOUT,
            retries: SNMP_INTERFACE_RETRIES,
            backoff: SNMP_INTERFACE_BACKOFF,
            ...overrides
        });
    } else {
        const community = (params && params.community) || 'public';
        const snmpVersion = version === '1' ? snmp.Version1 : snmp.Version2c;
        return snmp.createSession(ip, community, {
            port: 161,
            version: snmpVersion,
            timeout: SNMP_INTERFACE_TIMEOUT,
            retries: SNMP_INTERFACE_RETRIES,
            backoff: SNMP_INTERFACE_BACKOFF,
            ...overrides
        });
    }
}

function closeSession(session) {
    try { session.close(); } catch (_) {}
}

function isOidInSubtree(oid, baseOid) {
    return oid === baseOid || oid.startsWith(baseOid + '.');
}

function getNextVarbind(session, oid) {
    return new Promise((resolve, reject) => {
        session.getNext([oid], (error, varbinds) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(varbinds && varbinds[0] ? varbinds[0] : null);
        });
    });
}

async function walkSubtreeByGetNext(session, baseOid, feedCb, maxRows = SNMP_MAX_WALK_ROWS) {
    let cursor = baseOid;
    const seenOids = new Set();

    for (let row = 0; row < maxRows; row += 1) {
        const vb = await getNextVarbind(session, cursor);
        if (!vb || snmp.isVarbindError(vb) || !isOidInSubtree(vb.oid, baseOid)) {
            return;
        }
        if (seenOids.has(vb.oid)) {
            return;
        }

        seenOids.add(vb.oid);
        const stop = feedCb([vb]);
        cursor = vb.oid;

        if (stop === true) {
            return;
        }
    }

    throw new Error('SNMP walk exceeded row limit');
}

function walkSubtreeWithFallback(session, baseOid, maxRepetitions, feedCb, options = {}) {
    const allowGetNextFallback = options.allowGetNextFallback !== false;
    const maxRows = options.maxRows || SNMP_MAX_WALK_ROWS;

    return new Promise((resolve, reject) => {
        session.subtree(baseOid, maxRepetitions, feedCb, async (error) => {
            if (!error) {
                resolve({ fallback: false });
                return;
            }
            if (!allowGetNextFallback || session.version === snmp.Version1) {
                reject(error);
                return;
            }

            try {
                await walkSubtreeByGetNext(session, baseOid, feedCb, maxRows);
                resolve({ fallback: true, originalError: error });
            } catch (fallbackError) {
                reject(new Error(`${error.message}; GETNEXT fallback failed: ${fallbackError.message}`));
            }
        });
    });
}

function formatMac(buffer) {
    if (!Buffer.isBuffer(buffer)) return '';
    if (buffer.length === 6) {
        return Array.from(buffer)
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
    }
    return buffer.toString();
}

function mapIfType(val) {
    const types = {
        1: 'other',
        6: 'ethernet',
        24: 'loopback',
        53: 'virtual',
        135: 'l2vlan',
        136: 'l3ipvlan',
        161: 'lag'
    };
    return types[val] || `type(${val})`;
}

function buildDetailedSnmpError(phase, error) {
    const msg = error && error.message ? error.message : String(error || '');
    const isTimeout = /timed out|timeout/i.test(msg) || (error && error.name === 'RequestTimedOutError');
    
    if (phase === 'sysInfo') {
        if (isTimeout) {
            return `设备不可达或认证失败。原因可能是：设备 IP 不在线、UDP 161 端口不通、或 SNMP 团体名/v3 认证参数错误。`;
        }
        return `获取系统信息失败: ${msg}`;
    }
    
    if (phase === 'ifDescr') {
        if (isTimeout) {
            return `获取接口列表超时。设备可能负载过高或存在防火墙拦截。`;
        }
        if (/noSuchName|authorization|notWritable|noAccess/i.test(msg)) {
            return `权限不足：设备只允许读取系统 OID，不允许读取接口表 (IF-MIB)。请检查设备的 SNMP 视图 (View) 或 ACL 设置。`;
        }
        return `获取接口表失败: ${msg}`;
    }
    
    if (phase === 'ifAttrs') {
        if (isTimeout) {
            return `读取接口属性超时。设备接口表可能过大或响应慢，建议开启“快速模式”。`;
        }
        return `读取接口属性失败: ${msg}`;
    }
    
    return `${phase} 阶段出错: ${msg}`;
}

function snmpValueToNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'bigint') return Number(value);
    if (Buffer.isBuffer(value)) {
        let result = 0n;
        for (const byte of value.values()) {
            result = (result << 8n) + BigInt(byte);
        }
        return Number(result);
    }
    if (value && typeof value.toString === 'function') {
        const parsed = Number(value.toString());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function parseInterfaceOid(oid) {
    const ifTablePrefix = '1.3.6.1.2.1.2.2.1.';
    const ifXTablePrefix = '1.3.6.1.2.1.31.1.1.1.';

    if (oid.startsWith(ifTablePrefix)) {
        const parts = oid.slice(ifTablePrefix.length).split('.');
        return { table: 'ifTable', column: parseInt(parts[0], 10), index: parseInt(parts[1], 10) };
    }
    if (oid.startsWith(ifXTablePrefix)) {
        const parts = oid.slice(ifXTablePrefix.length).split('.');
        return { table: 'ifXTable', column: parseInt(parts[0], 10), index: parseInt(parts[1], 10) };
    }
    return null;
}

function applyInterfaceVarbind(interfaces, vb) {
    if (!vb || snmp.isVarbindError(vb)) return;

    const parsed = parseInterfaceOid(vb.oid);
    if (!parsed || Number.isNaN(parsed.column) || Number.isNaN(parsed.index)) return;

    const item = interfaces[parsed.index];
    if (!item) return;

    const val = snmpValueToNumber(vb.value);

    if (parsed.table === 'ifTable') {
        switch (parsed.column) {
            case 3: item.type = mapIfType(val); break;
            case 4: item.mtu = val; break;
            case 5:
                if (!item.highSpeed) item.speed = val;
                break;
            case 6: item.physAddress = formatMac(vb.value); break;
            case 7: item.adminStatus = val; break;
            case 8: item.operStatus = val; break;
            case 9: item.lastChange = val; break;
            case 10:
                if (item.inCounterBits !== 64) {
                    item.inOctets = val;
                    item.inCounterBits = 32;
                }
                break;
            case 13: item.inDiscards = val; break;
            case 14: item.inErrors = val; break;
            case 16:
                if (item.outCounterBits !== 64) {
                    item.outOctets = val;
                    item.outCounterBits = 32;
                }
                break;
            case 19: item.outDiscards = val; break;
            case 20: item.outErrors = val; break;
        }
        return;
    }

    if (parsed.table === 'ifXTable') {
        switch (parsed.column) {
            case 6:
                item.inOctets = val;
                item.inCounterBits = 64;
                break;
            case 10:
                item.outOctets = val;
                item.outCounterBits = 64;
                break;
            case 15:
                if (val > 0) {
                    item.highSpeed = val;
                    item.speed = val * 1000000;
                }
                break;
            case 18:
                item.alias = vb.value ? vb.value.toString() : '';
                break;
        }
    }
}

async function runLimited(tasks, concurrency) {
    if (tasks.length === 0) return;

    let nextIndex = 0;
    const workerCount = Math.min(Math.max(concurrency, 1), tasks.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < tasks.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await tasks[currentIndex]();
        }
    });

    await Promise.all(workers);
}

async function readInterfaceAttributes(session, interfaces, indexes, version) {
    const tasks = [];

    for (let i = 0; i < indexes.length; i += SNMP_ATTR_BATCH_SIZE) {
        const batch = indexes.slice(i, i + SNMP_ATTR_BATCH_SIZE);
        const oidsToGet = [];

        batch.forEach(idx => {
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.3.${idx}`); // ifType
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.4.${idx}`); // ifMtu
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.5.${idx}`); // ifSpeed
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.6.${idx}`); // ifPhysAddress
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.7.${idx}`); // ifAdminStatus
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.8.${idx}`); // ifOperStatus
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.9.${idx}`); // ifLastChange
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.10.${idx}`); // ifInOctets
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.13.${idx}`); // ifInDiscards
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.14.${idx}`); // ifInErrors
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.16.${idx}`); // ifOutOctets
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.19.${idx}`); // ifOutDiscards
            oidsToGet.push(`1.3.6.1.2.1.2.2.1.20.${idx}`); // ifOutErrors

            if (version !== '1') {
                oidsToGet.push(`1.3.6.1.2.1.31.1.1.1.6.${idx}`);  // ifHCInOctets
                oidsToGet.push(`1.3.6.1.2.1.31.1.1.1.10.${idx}`); // ifHCOutOctets
                oidsToGet.push(`1.3.6.1.2.1.31.1.1.1.15.${idx}`); // ifHighSpeed
                oidsToGet.push(`1.3.6.1.2.1.31.1.1.1.18.${idx}`); // ifAlias
            }
        });

        const runBatch = (retryCount = 0) => new Promise((resolve) => {
            if (snmpScanCancelled) return resolve();
            
            session.get(oidsToGet, (errGet, responseVarbinds) => {
                if (errGet) {
                    if (retryCount < 1) {
                        console.warn(`[SNMP] Batch get failed for indexes [${batch.join(',')}], retrying... Error: ${errGet.message}`);
                        setTimeout(() => {
                            resolve(runBatch(retryCount + 1));
                        }, 500);
                    } else {
                        console.error(`[SNMP] Batch get failed after retry for indexes [${batch.join(',')}]: ${errGet.message}`);
                        batch.forEach(idx => {
                            if (interfaces[idx]) {
                                interfaces[idx].partialMissing = true;
                            }
                        });
                        resolve();
                    }
                } else {
                    if (responseVarbinds) {
                        responseVarbinds.forEach(vb => applyInterfaceVarbind(interfaces, vb));
                    }
                    resolve();
                }
            });
        });

        tasks.push(runBatch);
    }

    await runLimited(tasks, SNMP_ATTR_CONCURRENCY);
}

function withSoftTimeout(promiseFactory, timeoutMs, fallbackValue, timeoutMessage) {
    let finished = false;
    let timer = null;

    const work = Promise.resolve()
        .then(promiseFactory)
        .then((value) => {
            finished = true;
            if (timer) clearTimeout(timer);
            return value;
        })
        .catch((error) => {
            finished = true;
            if (timer) clearTimeout(timer);
            console.error(timeoutMessage, error);
            return fallbackValue;
        });

    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            if (!finished) console.warn(timeoutMessage);
            resolve(fallbackValue);
        }, timeoutMs);
    });

    return Promise.race([work, timeout]);
}

function walkLldpTable(session) {
    return new Promise(async (resolve) => {
        const lldpNeighbors = {};

        const walkSysName = () => new Promise((resWalk) => {
            session.subtree('1.0.8802.1.1.2.1.4.1.1.9', SNMP_NEIGHBOR_MAX_REPETITIONS, (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue;
                    const parts = vb.oid.split('.');
                    if (parts.length >= 14) {
                        const localPortNum = parseInt(parts[12], 10);
                        if (!lldpNeighbors[localPortNum]) lldpNeighbors[localPortNum] = { deviceName: '', portName: '' };
                        lldpNeighbors[localPortNum].deviceName = vb.value.toString();
                    }
                }
            }, () => resWalk());
        });

        const walkPortDesc = () => new Promise((resWalk) => {
            session.subtree('1.0.8802.1.1.2.1.4.1.1.8', SNMP_NEIGHBOR_MAX_REPETITIONS, (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue;
                    const parts = vb.oid.split('.');
                    if (parts.length >= 14) {
                        const localPortNum = parseInt(parts[12], 10);
                        if (!lldpNeighbors[localPortNum]) lldpNeighbors[localPortNum] = { deviceName: '', portName: '' };
                        lldpNeighbors[localPortNum].portName = vb.value.toString();
                    }
                }
            }, () => resWalk());
        });

        await Promise.all([walkSysName(), walkPortDesc()]);
        resolve(lldpNeighbors);
    });
}

/**
 * 遍历 CDP 邻居表 (仅 Walk 设备 ID 与接口列，大幅提速)
 */
function walkCdpTable(session) {
    return new Promise(async (resolve) => {
        const cdpNeighbors = {};

        const walkDeviceId = () => new Promise((resWalk) => {
            session.subtree('1.3.6.1.4.1.9.9.23.1.2.1.1.6', SNMP_NEIGHBOR_MAX_REPETITIONS, (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue;
                    const parts = vb.oid.split('.');
                    if (parts.length >= 16) {
                        const localIfIndex = parseInt(parts[14], 10);
                        if (!cdpNeighbors[localIfIndex]) cdpNeighbors[localIfIndex] = { deviceName: '', portName: '' };
                        cdpNeighbors[localIfIndex].deviceName = vb.value.toString();
                    }
                }
            }, () => resWalk());
        });

        const walkDevicePort = () => new Promise((resWalk) => {
            session.subtree('1.3.6.1.4.1.9.9.23.1.2.1.1.7', SNMP_NEIGHBOR_MAX_REPETITIONS, (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue;
                    const parts = vb.oid.split('.');
                    if (parts.length >= 16) {
                        const localIfIndex = parseInt(parts[14], 10);
                        if (!cdpNeighbors[localIfIndex]) cdpNeighbors[localIfIndex] = { deviceName: '', portName: '' };
                        cdpNeighbors[localIfIndex].portName = vb.value.toString();
                    }
                }
            }, () => resWalk());
        });

        await Promise.all([walkDeviceId(), walkDevicePort()]);
        resolve(cdpNeighbors);
    });
}


/**
 * 注册资产勘测 IPC 监听
 */
function registerReconnaissanceHandlers(context) {
    const { getMainWindow } = context;

    // 1. 获取配置
    ipcMain.handle('recon:getConfig', async () => {
        return loadConfig();
    });

    // 2. 保存配置
    ipcMain.handle('recon:saveConfig', async (event, config) => {
        return saveConfig(config);
    });

    // 3. FOFA 查询
    ipcMain.handle('recon:fofaSearch', async (event, { query, page = 1, size = 100 }) => {
        const { fofaEmail, fofaKey } = loadConfig();
        if (!fofaEmail || !fofaKey) {
            return { success: false, error: '请先在 FOFA 设置中配置 Email 和 API Key' };
        }

        const qbase64 = Buffer.from(query).toString('base64');
        const fields = 'host,ip,port,protocol,title,server,country_name';
        const url = `https://fofa.info/api/v1/search/all?email=${encodeURIComponent(fofaEmail)}&key=${encodeURIComponent(fofaKey)}&qbase64=${encodeURIComponent(qbase64)}&page=${page}&size=${size}&fields=${fields}`;

        try {
            const res = await httpsGet(url);
            if (res.statusCode !== 200) {
                const errorJson = JSON.parse(res.data);
                return { success: false, error: errorJson.errmsg || `HTTP 错误码: ${res.statusCode}` };
            }
            const dataJson = JSON.parse(res.data);
            if (dataJson.error) {
                return { success: false, error: dataJson.errmsg || 'API 调用报错' };
            }
            // 组装格式
            const list = (dataJson.results || []).map(item => ({
                host: item[0],
                ip: item[1],
                port: item[2],
                protocol: item[3] || (item[2] === '443' ? 'https' : 'http'),
                title: item[4],
                server: item[5],
                country: item[6] || 'Unknown'
            }));
            return { success: true, results: list, total: dataJson.size || 0 };
        } catch (e) {
            return { success: false, error: `查询失败: ${e.message}` };
        }
    });

    // 4. 域名爆破开始
    ipcMain.handle('recon:startSubdomain', async (event, { domain, concurrency = 20 }) => {
        subdomainScanCancelled = false;
        const total = COMMON_SUBDOMAINS.length;
        let completed = 0;
        const results = [];
        const win = getMainWindow();

        for (let i = 0; i < COMMON_SUBDOMAINS.length; i += concurrency) {
            if (subdomainScanCancelled) break;
            
            const batch = COMMON_SUBDOMAINS.slice(i, i + concurrency);
            const batchPromises = batch.map(async (sub) => {
                const target = `${sub}.${domain}`;
                try {
                    const ips = await resolve4(target);
                    return { subdomain: target, status: 'resolved', ips, error: null };
                } catch (_) {
                    return null; // 解析失败的不予收集
                }
            });

            const batchResults = await Promise.all(batchPromises);
            const resolved = batchResults.filter(r => r !== null);
            
            completed += batch.length;
            results.push(...resolved);

            if (win && !win.isDestroyed()) {
                win.webContents.send('recon:subdomain-progress', {
                    current: completed,
                    total,
                    newResolved: resolved
                });
            }
        }
        return { success: true, results, total };
    });

    // 5. 域名爆破停止
    ipcMain.handle('recon:stopSubdomain', async () => {
        subdomainScanCancelled = true;
        return { success: true };
    });

    // 6. Web 指纹识别开始 (支持单个站点探测，或对输入的目标端口进行检测)
    ipcMain.handle('recon:startFingerprint', async (event, { targets, concurrency = 5 }) => {
        fingerprintScanCancelled = false;
        
        // 解析输入的 targets (逗号或换行分割)
        let parsedTargets = [];
        targets.split(/[\n,]+/).forEach(t => {
            const trimmed = t.trim();
            if (!trimmed) return;
            // 补全协议，提炼主机名和端口号
            let ssl = false;
            let host = trimmed;
            let port = 80;

            if (trimmed.startsWith('https://')) {
                ssl = true;
                host = trimmed.substring(8);
                port = 443;
            } else if (trimmed.startsWith('http://')) {
                host = trimmed.substring(7);
            }

            const colonIdx = host.indexOf(':');
            if (colonIdx !== -1) {
                const pStr = host.substring(colonIdx + 1);
                host = host.substring(0, colonIdx);
                port = parseInt(pStr, 10) || (ssl ? 443 : 80);
            }
            parsedTargets.push({ host, port, ssl });
        });

        const total = parsedTargets.length;
        let completed = 0;
        const results = [];
        const win = getMainWindow();

        for (let i = 0; i < parsedTargets.length; i += concurrency) {
            if (fingerprintScanCancelled) break;

            const batch = parsedTargets.slice(i, i + concurrency);
            const batchPromises = batch.map(async (tgt) => {
                const res = await probeWeb(tgt.host, tgt.port, tgt.ssl);
                if (res.success) {
                    const fingerprints = matchFingerprints(res);
                    const titleMatch = res.body.match(/<title>([^<]+)<\/title>/i);
                    const title = titleMatch ? titleMatch[1].trim() : '';
                    return {
                        url: res.url,
                        status: res.status,
                        title: title || 'No Title',
                        server: res.headers['server'] || 'Unknown',
                        fingerprints: fingerprints.length > 0 ? fingerprints : ['Generic Web Service']
                    };
                } else {
                    return {
                        url: res.url,
                        status: 'offline/timeout',
                        title: '-',
                        server: '-',
                        fingerprints: []
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            completed += batch.length;
            results.push(...batchResults);

            if (win && !win.isDestroyed()) {
                win.webContents.send('recon:fingerprint-progress', {
                    current: completed,
                    total,
                    newResults: batchResults
                });
            }
        }
        return { success: true, results };
    });

    // 7. Web 指纹识别停止
    ipcMain.handle('recon:stopFingerprint', async () => {
        fingerprintScanCancelled = true;
        return { success: true };
    });

    // 8. SNMP 获取接口列表
    ipcMain.handle('recon:startSnmpInterfaceScan', async (event, params) => {
        const { ip, mode = 'full' } = params;
        const win = getMainWindow();

        snmpScanCancelled = false;
        
        const sendProgress = (phase, percent, detail) => {
            if (win && !win.isDestroyed() && !snmpScanCancelled) {
                win.webContents.send('recon:snmp-progress', { phase, percent, detail });
            }
        };

        return new Promise(async (resolve) => {
            try {
                sendProgress('sysInfo', 10, '正在连接设备并获取系统基本信息...');
                activeSnmpSession = createSnmpSession(ip, params);
            } catch (err) {
                resolve({ success: false, error: buildDetailedSnmpError('sysInfo', err) });
                return;
            }

            // 获取基本信息
            const sysOids = [
                '1.3.6.1.2.1.1.5.0', // sysName
                '1.3.6.1.2.1.1.3.0', // sysUpTime
                '1.3.6.1.2.1.1.1.0'  // sysDescr
            ];

            let deviceName = '-';
            let deviceUptime = '-';
            let deviceDescr = '-';

            activeSnmpSession.get(sysOids, (error, varbinds) => {
                if (snmpScanCancelled) {
                    if (activeSnmpSession) {
                        closeSession(activeSnmpSession);
                        activeSnmpSession = null;
                    }
                    resolve({ success: false, error: '扫描被用户取消', cancelled: true });
                    return;
                }

                if (error) {
                    closeSession(activeSnmpSession);
                    activeSnmpSession = null;
                    resolve({ success: false, error: buildDetailedSnmpError('sysInfo', error) });
                    return;
                }

                try {
                    if (varbinds[0] && !snmp.isVarbindError(varbinds[0])) {
                        deviceName = varbinds[0].value.toString();
                    }
                    if (varbinds[1] && !snmp.isVarbindError(varbinds[1])) {
                        const ticks = parseInt(varbinds[1].value, 10);
                        const seconds = Math.floor(ticks / 100);
                        const days = Math.floor(seconds / 86400);
                        const hours = Math.floor((seconds % 86400) / 3600);
                        const minutes = Math.floor((seconds % 3600) / 60);
                        deviceUptime = `${days}天 ${hours}小时 ${minutes}分钟`;
                    }
                    if (varbinds[2] && !snmp.isVarbindError(varbinds[2])) {
                        deviceDescr = varbinds[2].value.toString();
                    }
                } catch (e) {
                    console.error('解析系统信息出错:', e);
                }

                sendProgress('ifDescr', 30, '正在检索接口列表 (Walk ifDescr)...');

                const ifDescrOid = '1.3.6.1.2.1.2.2.1.2';
                const interfaces = {};

                walkSubtreeWithFallback(activeSnmpSession, ifDescrOid, SNMP_WALK_MAX_REPETITIONS, (varbinds) => {
                    if (snmpScanCancelled) return true; // Stop walking
                    for (const vb of varbinds) {
                        if (snmp.isVarbindError(vb)) continue;
                        const parts = vb.oid.split('.');
                        if (parts.length >= 11) {
                            const index = parseInt(parts[10], 10);
                            interfaces[index] = {
                                index,
                                name: vb.value.toString(),
                                type: '-',
                                physAddress: '-',
                                adminStatus: '-',
                                operStatus: '-',
                                lastChange: '-',
                                mtu: '-',
                                speed: '-',
                                inOctets: 0,
                                outOctets: 0,
                                inCounterBits: 32,
                                outCounterBits: 32,
                                highSpeed: 0,
                                inErrors: 0,
                                outErrors: 0,
                                inDiscards: 0,
                                outDiscards: 0,
                                alias: '',
                                neighbor: null,
                                partialMissing: false
                            };
                        }
                    }
                }, { maxRows: SNMP_MAX_WALK_ROWS }).then(async () => {
                    if (snmpScanCancelled) {
                        if (activeSnmpSession) {
                            closeSession(activeSnmpSession);
                            activeSnmpSession = null;
                        }
                        resolve({ success: false, error: '扫描被用户取消', cancelled: true });
                        return;
                    }

                    const indexes = Object.keys(interfaces).map(k => parseInt(k, 10));
                    if (indexes.length === 0) {
                        closeSession(activeSnmpSession);
                        activeSnmpSession = null;
                        resolve({ success: true, deviceInfo: { name: deviceName, uptime: deviceUptime, descr: deviceDescr }, interfaces: [] });
                        return;
                    }

                    sendProgress('ifAttrs', 60, '正在读取接口详细属性 (MTU/状态/流量/错丢包)...');
                    await readInterfaceAttributes(activeSnmpSession, interfaces, indexes, params.version || '2c');

                    if (snmpScanCancelled) {
                        closeSession(activeSnmpSession);
                        activeSnmpSession = null;
                        resolve({ success: false, error: '扫描被用户取消', cancelled: true });
                        return;
                    }

                    closeSession(activeSnmpSession);
                    activeSnmpSession = null;

                    let lldpNeighbors = {};
                    let cdpNeighbors = {};

                    if (mode === 'full') {
                        try {
                            activeSnmpNeighborSession = createSnmpSession(ip, params);
                        } catch (err) {
                            console.error('创建邻居发现 session 失败:', err);
                        }

                        if (activeSnmpNeighborSession) {
                            sendProgress('lldp', 80, '正在检索 LLDP 邻居设备...');
                            lldpNeighbors = await withSoftTimeout(
                                () => walkLldpTable(activeSnmpNeighborSession),
                                SNMP_NEIGHBOR_TIMEOUT,
                                {},
                                'LLDP neighbor scan timed out or failed'
                            );

                            if (!snmpScanCancelled) {
                                sendProgress('cdp', 95, '正在检索 CDP 邻居设备...');
                                cdpNeighbors = await withSoftTimeout(
                                    () => walkCdpTable(activeSnmpNeighborSession),
                                    SNMP_NEIGHBOR_TIMEOUT,
                                    {},
                                    'CDP neighbor scan timed out or failed'
                                );
                            }

                            closeSession(activeSnmpNeighborSession);
                            activeSnmpNeighborSession = null;
                        }
                    }

                    if (snmpScanCancelled) {
                        resolve({ success: false, error: '扫描被用户取消', cancelled: true });
                        return;
                    }

                    sendProgress('done', 100, '查询完成');

                    // 将邻居信息融合到接口列表
                    const resultList = Object.values(interfaces)
                        .map(item => {
                            const nInfo = lldpNeighbors[item.index] || cdpNeighbors[item.index] || null;
                            item.neighbor = (nInfo && nInfo.deviceName) ? nInfo : null;
                            return item;
                        })
                        .sort((a, b) => a.index - b.index);

                    resolve({
                        success: true,
                        deviceInfo: {
                            name: deviceName,
                            uptime: deviceUptime,
                            descr: deviceDescr
                        },
                        interfaces: resultList
                    });
                }).catch((error) => {
                    if (activeSnmpSession) {
                        closeSession(activeSnmpSession);
                        activeSnmpSession = null;
                    }
                    if (snmpScanCancelled) {
                        resolve({ success: false, error: '扫描被用户取消', cancelled: true });
                    } else {
                        resolve({ success: false, error: buildDetailedSnmpError('ifDescr', error) });
                    }
                });
            });
        });
    });

    // 8.5 停止 SNMP 接口扫描
    ipcMain.handle('recon:stopSnmpScan', async () => {
        snmpScanCancelled = true;
        if (activeSnmpSession) {
            closeSession(activeSnmpSession);
            activeSnmpSession = null;
        }
        if (activeSnmpNeighborSession) {
            closeSession(activeSnmpNeighborSession);
            activeSnmpNeighborSession = null;
        }
        return { success: true };
    });

    // 9. 获取单端口实时流量 (升级支持所有传入的 SNMP 参数，以包含 V3 凭据)
    ipcMain.handle('recon:getRealtimePortTraffic', async (event, params) => {
        const { ip, portIndex } = params;
        return new Promise((resolve) => {
            const session = createSnmpSession(ip, params, {
                timeout: 1500,
                retries: 0,
                backoff: 1.0
            });

            const version = params.version || '2c';
            const oids = version === '1'
                ? [
                    `1.3.6.1.2.1.2.2.1.10.${portIndex}`,
                    `1.3.6.1.2.1.2.2.1.16.${portIndex}`
                ]
                : [
                    `1.3.6.1.2.1.31.1.1.1.6.${portIndex}`,
                    `1.3.6.1.2.1.31.1.1.1.10.${portIndex}`,
                    `1.3.6.1.2.1.2.2.1.10.${portIndex}`,
                    `1.3.6.1.2.1.2.2.1.16.${portIndex}`
                ];

            session.get(oids, (error, varbinds) => {
                closeSession(session);
                if (error) {
                    resolve({ success: false, error: error.message });
                    return;
                }

                let inOctets = 0;
                let outOctets = 0;

                if (version !== '1') {
                    if (varbinds[0] && !snmp.isVarbindError(varbinds[0])) {
                        inOctets = snmpValueToNumber(varbinds[0].value);
                    } else if (varbinds[2] && !snmp.isVarbindError(varbinds[2])) {
                        inOctets = snmpValueToNumber(varbinds[2].value);
                    }

                    if (varbinds[1] && !snmp.isVarbindError(varbinds[1])) {
                        outOctets = snmpValueToNumber(varbinds[1].value);
                    } else if (varbinds[3] && !snmp.isVarbindError(varbinds[3])) {
                        outOctets = snmpValueToNumber(varbinds[3].value);
                    }
                } else {
                    if (varbinds[0] && !snmp.isVarbindError(varbinds[0])) {
                        inOctets = snmpValueToNumber(varbinds[0].value);
                    }
                    if (varbinds[1] && !snmp.isVarbindError(varbinds[1])) {
                        outOctets = snmpValueToNumber(varbinds[1].value);
                    }
                }

                resolve({
                    success: true,
                    timestamp: Date.now(),
                    inOctets,
                    outOctets
                });
            });
        });
    });
}

module.exports = { registerReconnaissanceHandlers };
