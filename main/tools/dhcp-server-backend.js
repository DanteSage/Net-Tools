const os = require('os');
const EventEmitter = require('events');
const dhcp = require('dhcp');

/**
 * 获取系统中第一个活动的非内网/非回环 IPv4 地址
 */
function getFirstActiveIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const netInfo of interfaces[name]) {
            if (netInfo.family === 'IPv4' && !netInfo.internal) {
                return netInfo.address;
            }
        }
    }
    return '127.0.0.1';
}

class DhcpServerBackend extends EventEmitter {
    constructor(options) {
        super();
        this.interfaceIp = options.interfaceIp;              // 必须由用户明确选择网卡 IP
        this.startIp = options.startIp;                     // 起始分配 IP
        this.endIp = options.endIp;                         // 结束分配 IP
        this.subnetMask = options.subnetMask || '255.255.255.0';
        this.gateway = options.gateway;                     // 默认网关
        this.dnsList = options.dnsList || ['8.8.8.8'];      // DNS 列表
        this.leaseTime = parseInt(options.leaseTime || 86400, 10); // 租期秒数

        this.serverInstance = null;
    }

    /**
     * 根据 IP 和子网掩码计算局域网广播地址
     */
    getBroadcastAddress(ip, netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        const broadcastParts = [];
        for (let i = 0; i < 4; i++) {
            broadcastParts.push(ipParts[i] | (~maskParts[i] & 255));
        }
        return broadcastParts.join('.');
    }

    /**
     * 输出日志，供 IPC 层转发给前端 UI 控制台
     */
    log(message, type = 'info') {
        this.emit('log', { message, type });
    }

