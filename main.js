/**
 * Net Tools - Electron 主进程入口
 * 
 * 重构后的模块化结构：
 * - main/config.js      - 配置管理
 * - main/app.js         - 窗口和生命周期
 * - main/menu.js        - 菜单配置
 * - main/connections/   - 连接管理（SSH/Telnet/串口）
 * - main/batch/         - 批量执行
 * - main/handlers/      - IPC 处理程序
 * - main/tools/         - 网络工具
 * - main/utils/         - 工具函数
 */

const { registerProcessErrorHandlers } = require('./main/utils/process-error-handler');
registerProcessErrorHandlers();

// 加载模块化入口
require('./main/index');
