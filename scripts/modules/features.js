/**
 * 功能模块 - 网络工具
 * @module features
 * 
 * 注意：批量执行已拆分到 batch/ 目录
 */

// ==================== 网络工具 ====================

async function openSpeedTest() {
    try {
        await window.api.speedtest.open();
    } catch (error) {
        showToast('启动测速服务失败: ' + error.message, 'error');
    }
}

async function openPortScanner() {
    try {
        await window.api.portscanner.open();
    } catch (error) {
        showToast('启动端口扫描工具失败: ' + error.message, 'error');
    }
}

async function openPingTest() {
    try {
        await window.api.ping.open();
    } catch (error) {
        showToast('启动 Ping 测试工具失败: ' + error.message, 'error');
    }
}

async function openSubnetting() {
    try {
        await window.api.subnetting.open();
    } catch (error) {
        showToast('启动子网划分工具失败: ' + error.message, 'error');
    }
}

async function openIpv6Subnetting() {
    try {
        await window.api.ipv6Subnetting.open();
    } catch (error) {
        showToast('启动 IPv6 子网计算器失败: ' + error.message, 'error');
    }
}

async function openTraceroute() {
    try {
        await window.api.traceroute.open();
    } catch (error) {
        showToast('启动路由追踪工具失败: ' + error.message, 'error');
    }
}

async function openPacketCapture() {
    try {
        const result = await window.api.packetCapture.open();
        if (!result.success) {
            showToast('启动抓包工具失败: ' + result.error, 'error');
        } else {
            showToast('正在以管理员权限启动抓包工具...', 'info');
        }
    } catch (error) {
        showToast('启动抓包工具失败: ' + error.message, 'error');
    }
}

async function openNetcat() {
    try {
        await window.api.netcat.open();
    } catch (error) {
        showToast('启动 TCP 工具失败: ' + error.message, 'error');
    }
}

async function openDnsLookup() {
    try {
        await window.api.dns.open();
    } catch (error) {
        showToast('启动 DNS 查询工具失败: ' + error.message, 'error');
    }
}

async function openTsharkAnalyzer() {
    try {
        const result = await window.api.tsharkAnalyzer.open();
        if (result && !result.success) {
            showToast('启动失败: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('启动 TsharkAnalyzer 失败: ' + error.message, 'error');
    }
}

async function openBroadcastDetector() {
    try {
        const result = await window.api.broadcastDetector.open();
        if (result && !result.success) {
            showToast('启动失败: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('启动广播与环路检测失败: ' + error.message, 'error');
    }
}

async function openFtpClient() {
    try {
        await window.api.ftp.open();
    } catch (error) {
        showToast('启动 FTP 客户端失败: ' + error.message, 'error');
    }
}

async function openFtpServer() {
    try {
        await window.api.ftpServer.open();
    } catch (error) {
        showToast('启动 FTP 服务端失败: ' + error.message, 'error');
    }
}

async function openDhcpServer() {
    try {
        await window.api.dhcpServer.open();
    } catch (error) {
        showToast('启动 DHCP 服务端失败: ' + error.message, 'error');
    }
}

async function openTftpServer() {
    try {
        await window.api.tftpServer.open();
    } catch (error) {
        showToast('启动 TFTP 服务端失败: ' + error.message, 'error');
    }
}


