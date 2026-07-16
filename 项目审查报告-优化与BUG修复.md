# Net Tools 项目审查报告 — 优化提升与 BUG 修复

> 项目：Net Tools v1.1.5（Electron 网络工具箱）
> 审查日期：2026-07-15
> 审查范围：主进程 `main/**`（52 文件 / 13k 行）、渲染层 `scripts/modules/**`（63 文件 / 18k 行）、`index.html`、`preload.js`、依赖与工程化配置
> 审查方式：安全 / 连接与批量 / 网络工具 / 前端与架构 四个维度分头深入，发现均经源码定位与交叉核实

---

## 一、总体评价

**架构质量：中上。** 项目并非"巨型单文件"反模式——渲染层已拆成 63 个模块、主进程按 `config/app/menu/handlers/tools/connections` 分域，IPC 用统一的 `registerXxxHandlers(context)` 注册，结构清晰。安全基线（主窗口 `contextIsolation:true` + `nodeIntegration:false` + preload 白名单桥接、用户数据入 DOM 走 `escapeHtml`）总体正确。

**真正的短板集中在三处：**
1. **稳定性** — 多个网络 stream/socket/EventEmitter 缺少 `'error'` 监听，且全进程无 `uncaughtException` 兜底，正常操作即可触发主进程崩溃。
2. **安全** — 2 处真实命令注入 + 工具窗口结构性 RCE 风险链 + Electron 28（EOL）已知高危漏洞。
3. **工程化** — 无打包步骤、运行期直接依赖 `node_modules`、`files:["**/*"]` 全量打包。

---

## 二、🔴 高危问题（必须优先修复）

### 安全类

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| S1 | `main/tools/broadcast-detector.js:167`（另 57/74） | `checkVersion(customPath)` 的 `customPath` 经 `preload.js:340` 暴露给渲染进程，直接拼进 `exec("${targetPath}" --version)` 走 shell，传 `x" & calc & "` 即可 **RCE** | 改 `execFile(targetPath, ['--version'])` 不经 shell；校验路径存在且为 `.exe` |
| S2 | `main/tools/ping.js:19-25` | `host` 来自 `ping:start` IPC，拼进 `exec("ping -n 1 -w ${timeout} ${host}")`，`127.0.0.1 & calc` 触发 **命令注入** | 改 `execFile('ping', ['-n','1','-w',String(timeout),host])`；host 加正则白名单 `/^[a-zA-Z0-9._:-]+$/` |
| S3 | `main/utils/toolWindow.js:29-33` | **所有** 工具窗口（ping/traceroute/netcat/tshark/broadcast/ftp/tftp…）用 `nodeIntegration:true` + `contextIsolation:false`，且渲染攻击者可影响的远程数据（抓包内容、Banner、被扫目标 HTTP title、SNMP 设备名）。一旦渲染层用 `innerHTML` 拼接即"远程数据→XSS→Node RCE"。**本项目最危险的结构性风险** | 工具窗口统一降权为 `nodeIntegration:false` + `contextIsolation:true` + 专用 preload（主窗口配置可作模板）；渲染层禁用 `innerHTML` 改 `textContent` |
| S4 | `main/handlers/dialog.js:114-121` | `shell:openExternal` / `openPath` 未校验协议，渲染层被注入时可传 `file://`、自定义协议触发本地程序执行 | `new URL(url).protocol` 白名单仅放行 `http:`/`https:`/`mailto:` |

