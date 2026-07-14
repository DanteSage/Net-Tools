# Net Tools

Net Tools 是一款面向网络运维与排障场景的 Windows 桌面工具箱，基于 Electron 构建。它将设备管理、远程终端、批量命令、配置备份和常用网络诊断能力集中到一个应用中。

## 主要功能

- SSH、Telnet 与串口终端
- 网络设备分组、模板和批量命令执行
- SFTP/FTP 文件管理与 FTP/TFTP/DHCP 服务
- Ping、端口扫描、路由跟踪、DNS 查询和局域网扫描
- 抓包、TShark 分析、广播检测与网络测速
- IPv4/IPv6 子网计算和资产探测
- 配置备份、差异对比、操作日志与 AI 辅助分析

## 环境要求

- Windows 10/11
- Node.js 18 或更高版本
- npm

部分抓包、DHCP 等底层网络功能可能需要管理员权限。TShark 分析功能需要本机安装 Wireshark/TShark。

## 本地运行

```powershell
npm install
npm start
```

开发模式：

```powershell
npm run dev
```

## 测试

```powershell
npm test
```

只运行应用冒烟测试：

```powershell
npm run test:smoke
```

## 构建

```powershell
npm run build
```

也可以按目标单独构建：

```powershell
npm run build:x64
npm run build:portable
```

构建结果输出到 `dist/`。

## 数据与安全

设备资料、应用设置、日志和 API 凭据保存在 Electron 的用户数据目录中，不应提交到仓库。请勿在 Issue、日志或截图中公开真实设备地址、用户名、密码、私钥、FOFA Key 或 AI API Key。

资产探测、端口扫描和抓包功能仅应用于你拥有或已获明确授权的网络环境。

## 许可证

本项目采用 [MIT License](LICENSE)。
