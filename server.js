/**
 * AgentPulse - 后端监控服务与流式数据聚合引擎
 * 采用原生 Node.js 实现，零外部依赖，极速开箱即用。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 4190;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 内存数据库与指标状态机
class MetricsEngine {
  constructor() {
    this.agents = new Map();
    this.simulatorEnabled = true;
    this.sseClients = new Set();

    // 默认内置初始化常见预设 Agent
    this.registerAgent({
      id: 'agent-coder-01',
      name: '架构代码工 (Coder)',
      model: 'deepseek-v3',
      role: 'Coder',
      color: '#38bdf8'
    });
    this.registerAgent({
      id: 'agent-researcher-02',
      name: '深度研报检索 (Researcher)',
      model: 'gemini-1.5-pro',
      role: 'Researcher',
      color: '#a855f7'
    });
    this.registerAgent({
      id: 'agent-planner-03',
      name: '执行决策编排 (Planner)',
      model: 'claude-3-5-sonnet',
      role: 'Planner',
      color: '#34d399'
    });
    this.registerAgent({
      id: 'agent-reviewer-04',
      name: '合规与质检员 (Reviewer)',
      model: 'gpt-4o',
      role: 'Reviewer',
      color: '#f59e0b'
    });

    // 启动 1s 聚合定时器
    setInterval(() => this.tick(), 1000);

    // 启动内置高仿真流量生成器
    setInterval(() => this.simulateTraffic(), 1000);
  }

  // 注册或动态发现 Agent
  registerAgent(meta) {
    if (!meta.id) return null;
    if (!this.agents.has(meta.id)) {
      this.agents.set(meta.id, {
        id: meta.id,
        name: meta.name || meta.id,
        model: meta.model || 'gpt-4o',
        role: meta.role || 'Assistant',
        color: meta.color || this.randomColor(),
        promptTokens: 0,
        completionTokens: 0,
        requests: 0,
        errors: 0,
        totalDurationSec: 0,
        avgTtft: 110,
        currentTps: 0,
        // 滑动窗口内收集的 Token
        recentTokensThisSecond: 0,
        status: 'idle', // 'idle' | 'streaming' | 'offline'
        lastActiveTime: Date.now()
      });
    }
    return this.agents.get(meta.id);
  }

  randomColor() {
    const colors = ['#ec4899', '#06b6d4', '#f43f5e', '#818cf8', '#10b981', '#f59e0b'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // 接收上报打点数据
  reportMetric(data) {
    let agent = this.agents.get(data.agentId);
    if (!agent) {
      agent = this.registerAgent({ id: data.agentId, name: data.agentId });
    }

    const pTokens = Number(data.promptTokens) || 0;
    const cTokens = Number(data.completionTokens) || 0;
    const duration = Number(data.durationSec) || 1;
    const ttft = Number(data.ttftMs) || 120;
    const isError = data.status === 'error';

    agent.promptTokens += pTokens;
    agent.completionTokens += cTokens;
    agent.requests += 1;
    if (isError) agent.errors += 1;

    // 平滑更新平均 TTFT
    agent.avgTtft = Math.round(agent.avgTtft * 0.7 + ttft * 0.3);
    agent.totalDurationSec += duration;
    agent.lastActiveTime = Date.now();

    // 瞬时 Token 吞吐累加
    agent.recentTokensThisSecond += cTokens;
  }

  // 每秒时钟滴答：计算本秒各 Agent TPS，并推送 SSE 事件
  tick() {
    const now = Date.now();
    let totalTps = 0;
    let peakTps = 0;
    let globalPrompt = 0;
    let globalCompletion = 0;
    let globalRequests = 0;
    let globalErrors = 0;
    let streamingAgentsCount = 0;
    let ttftSum = 0;
    let validAgents = 0;

    const agentList = [];

    this.agents.forEach((agent) => {
      // 计算本秒 TPS (支持指数平滑滑动，避免曲线剧烈断崖)
      const rawTps = agent.recentTokensThisSecond;
      agent.currentTps = Number((agent.currentTps * 0.35 + rawTps * 0.65).toFixed(1));
      agent.recentTokensThisSecond = 0; // 清空本秒计数

      if (agent.currentTps > 0.8) {
        agent.status = 'streaming';
        streamingAgentsCount++;
      } else {
        // 超过 10 秒无打点则标记为空闲
        agent.status = (now - agent.lastActiveTime > 12000) ? 'offline' : 'idle';
      }

      totalTps += agent.currentTps;
      if (agent.currentTps > peakTps) peakTps = agent.currentTps;

      globalPrompt += agent.promptTokens;
      globalCompletion += agent.completionTokens;
      globalRequests += agent.requests;
      globalErrors += agent.errors;
      ttftSum += agent.avgTtft;
      validAgents++;

      agentList.push({
        id: agent.id,
        name: agent.name,
        model: agent.model,
        role: agent.role,
        color: agent.color,
        promptTokens: agent.promptTokens,
        completionTokens: agent.completionTokens,
        requests: agent.requests,
        errors: agent.errors,
        avgTtft: agent.avgTtft,
        currentTps: agent.currentTps,
        status: agent.status
      });
    });

    const payload = {
      timestamp: now,
      simulatorRunning: this.simulatorEnabled,
      global: {
        totalTps: Number(totalTps.toFixed(1)),
        peakTps: Number(peakTps.toFixed(1)),
        totalTokens: globalPrompt + globalCompletion,
        promptTokens: globalPrompt,
        completionTokens: globalCompletion,
        totalRequests: globalRequests,
        totalErrors: globalErrors,
        totalAgents: this.agents.size,
        activeAgents: this.agents.size,
        streamingAgents: streamingAgentsCount,
        avgTtft: validAgents > 0 ? Math.round(ttftSum / validAgents) : 0
      },
      agents: agentList
    };

    // 广播给所有活跃的 SSE 客户端
    const sseData = `data: ${JSON.stringify(payload)}\n\n`;
    this.sseClients.forEach((client) => {
      try {
        client.write(sseData);
      } catch (e) {
        this.sseClients.delete(client);
      }
    });
  }

  // 内置高真实度流量模拟生成逻辑
  simulateTraffic() {
    if (!this.simulatorEnabled) return;

    // 遍历每一个 Agent，模拟其在不同状态下的执行节奏
    this.agents.forEach((agent) => {
      // 80% 几率产生动作，产生不同波型的速度
      const roll = Math.random();
      if (roll > 0.25) {
        let baseSpeed = 45;
        if (agent.role === 'Coder') baseSpeed = 75; // 代码生成速度高
        if (agent.role === 'Researcher') baseSpeed = 50;
        if (agent.role === 'Planner') baseSpeed = 38;
        if (agent.role === 'Reviewer') baseSpeed = 60;

        // 引入正弦周期与随机扰动
        const variation = (Math.sin(Date.now() / 4000) * 15) + (Math.random() * 20 - 10);
        const thisSecTokens = Math.max(5, Math.round(baseSpeed + variation));

        agent.completionTokens += thisSecTokens;
        agent.promptTokens += Math.floor(Math.random() * 8) + 2;
        agent.recentTokensThisSecond += thisSecTokens;
        agent.lastActiveTime = Date.now();

        // 每隔一定 Token 算作一次完整请求结束
        if (Math.random() > 0.7) {
          agent.requests += 1;
          agent.avgTtft = Math.round(80 + Math.random() * 60);
        }
      }
    });
  }

  reset() {
    this.agents.forEach((ag) => {
      ag.promptTokens = 0;
      ag.completionTokens = 0;
      ag.requests = 0;
      ag.errors = 0;
      ag.currentTps = 0;
      ag.recentTokensThisSecond = 0;
    });
  }

  removeAgent(id) {
    return this.agents.delete(id);
  }
}

const engine = new MetricsEngine();

// 创建 HTTP 调度服务
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 跨域支持 (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. SSE 实时长连接端点
  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    engine.sseClients.add(res);

    req.on('close', () => {
      engine.sseClients.delete(res);
    });
    return;
  }

  // 2. 指标上报 API
  if (pathname === '/api/metrics/report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        engine.reportMetric(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Metric recorded' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 3. 动态注册 Agent
  if (pathname === '/api/agents/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const registered = engine.registerAgent(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, agent: registered }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
      }
    });
    return;
  }

  // 4. 移除 Agent
  if (pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/agents/', '');
    const ok = engine.removeAgent(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: ok }));
    return;
  }

  // 5. 模拟器开关
  if (pathname === '/api/simulator/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (typeof data.enabled === 'boolean') {
          engine.simulatorEnabled = data.enabled;
        } else {
          engine.simulatorEnabled = !engine.simulatorEnabled;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, enabled: engine.simulatorEnabled }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 6. 重置统计
  if (pathname === '/api/metrics/reset' && req.method === 'POST') {
    engine.reset();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 7. 静态资源托管 (public)
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`====================================================`);
  console.log(`⚡ AgentPulse Monitor Server Running at http://127.0.0.1:${PORT}`);
  console.log(`- Web Dashboard:    http://127.0.0.1:${PORT}`);
  console.log(`- Metrics Ingest:   POST http://127.0.0.1:${PORT}/api/metrics/report`);
  console.log(`- Realtime Stream:  GET  http://127.0.0.1:${PORT}/api/stream`);
  console.log(`====================================================`);
});