### 稳定性类（正常操作即触发主进程崩溃）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| C1 | `main/connections/ssh.js:187-208`、`119-144`；`main/batch/executor.js:279-332` | SSH shell 流 / exec 流 / 批量 shell 流 **均缺 `'error'` 监听**。ssh2 Channel 是 Stream，链路突断 emit `'error'` 无监听则 `throw` → **崩溃**；exec 流还会导致 `resolve` 不触发 → IPC 永久挂起 | 三处均补 `stream.on('error', ...)`，记录并走清理/`resolve({success:false})` |
| C2 | `main/tools/ftp-server-backend.js:485/514/457/406`、`314-322` | FTP 数据 socket 与 PASV server **无 `'error'` 监听**。客户端传输中途断开/RST 即 emit error → **崩溃**（最易被正常操作触发） | 每个 dataSocket / passiveServer 获取后立即 `on('error')` |
| C3 | `main/tools/speedtest.js:35-73`、`109` | 测速接口 `res`/`req` 无 error 监听，客户端频繁断连向已断 socket `write()` 触发 EPIPE → 崩溃；`app.listen` 无 error 回调，端口占用 EADDRINUSE 未处理 | 补 `res.on('error')`/`req.on('error')`/`res.on('close')` 停发；`server.on('error')` |
| C4 | `main/tools/reconnaissance.js:252-302`（910/1036/1123） | SNMP Session **从不注册 `on('error')`**，UDP 出错（EHOSTUNREACH）emit error → 崩溃 | `createSnmpSession` 返回前统一挂 `session.on('error')` |
| C5 | `main/tools/dhcp-server-backend.js:175-184` + `dhcp-server.js`（已核实只注册了 log/leases） | 后端运行期 `emit('error')`，上层 **未注册 `on('error')`** → 崩溃 | 上层补 `on('error')`，或后端改用 `'server-error'` 自定义事件名 |
| C6 | `main/tools/portscanner.js:78` | `concurrency` 直接来自渲染进程无校验：传 `0` → `i += 0` **主进程无限循环卡死**；`undefined` → `NaN` | `const cc = Math.max(1, Math.min(parseInt(concurrency,10)||20, 200));` |
| C7 | 全进程 | **无 `process.on('uncaughtException')` / `unhandledRejection` 兜底**（已核实为 0），任一漏网异常直接杀掉整个应用 | `main/index.js` 顶部注册全局兜底，记录日志而非崩溃（配合上面逐处补 error 监听） |

### 依赖安全

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| D1 | `package.json` `electron ^28.0.0`（实装 28.3.3） | Electron 28 已 **EOL 停止安全维护**；audit 报告 ASAR 完整性绕过、多处 Use-After-Free、Windows 注册表键注入、HTTP 头注入等多个高危 | 升级到当前受支持大版本 + 回归测试。**性价比最高的单项改进** |

---

## 三、🟠 中危问题（挂起 / 泄漏 / 逻辑错误）

### 连接与批量

