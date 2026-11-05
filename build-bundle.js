/**
 * AgentPulse 单体打包构建脚本
 * 将 public/ 下的所有静态资源以 Base64 方式内联嵌入到一个独立的 bundled-server.js 中，
 * 使 pkg 打包后无需携带外部文件即可独立运行。
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_FILE = path.join(__dirname, 'bundled-server.js');

// 读取并编码所有静态资源文件
const files = {};
function scanDir(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      scanDir(fullPath, relPath);
    } else {
      files['/' + relPath] = {
        content: fs.readFileSync(fullPath).toString('base64'),
        ext: path.extname(entry.name)
      };
    }
  }
}
scanDir(PUBLIC_DIR, '');

// 生成打包后的服务端代码
const bundledCode = `
/**
 * AgentPulse - Standalone Bundled Server (Auto-generated, do not edit)
 * All static assets are embedded inline. Zero external file dependencies.
 */

const http = require('http');
const url = require('url');
const { spawn, exec } = require('child_process');
const fs = require('fs');

const PORT = process.env.PORT || 4190;

// ─── 内嵌静态资源 (Base64) ───────────────────────────
const EMBEDDED_ASSETS = ${JSON.stringify(files, null, 2)};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

function serveEmbeddedAsset(pathname, res) {
  let key = pathname === '/' ? '/index.html' : pathname;
  const asset = EMBEDDED_ASSETS[key];
  if (!asset) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const buf = Buffer.from(asset.content, 'base64');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[asset.ext] || 'application/octet-stream' });
  res.end(buf);
}

// ─── 指标引擎 (从 server.js 合并) ───────────────────
class MetricsEngine {
  constructor() {
    this.agents = new Map();
    this.simulatorEnabled = true;
    this.sseClients = new Set();

    this.registerAgent({ id: 'agent-coder-01',      name: '架构代码工 (Coder)',       model: 'deepseek-v3',      role: 'Coder',      color: '#38bdf8' });
    this.registerAgent({ id: 'agent-researcher-02',  name: '深度研报检索 (Researcher)', model: 'gemini-1.5-pro',   role: 'Researcher', color: '#a855f7' });
    this.registerAgent({ id: 'agent-planner-03',     name: '执行决策编排 (Planner)',    model: 'claude-3-5-sonnet', role: 'Planner',    color: '#34d399' });
    this.registerAgent({ id: 'agent-reviewer-04',    name: '合规与质检员 (Reviewer)',   model: 'gpt-4o',            role: 'Reviewer',   color: '#f59e0b' });

    setInterval(() => this.tick(), 1000);
    setInterval(() => this.simulateTraffic(), 1000);
  }

  registerAgent(meta) {
    if (!meta.id) return null;
    if (!this.agents.has(meta.id)) {
      this.agents.set(meta.id, {
        id: meta.id,
        name: meta.name || meta.id,
        model: meta.model || 'gpt-4o',
        role: meta.role || 'Assistant',
        color: meta.color || this.randomColor(),
        promptTokens: 0, completionTokens: 0, requests: 0, errors: 0,
        totalDurationSec: 0, avgTtft: 110, currentTps: 0,
        recentTokensThisSecond: 0,
        status: 'idle',
        lastActiveTime: Date.now()
      });
    }
    return this.agents.get(meta.id);
  }