    /**
     * 启动 DHCP 服务器
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                // 计算绑定 IP 和对应的广播地址
                const serverIp = (this.interfaceIp && this.interfaceIp !== '0.0.0.0') ? this.interfaceIp : getFirstActiveIp();
                const broadcastIp = this.getBroadcastAddress(serverIp, this.subnetMask);

                // 组装 node-dhcp 初始化配置
                const dhcpOpts = {
                    range: [this.startIp, this.endIp],
                    netmask: this.subnetMask,
                    dns: this.dnsList,
                    leaseTime: this.leaseTime,
                    server: serverIp,
                    broadcast: broadcastIp
                };

                if (this.gateway) {
                    dhcpOpts.router = [this.gateway];
                }

                this.serverInstance = dhcp.createServer(dhcpOpts);

                const self = this;

                // 拦截 sendOffer，记录 OFFER 阶段分配日志
                const originalSendOffer = this.serverInstance.sendOffer;
                this.serverInstance.sendOffer = function(req) {
                    const mac = req.chaddr.replace(/-/g, ':').toUpperCase();
                    const offeredIp = this._selectAddress(req.chaddr);
                    self.log(`[OFFER] 分配 IP: ${offeredIp} -> MAC: ${mac}`, 'info');
                    originalSendOffer.call(this, req);
                };

                // 拦截 sendAck，记录 ACK 阶段确认日志
                const originalSendAck = this.serverInstance.sendAck;
                this.serverInstance.sendAck = function(req) {
                    const mac = req.chaddr.replace(/-/g, ':').toUpperCase();
                    const assignedIp = this._selectAddress(req.chaddr);
                    const leaseTime = this.config('leaseTime');
                    self.log(`[ACK] 确认分配 IP: ${assignedIp} -> MAC: ${mac}，租期: ${Math.floor(leaseTime / 3600)} 小时`, 'success');
                    originalSendAck.call(this, req);
                };

                // 拦截 sendNak，记录 NAK 拒绝日志
                const originalSendNak = this.serverInstance.sendNak;
                this.serverInstance.sendNak = function(req) {
                    const mac = req.chaddr.replace(/-/g, ':').toUpperCase();
                    self.log(`[NAK] 来自 MAC: ${mac} 的请求 IP 无效，回应 NAK`, 'error');
                    originalSendNak.call(this, req);
                };

                // 监听报文到达事件，记录 DISCOVER, REQUEST 和 RELEASE 日志
                this.serverInstance.on('message', (req) => {
                    const mac = req.chaddr.replace(/-/g, ':').toUpperCase();
                    const messageType = req.options[53];
                    const hostname = req.options[12] || '';

                    // 缓存客户端主机名到 state 状态表中
                    if (this.serverInstance._state) {
                        const lease = this.serverInstance._state[req.chaddr] || (this.serverInstance._state[req.chaddr] = {});
                        if (hostname) {
                            lease.hostname = hostname;
                        }
                    }

                    if (messageType === 1) { // DHCPDISCOVER
                        self.log(`[DISCOVER] 来自 MAC: ${mac} (${hostname || '未知主机'})`, 'cmd');
                    } else if (messageType === 3) { // DHCPREQUEST
                        const requestedIp = req.options[50] || '';
                        self.log(`[REQUEST] 来自 MAC: ${mac}，请求 IP: ${requestedIp || '未指定'}`, 'cmd');
                    } else if (messageType === 7) { // DHCPRELEASE
                        self.log(`[RELEASE] 客户端主动释放 IP: MAC: ${mac}`, 'info');
                        if (this.serverInstance._state && this.serverInstance._state[req.chaddr]) {
                            delete this.serverInstance._state[req.chaddr];
                            this.serverInstance.emit('bound', this.serverInstance._state);
                        }
                    }
                });

                // 监听绑定分配事件，重新组装租约列表更新前端 UI
                this.serverInstance.on('bound', (state) => {
                    const activeLeases = [];
                    const now = Date.now();
                    for (const rawMac in state) {
                        const lease = state[rawMac];
                        if (lease && lease.address) {
                            const mac = rawMac.replace(/-/g, ':').toUpperCase();
                            const bindTime = lease.bindTime ? lease.bindTime.getTime() : now;
                            const leasePeriod = lease.leasePeriod || 86400;
                            const expiresAt = bindTime + leasePeriod * 1000;

                            // 仅收集 BOUND 状态且未过期的活跃租约
                            if (lease.state === 'BOUND' && expiresAt > now) {
                                activeLeases.push({
                                    mac,
                                    ip: lease.address,
                                    hostname: lease.hostname || '未知设备',
                                    expiresAt: new Date(expiresAt).toLocaleTimeString(),
                                    expiresTimestamp: expiresAt
                                });
                            }
                        }
                    }
                    self.emit('leases', activeLeases);
                });

                let initialized = false;

                // 监听 listening 事件
                this.serverInstance.once('listening', () => {
                    initialized = true;
                    self.log(`DHCP 服务端已成功启动，正在侦听 UDP 0.0.0.0:67 (绑定网卡 IP: ${self.interfaceIp})`, 'success');
                    self.log(`分配池范围: ${self.startIp} ~ ${self.endIp}，掩码: ${self.subnetMask}，网关: ${self.gateway || '未配置'}`, 'info');
                    resolve();
                });

                // 异常处理（如特权端口无法绑定、已被占用等）
                const errorHandler = (err) => {
                    if (!initialized) {
                        reject(err);
                    }
                    self.log(`DHCP 服务端 Socket 错误: ${err.message}`, 'error');
                    self.emit('error', err);
                    self.stop().catch(() => {});
                };

                this.serverInstance.on('error', errorHandler);

                // 必须在 0.0.0.0 端口 67 绑定，以便接收全局广播
                this.serverInstance.listen(67, '0.0.0.0');
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 关闭 DHCP 服务端
     */
    stop() {
        return new Promise((resolve) => {
            if (this.serverInstance) {
                try {
                    this.serverInstance.close(() => {
                        this.log('DHCP 服务端已完全关闭', 'info');
                        this.serverInstance = null;
                        resolve();
                    });
                } catch (e) {
                    this.serverInstance = null;
                    resolve();
                }
            } else {
                resolve();
            }
        });
    }

    /**
     * 手动回收指定 MAC 地址的 IP 租约
     */
    revokeLease(mac) {
        if (!this.serverInstance || !this.serverInstance._state) return;

        // node-dhcp 使用连字符分隔 MAC 地址，如 "00-11-22-33-44-55"
        const rawMac = mac.replace(/:/g, '-').toUpperCase();

        if (this.serverInstance._state[rawMac]) {
            const ip = this.serverInstance._state[rawMac].address;
            delete this.serverInstance._state[rawMac];
            this.log(`[REVOKE] 管理员手动回收租约: MAC: ${mac} (原分配 IP: ${ip || '无'})`, 'info');
            // 触发 bound 事件以刷新前端 UI 租约列表
            this.serverInstance.emit('bound', this.serverInstance._state);
        }
    }
}

module.exports = DhcpServerBackend;