| # | 位置 | 问题 |
|---|------|------|
| M1 | `main/connections/ftp.js:60-132` | FTP 控制连接无 `'close'` 监听、`sendCmd` 无超时 → 服务器登录后关连接时 `cmdQueue` 里 Promise **永不 settle**，`ftp:list`/`upload` 永久挂起，死 client 不清理 |
| M2 | `main/connections/ssh.js:96-108` | `ssh:connect` 成功后无掉线清理：被动断开时无监听删除 `activeConnections` 条目 → 陈旧条目累积（内存泄漏）+ 渲染进程收不到断线事件，重连逻辑无法触发 |
| M3 | `main/batch/executor.js:328-335` | 命令阶段异常 `reject` 后 `conn.end()` 被跳过 → SSH 连接泄漏（批量场景大量泄漏）。应 `try/finally` 包裹 |
| M4 | `main/batch/index.js:12,21-76` | 批量执行全局状态无重入保护 + 无 `try/finally`：重复点击互相踩踏 `shouldStop`/`paused`；中途异常则 `running` 永为 true，UI 卡"执行中" |
| M5 | `main/batch/index.js:85-91` | 备份文件名 `${result.name||host}_${ts}.txt` 未净化，含 `/`/`\`/`..`（IPv6 地址/带斜杠设备名）→ 路径穿越 / 覆盖 / 抛异常中断整批。且 `writeFileSync` 阻塞主进程 |
| M6 | `main/connections/ftp.js:203-216` | FTP 下载在控制连接 226 到达即 `resolve`，此时 `fileStream` 未 `finish` → **文件可能被截断**。应等 226 与 `finish` 都完成 |
| M7 | `main/connections/ftp.js:159-328` | 数据 socket 在 error/reject 路径未 `destroy` + 无超时 → socket/fd 泄漏 |

### 工具

| # | 位置 | 问题 |
|---|------|------|
| M8 | `main/tools/netcat.js:128-141` | 连接失败（ECONNREFUSED）事件序 error→close，close 里 `sock.connecting` 已 false → **Promise 永不 resolve，IPC 永久挂起**（按钮卡"连接中"）。用 `settled` 标志兜底 |
| M9 | `main/tools/tshark-analyzer.js:508` & `copilot.js:343` | `rejectUnauthorized:false` 禁用 TLS 校验同时携带 `Authorization: Bearer <apiKey>` → **MITM 可窃取 API Key** |
| M10 | `main/tools/copilot.js:483-517` | "读命令"仅凭 `checkIsWriteCommand` 关键字启发式判断即在真实 SSH/Telnet 会话 **自动执行无审批**，破坏性命令若误判为读即直接下发。应默认全审批或只读白名单 |
| M11 | `main/tools/copilot.js:940-978` | `isAborted`/`activeHttpRequest` 模块级单例，并发发起 chat 时旧诊断 graph 仍在跑 → 状态机交叉、误执行设备命令。应每会话独立 AbortController |
| M12 | `main/tools/copilot.js:261-278` | 人工审批 Promise 无超时，用户不批则整条诊断链永久阻塞、`maxSteps` 失效；窗口销毁分支未 `pendingApprovals.delete` → Map 泄漏 |
| M13 | `main/tools/tshark-analyzer.js:1082/1121`、`broadcast-detector.js:265` | `flushInterval` 只在 `close` 里 clear，`error` 分支未清理（spawn 失败只 emit error）→ 100ms 定时器永久空转 + 闭包无法释放 |
| M14 | `main/tools/tshark-analyzer.js:1166-1195` | `tshark:importFile` 子进程存局部变量未跟踪 → stop/关窗都杀不掉成僵尸进程，且无超时 → 卡住则 Promise 永挂 |
| M15 | `main/tools/traceroute.js:129-147` | 经典追踪无并发守卫，`tracerouteProcess` 直接覆盖旧引用 → 旧 tracert 成孤儿进程；spawn 无整体超时看门狗 |
| M16 | `main/tools/ftp-server-backend.js:355-371` | PORT 命令连接客户端提供的任意 IP 未校验等于 `remoteAddress` → **FTP Bounce / 内网 SSRF 扫描** |
| M17 | `main/tools/portscanner.js:16-21`、`tftp-server-backend.js:352-355` | `timeout=0` 时 `setTimeout(0)` 禁用超时，被过滤端口 socket 永不关闭 → `Promise.all` 挂死；TFTP WRQ 的 ACK0 不启超时 → fd/socket 永久驻留 |

### 安全与配置

| # | 位置 | 问题 |
|---|------|------|
| M18 | `main/handlers/password.js:89-92`（114/133/158） | safeStorage 不可用时启动密码 **明文落盘** `password.json` 并明文比较。应不可用时拒绝启用或改 scrypt/PBKDF2+salt 哈希 |
| M19 | `main/handlers/dialog.js:63-111` | `fs:readFile`/`writeFile` 接受任意路径无校验（经 preload 暴露），渲染进程可读写磁盘任意文件。当前主渲染层无 XSS 缓释了风险，但原语过宽 |
| M20 | `main/app.js:151` | `ipcMain.on('app:close-confirmed')` 注册在 `createMainWindow` 内部，`app.on('activate')` 再次建窗时 **重复注册** → listener 泄漏 + 多次 close。应上移到模块加载期注册一次 |
| M21 | `main/connections/ssh.js`（algorithms.js） | SSH 无 `hostVerifier`，不校验主机密钥指纹 → 中间人风险（运维工具常见权衡，建议至少提供 known_hosts 可选校验） |

---

## 四、🟡 低危 / 代码质量

- **服务器无重复启动守卫**：`tftp/ftp/dhcp-server-backend` 的 `start()` 重复调用覆盖旧实例 → 泄漏 + EADDRINUSE。
- **服务器 `on('error')` 运行期误停整个服务**：瞬时错误（ICMP 端口不可达）也触发 `stop()`，应区分启动期 reject / 运行期仅记录。
- **无并发连接上限**：`netcat`/`tftp`/`ftp` server 恶意客户端可耗尽句柄。
- **`[时间|time]` 正则误用字符类**：`ping.js:34`、`traceroute.js:228` 应为 `(?:时间|time)`，仅"碰巧"生效。
- **stdout buffer 无上限**：`traceroute`/`broadcast-detector`/`reconnaissance` 无换行大响应时无限增长。
- **临时文件不清理**：`tshark-analyzer.js:1066` 每次抓包生成 pcap 从不删除，磁盘持续增长。
- **`app` 退出未统一停服务器**：`index.js:143` 只停 speedtest，FTP/TFTP/DHCP 依赖各自窗口 `closed`，异常退出残留占用端口。
- **`config.js:53-60` 非原子写**：`writeFileSync` 覆盖，写入中途崩溃损坏 `settings.json`。应临时文件 + `rename`。
- **`menu.js:78-82` 死代码**：`buildFromTemplate` 后立即 `setApplicationMenu(null)`，整个 73 行模板未用。
- **`terminal-core.js:84`**：`setInterval(updateConnectionDurations,1000)` 无 clear 也未存 id，当前只调一次尚可，但与该文件其它"先清理再注册"的防护不一致，是泄漏隐患。
- **死代码**：`getMainWindow` 在多个工具解构后从未使用。
- **全局单例状态竞态**：`dns-lookup`/`reconnaissance`/`copilot`/`ping` 的"停止"会误停其它任务，应改任务 id/token。

---

## 五、🛠 工程化与架构改进（按性价比排序）

1. **升级 Electron + `npm audit fix`**（安全，必做）——express 依赖链（qs/body-parser/path-to-regexp）、xmldom/ajv 等传递依赖也一并处理；CI 加 `npm audit --audit-level=high` 门禁。
2. **引入打包步骤（esbuild/vite）**——现状 `index.html:11` 直接 `<link>` 引用 `node_modules`，且 `files:["**/*"]` 把整个 node_modules（含 devDependencies）打进 asar，产物臃肿、发布面过大。改为产出 vendor 产物 + 收紧 `files` 白名单。
3. **66 个手写有序 `<script>` 标签迁移为 ESM/打包入口**——现状模块靠全局变量 + 加载顺序隐式耦合（`renderer.js` 手动 `window.xxx=`），是"伪模块化"。改 ESM 可获得静态依赖分析、tree-shaking。
4. **消除 34 处内联 `onclick=` + 收紧 CSP**——改事件委托后可去掉 `script-src 'unsafe-inline'`。
5. **抽取重复代码**：`_callAiApi`(tshark) 与 `callLLM`(copilot) 的 SSE 流解析、`getRealPath` 路径穿越校验（tftp/ftp 重复）、分批并发骨架（portscanner/netcat）。抽取时顺带统一修复各自的 error 监听/校验缺陷。
6. **测试补齐**：现有 10 个 spec 覆盖协议/数据管道层（方向正确），但设备导入导出、批量执行、模板替换、渲染层 `escapeHtml`、`main/handlers`/`main/tools` 的 IPC 基本无覆盖。Electron 测试建议 `workers:1` 避免抢端口。
7. **仓库卫生**：根目录 `test_setup.exe`/`test_run.exe` 等实验产物虽已 `.gitignore`（未被跟踪，处理正确），建议物理移到 `scratch/` 或删除保持整洁。

---

## 六、建议修复顺序

**第一批（防崩溃 + 防 RCE，改动小见效快）**
- C1–C7 补全所有 stream/socket/EventEmitter 的 `'error'` 监听 + 全局 `uncaughtException` 兜底 + portscanner 并发校验
- S1、S2 `exec`→`execFile` + 输入白名单（根除命令注入）
- S4 `openExternal` 协议白名单（一行防线）
- D1 升级 Electron

**第二批（防挂起 / 防泄漏）**
- M1–M8、M12–M17 的 Promise 永挂、连接/socket/进程/定时器泄漏、并发守卫

**第三批（安全纵深 + 架构）**
- S3 工具窗口降权、M9 TLS 校验、M10/M11 copilot 审批与会话隔离、M16 FTP Bounce、M18 密码存储
- 工程化第 1–5 项

---

## 附：各维度确认为"实现正确"的部分（避免误改）

- 主窗口 / 启动窗 / 密码窗 `contextIsolation:true`+`nodeIntegration:false` 配置正确；`index.html` 无 `innerHTML`/`eval`/`new Function`。
- `crypto.js`、copilot/reconnaissance/tshark 的 API Key 均用 `safeStorage` 加密存储；**全项目无硬编码密钥/密码**。
- `backup.js` 用 `path.basename`、`tftp/ftp-server-backend` 用 `normalize`+`relative` 校验，路径遍历防护正确。
- ssh2 `conn.exec` 是发往远程服务器执行，**非本地命令注入**（排除误报）。
- 各工具 `spawn` 均数组传参，`captureFilter`/`displayFilter` 作独立 argv，**不构成 shell 注入**（排除误报）。
- 渲染层 `devices-render.js`/`terminal-tabs.js` 用户可控字段均经 `escapeHtml`；xterm 实例 `dispose` 生命周期正确。
- `serial.js`、`stream-write-queue.js`、`terminal-data-buffer.js` 的清理/背压逻辑是本项目正面范例。