  randomColor() {
    const colors = ['#ec4899','#06b6d4','#f43f5e','#818cf8','#10b981','#f59e0b'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  reportMetric(data) {
    let agent = this.agents.get(data.agentId);
    if (!agent) agent = this.registerAgent({ id: data.agentId, name: data.agentId });
    const pTokens = Number(data.promptTokens) || 0;
    const cTokens = Number(data.completionTokens) || 0;
    const duration = Number(data.durationSec) || 1;
    const ttft = Number(data.ttftMs) || 120;
    const isError = data.status === 'error';
    agent.promptTokens += pTokens;
    agent.completionTokens += cTokens;
    agent.requests += 1;
    if (isError) agent.errors += 1;
    agent.avgTtft = Math.round(agent.avgTtft * 0.7 + ttft * 0.3);
    agent.totalDurationSec += duration;
    agent.lastActiveTime = Date.now();
    agent.recentTokensThisSecond += cTokens;
  }

  tick() {
    const now = Date.now();
    let totalTps = 0, peakTps = 0, globalPrompt = 0, globalCompletion = 0;
    let globalRequests = 0, globalErrors = 0, streamingAgentsCount = 0;
    let ttftSum = 0, validAgents = 0;
    const agentList = [];

    this.agents.forEach((agent) => {
      const rawTps = agent.recentTokensThisSecond;
      agent.currentTps = Number((agent.currentTps * 0.35 + rawTps * 0.65).toFixed(1));
      agent.recentTokensThisSecond = 0;
      if (agent.currentTps > 0.8) { agent.status = 'streaming'; streamingAgentsCount++; }
      else { agent.status = (now - agent.lastActiveTime > 12000) ? 'offline' : 'idle'; }

      totalTps += agent.currentTps;
      if (agent.currentTps > peakTps) peakTps = agent.currentTps;
      globalPrompt += agent.promptTokens;
      globalCompletion += agent.completionTokens;
      globalRequests += agent.requests;
      globalErrors += agent.errors;
      ttftSum += agent.avgTtft;
      validAgents++;

      agentList.push({
        id: agent.id, name: agent.name, model: agent.model, role: agent.role,
        color: agent.color, promptTokens: agent.promptTokens, completionTokens: agent.completionTokens,
        requests: agent.requests, errors: agent.errors, avgTtft: agent.avgTtft,
        currentTps: agent.currentTps, status: agent.status
      });
    });

    const payload = {
      timestamp: now,
      simulatorRunning: this.simulatorEnabled,
      global: {
        totalTps: Number(totalTps.toFixed(1)), peakTps: Number(peakTps.toFixed(1)),
        totalTokens: globalPrompt + globalCompletion, promptTokens: globalPrompt,
        completionTokens: globalCompletion, totalRequests: globalRequests,
        totalErrors: globalErrors, totalAgents: this.agents.size,
        activeAgents: this.agents.size, streamingAgents: streamingAgentsCount,
        avgTtft: validAgents > 0 ? Math.round(ttftSum / validAgents) : 0
      },
      agents: agentList
    };

    const sseData = 'data: ' + JSON.stringify(payload) + '\\n\\n';
    this.sseClients.forEach((client) => {
      try { client.write(sseData); } catch (e) { this.sseClients.delete(client); }
    });
  }

  simulateTraffic() {
    if (!this.simulatorEnabled) return;
    this.agents.forEach((agent) => {
      const roll = Math.random();
      if (roll > 0.25) {
        let baseSpeed = 45;
        if (agent.role === 'Coder') baseSpeed = 75;
        if (agent.role === 'Researcher') baseSpeed = 50;
        if (agent.role === 'Planner') baseSpeed = 38;
        if (agent.role === 'Reviewer') baseSpeed = 60;
        const variation = (Math.sin(Date.now() / 4000) * 15) + (Math.random() * 20 - 10);
        const thisSecTokens = Math.max(5, Math.round(baseSpeed + variation));
        agent.completionTokens += thisSecTokens;
        agent.promptTokens += Math.floor(Math.random() * 8) + 2;
        agent.recentTokensThisSecond += thisSecTokens;
        agent.lastActiveTime = Date.now();
        if (Math.random() > 0.7) {
          agent.requests += 1;
          agent.avgTtft = Math.round(80 + Math.random() * 60);
        }
      }
    });
  }

  reset() {
    this.agents.forEach((ag) => {
      ag.promptTokens = 0; ag.completionTokens = 0;
      ag.requests = 0; ag.errors = 0;
      ag.currentTps = 0; ag.recentTokensThisSecond = 0;
    });
  }

  removeAgent(id) { return this.agents.delete(id); }
}

const engine = new MetricsEngine();

// ─── HTTP 服务路由 ──────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' });
    res.write('\\n');
    engine.sseClients.add(res);
    req.on('close', () => { engine.sseClients.delete(res); });
    return;
  }

  if (pathname === '/api/metrics/report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { engine.reportMetric(JSON.parse(body)); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); }
      catch(e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false})); }
    });
    return;
  }

  if (pathname === '/api/agents/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { const d = JSON.parse(body); engine.registerAgent(d); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); }
      catch(e) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:false})); }
    });
    return;
  }

  if (pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/agents/', '');
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({success: engine.removeAgent(id)}));
    return;
  }

  if (pathname === '/api/simulator/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body || '{}');
        if (typeof d.enabled === 'boolean') engine.simulatorEnabled = d.enabled;
        else engine.simulatorEnabled = !engine.simulatorEnabled;
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true, enabled: engine.simulatorEnabled}));
      } catch(e) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:false})); }
    });
    return;
  }

  if (pathname === '/api/metrics/reset' && req.method === 'POST') {
    engine.reset();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({success:true}));
    return;
  }

  // 静态资源 (从内嵌资产服务)
  serveEmbeddedAsset(pathname, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('====================================================');
  console.log('  AgentPulse Monitor Server Running at http://127.0.0.1:' + PORT);
  console.log('====================================================');

  // 自动打开桌面窗口
  const EDGE_PATHS = [
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe'
  ];
  if (process.env.LOCALAPPDATA) {
    EDGE_PATHS.push(process.env.LOCALAPPDATA + '\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe');
  }

  let edgeExe = null;
  for (const p of EDGE_PATHS) {
    try { if (fs.existsSync(p)) { edgeExe = p; break; } } catch(e) {}
  }

  setTimeout(() => {
    const appUrl = 'http://127.0.0.1:' + PORT;
    if (edgeExe) {
      const appWindow = spawn(edgeExe, ['--app=' + appUrl, '--window-size=1380,880', '--window-position=120,60'], { detached: true, stdio: 'ignore' });
      appWindow.unref();
    } else {
      exec('start ' + appUrl);
    }
  }, 500);
});
`;

fs.writeFileSync(OUTPUT_FILE, bundledCode, 'utf-8');
console.log('[Build] bundled-server.js generated (' + (bundledCode.length / 1024).toFixed(1) + ' KB)');
console.log('[Build] Embedded assets:', Object.keys(files).join(', '));
