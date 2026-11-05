/**
 * AgentPulse 独立桌面应用启动引导脚本
 * 启动后端监控服务并拉起原生桌面应用窗口 (Edge App 模式 / 独立应用视窗)
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4190;
const URL = `http://127.0.0.1:${PORT}`;

console.log('[AgentPulse] 正在启动后端监控引擎...');

// 启动服务端子进程
const serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
  stdio: 'inherit',
  shell: true
});

// 检查 Edge 浏览器常见安装路径
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe'
];

let edgeExe = null;
for (const p of EDGE_PATHS) {
  if (p && fs.existsSync(p)) {
    edgeExe = p;
    break;
  }
}

// 延迟 800ms 等待后端服务就绪后打开桌面窗口
setTimeout(() => {
  if (edgeExe) {
    console.log(`[AgentPulse] 正在通过独立桌面窗口模式拉起应用: ${edgeExe}`);
    // --app 参数让 Edge 以纯独立桌面应用程序窗口运行（无地址栏、无多标签）
    const appWindow = spawn(edgeExe, [
      `--app=${URL}`,
      '--window-size=1380,880',
      '--window-position=120,60'
    ], { detached: true, stdio: 'ignore' });

    appWindow.unref();
  } else {
    console.log(`[AgentPulse] 打开系统默认浏览器视窗: ${URL}`);
    const startCmd = process.platform === 'win32' ? `start ${URL}` : `open ${URL}`;
    exec(startCmd);
  }
}, 800);

// 进程退出时妥善清理
process.on('SIGINT', () => {
  serverProcess.kill();
  process.exit();
});
