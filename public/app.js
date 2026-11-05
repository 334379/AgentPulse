// AgentPulse 前端主控逻辑与高性能 Canvas 可视化引擎

// 全局状态管理
const state = {
  agents: {},           // agentId -> { id, name, model, role, color, promptTokens, completionTokens, requests, errors, avgTtft, currentTps, status, history: [] }
  globalHistory: [],    // [{ timestamp, totalTps, agentTpsMap: {} }]
  hiddenAgentsInChart: new Set(),
  simulatorRunning: true,
  connected: false,
  maxHistoryPoints: 60, // 保留 60 秒时间窗口
  eventSource: null
};

// 预定义的高级调色盘
const COLOR_PALETTE = [
  "#38bdf8", // Sky Blue
  "#a855f7", // Purple
  "#34d399", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f43f5e", // Rose
  "#818cf8"  // Indigo
];

function getAgentColor(index) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

// 角色图标映射
const ROLE_ICONS = {
  Coder: "💻",
  Researcher: "🔎",
  Planner: "📋",
  Reviewer: "🛡️",
  Chatbot: "💬",
  Default: "🤖"
};

// 初始化图表 Canvas 上下文与尺寸响应式
let rtCanvas, rtCtx;
let gaugeCanvas, gaugeCtx;

function initCanvases() {
  rtCanvas = document.getElementById("realtimeChart");
  rtCtx = rtCanvas.getContext("2d");

  gaugeCanvas = document.getElementById("gaugeCanvas");
  gaugeCtx = gaugeCanvas.getContext("2d");

  function resize() {
    const rect = rtCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    rtCanvas.width = rect.width * dpr;
    rtCanvas.height = rect.height * dpr;
    rtCtx.scale(dpr, dpr);

    const gRect = gaugeCanvas.parentElement.getBoundingClientRect();
    gaugeCanvas.width = 240 * dpr;
    gaugeCanvas.height = 140 * dpr;
    gaugeCtx.scale(dpr, dpr);

    drawRealtimeChart();
    drawGauge();
  }

  window.addEventListener("resize", resize);
  setTimeout(resize, 50);
}

// 建立 SSE 实时推送信道
function connectSSE() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const evtSource = new EventSource("/api/stream");
  state.eventSource = evtSource;

  evtSource.onopen = () => {
    state.connected = true;
    updateConnBadge(true);
  };

  evtSource.onerror = () => {
    state.connected = false;
    updateConnBadge(false);
  };

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerTick(data);
    } catch (e) {
      console.error("解析监控推送异常:", e);
    }
  };
}

function updateConnBadge(connected) {
  const dot = document.getElementById("connStatusDot");
  const txt = document.getElementById("connStatusText");
  if (connected) {
    dot.className = "status-dot";
    txt.textContent = "实时信道已同步";
  } else {
    dot.className = "status-dot disconnected";
    txt.textContent = "重连中...";
  }
}

// 接收服务端每秒聚合打点
function handleServerTick(payload) {
  // payload: { timestamp, simulatorRunning, global, agents }
  state.simulatorRunning = payload.simulatorRunning;
  updateSimButtonUI();

  // 更新各 Agent 数据
  const serverAgents = payload.agents || [];
  let colorIdx = 0;

  serverAgents.forEach(srvAgent => {
    if (!state.agents[srvAgent.id]) {
      // 首次发现新 Agent，动态注入
      state.agents[srvAgent.id] = {
        ...srvAgent,
        color: srvAgent.color || getAgentColor(colorIdx++),
        history: new Array(state.maxHistoryPoints).fill(0)
      };
    } else {
      // 更新现有 Agent
      const existing = state.agents[srvAgent.id];
      Object.assign(existing, srvAgent);
      if (!existing.history) existing.history = [];
    }

    // 记录历史序列
    const ag = state.agents[srvAgent.id];
    ag.history.push(srvAgent.currentTps || 0);
    if (ag.history.length > state.maxHistoryPoints) {
      ag.history.shift();
    }
  });

  // 处理已下线的 Agent
  const currentIds = new Set(serverAgents.map(a => a.id));
  Object.keys(state.agents).forEach(id => {
    if (!currentIds.has(id)) {
      state.agents[id].status = "offline";
      state.agents[id].currentTps = 0;
      state.agents[id].history.push(0);
      if (state.agents[id].history.length > state.maxHistoryPoints) {
        state.agents[id].history.shift();
      }
    }
  });

  // 更新全局历史点
  state.globalHistory.push({
    timestamp: payload.timestamp,
    totalTps: payload.global.totalTps
  });
  if (state.globalHistory.length > state.maxHistoryPoints) {
    state.globalHistory.shift();
  }

  // 刷新全界面
  updateKpiCards(payload.global);
  drawRealtimeChart();
  drawGauge(payload.global.peakTps || 0);
  renderRankingList();
  renderAgentCards();
  renderChartLegends();
}

// 刷新顶部 KPI 概览卡片
function updateKpiCards(global) {
  document.getElementById("kpiGlobalTps").textContent = (global.totalTps || 0).toFixed(1);
  document.getElementById("kpiTotalTokens").textContent = formatNumber(global.totalTokens || 0);
  document.getElementById("kpiPromptTokens").textContent = formatNumber(global.promptTokens || 0);
  document.getElementById("kpiCompTokens").textContent = formatNumber(global.completionTokens || 0);
  document.getElementById("kpiTotalRequests").textContent = formatNumber(global.totalRequests || 0);
  document.getElementById("kpiErrors").textContent = global.totalErrors || 0;
  
  const successRate = global.totalRequests > 0 
    ? (((global.totalRequests - global.totalErrors) / global.totalRequests) * 100).toFixed(1) + "%" 
    : "100%";
  document.getElementById("kpiSuccessRate").textContent = successRate;

  document.getElementById("kpiActiveAgents").textContent = global.activeAgents || 0;
  document.getElementById("kpiTotalAgents").textContent = global.totalAgents || 0;
  document.getElementById("kpiStreamingAgents").textContent = global.streamingAgents || 0;
  document.getElementById("kpiIdleAgents").textContent = (global.totalAgents - global.streamingAgents) || 0;

  document.getElementById("kpiAvgTtft").textContent = Math.round(global.avgTtft || 0);
}

// 绘制实时贝塞尔多 Agent 输出速度对比曲线 (60FPS Canvas)
function drawRealtimeChart() {
  if (!rtCanvas || !rtCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = rtCanvas.width / dpr;
  const height = rtCanvas.height / dpr;

  rtCtx.clearRect(0, 0, width, height);

  const padding = { top: 20, right: 25, bottom: 30, left: 45 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // 计算当前视窗内所有激活 Agent 的最高 TPS，作为 Y 轴上限
  let maxTps = 20; // 兜底最低量程
  Object.values(state.agents).forEach(ag => {
    if (!state.hiddenAgentsInChart.has(ag.id) && ag.history) {
      ag.history.forEach(v => {
        if (v > maxTps) maxTps = v;
      });
    }
  });
  maxTps = Math.ceil(maxTps * 1.15); // 留出 15% 上方余量

  // 1. 绘制网格辅助线与标尺
  rtCtx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  rtCtx.lineWidth = 1;
  rtCtx.fillStyle = "#64748b";
  rtCtx.font = "10px -apple-system, sans-serif";
  rtCtx.textAlign = "right";

  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const yVal = Math.round((maxTps / ySteps) * i);
    const y = padding.top + graphHeight - (i / ySteps) * graphHeight;

    rtCtx.beginPath();
    rtCtx.moveTo(padding.left, y);
    rtCtx.lineTo(padding.left + graphWidth, y);
    rtCtx.stroke();

    rtCtx.fillText(yVal + " t/s", padding.left - 8, y + 3);
  }

  // X 轴时间刻度提示
  rtCtx.textAlign = "center";
  rtCtx.fillText("-60s", padding.left, height - 10);
  rtCtx.fillText("-30s", padding.left + graphWidth / 2, height - 10);
  rtCtx.fillText("现在 (0s)", padding.left + graphWidth, height - 10);

  // 2. 依次绘制各 Agent 的动态折线
  Object.values(state.agents).forEach(ag => {
    if (state.hiddenAgentsInChart.has(ag.id) || !ag.history || ag.history.length === 0) return;

    const data = ag.history;
    const stepX = graphWidth / (state.maxHistoryPoints - 1);

    rtCtx.beginPath();
    const points = [];
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + i * stepX;
      const y = padding.top + graphHeight - (data[i] / maxTps) * graphHeight;
      points.push({ x, y });
    }

    if (points.length < 2) return;

    // 绘制柔和曲线 (Catmull-Rom 或 Quadratic Bezier)
    rtCtx.beginPath();
    rtCtx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      rtCtx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    rtCtx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

    // 线条光晕
    rtCtx.strokeStyle = ag.color || "#38bdf8";
    rtCtx.lineWidth = 2.2;
    rtCtx.shadowColor = ag.color;
    rtCtx.shadowBlur = 8;
    rtCtx.stroke();
    rtCtx.shadowBlur = 0; // 重置阴影

    // 最新点绘制高亮光斑
    const lastP = points[points.length - 1];
    rtCtx.beginPath();
    rtCtx.arc(lastP.x, lastP.y, 4, 0, Math.PI * 2);
    rtCtx.fillStyle = "#ffffff";
    rtCtx.fill();
    rtCtx.strokeStyle = ag.color;
    rtCtx.lineWidth = 2;
    rtCtx.stroke();
  });
}

// 绘制半圆速度仪表盘
function drawGauge(peakVal = 0) {
  if (!gaugeCanvas || !gaugeCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = gaugeCanvas.width / dpr;
  const height = gaugeCanvas.height / dpr;

  gaugeCtx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height - 15;
  const radius = 80;

  // 背景环弧度 (从 PI 到 2*PI)
  gaugeCtx.beginPath();
  gaugeCtx.arc(cx, cy, radius, Math.PI, 2 * Math.PI, false);
  gaugeCtx.lineWidth = 14;
  gaugeCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  gaugeCtx.lineCap = "round";
  gaugeCtx.stroke();

  // 计算当前最高速度占量程比例 (0~160 TPS)
  const maxScale = 160;
  const ratio = Math.min(Math.max(peakVal / maxScale, 0), 1);
  const endAngle = Math.PI + ratio * Math.PI;

  if (ratio > 0.01) {
    // 发光渐变进度环
    const grad = gaugeCtx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, "#38bdf8");
    grad.addColorStop(0.5, "#818cf8");
    grad.addColorStop(1, "#f43f5e");

    gaugeCtx.beginPath();
    gaugeCtx.arc(cx, cy, radius, Math.PI, endAngle, false);
    gaugeCtx.lineWidth = 14;
    gaugeCtx.strokeStyle = grad;
    gaugeCtx.lineCap = "round";
    gaugeCtx.shadowColor = "#38bdf8";
    gaugeCtx.shadowBlur = 10;
    gaugeCtx.stroke();
    gaugeCtx.shadowBlur = 0;
  }

  // 指针绘制
  const needleAngle = Math.PI + ratio * Math.PI;
  const needleLen = radius - 8;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  gaugeCtx.beginPath();
  gaugeCtx.moveTo(cx, cy);
  gaugeCtx.lineTo(nx, ny);
  gaugeCtx.lineWidth = 3;
  gaugeCtx.strokeStyle = "#ffffff";
  gaugeCtx.shadowColor = "#000000";
  gaugeCtx.shadowBlur = 4;
  gaugeCtx.stroke();
  gaugeCtx.shadowBlur = 0;

  // 中心圆钮
  gaugeCtx.beginPath();
  gaugeCtx.arc(cx, cy, 6, 0, 2 * Math.PI);
  gaugeCtx.fillStyle = "#38bdf8";
  gaugeCtx.fill();

  document.getElementById("gaugeSpeed").textContent = peakVal.toFixed(1);
}

// 渲染消耗排行与配额进度条
function renderRankingList() {
  const container = document.getElementById("rankingListBox");
  const agents = Object.values(state.agents);

  // 计算总 Token
  const totalTokens = agents.reduce((acc, a) => acc + (a.promptTokens || 0) + (a.completionTokens || 0), 0) || 1;

  // 按消耗量排序
  agents.sort((a, b) => {
    const sumA = (a.promptTokens || 0) + (a.completionTokens || 0);
    const sumB = (b.promptTokens || 0) + (b.completionTokens || 0);
    return sumB - sumA;
  });

  let html = "";
  agents.forEach(ag => {
    const pTokens = ag.promptTokens || 0;
    const cTokens = ag.completionTokens || 0;
    const sum = pTokens + cTokens;
    const pPct = ((pTokens / totalTokens) * 100).toFixed(1);
    const cPct = ((cTokens / totalTokens) * 100).toFixed(1);

    html += `
      <div class="ranking-item">
        <div class="ranking-info">
          <div class="ranking-name">
            <span style="color: ${ag.color}">●</span>
            <span>${ag.name}</span>
            <span style="font-size: 10px; color: var(--text-dim);">(${ag.model})</span>
          </div>
          <div class="ranking-metrics">
            <strong>${formatNumber(sum)}</strong> tok 
            <span style="color: #38bdf8; font-size: 11px; margin-left: 6px;">${(ag.currentTps || 0).toFixed(1)} t/s</span>
          </div>
        </div>
        <div class="progress-bar-bg" title="Prompt: ${formatNumber(pTokens)} (${pPct}%) | Completion: ${formatNumber(cTokens)} (${cPct}%)">
          <div class="progress-bar-fill prompt" style="width: ${pPct}%"></div>
          <div class="progress-bar-fill completion" style="width: ${cPct}%"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// 渲染动态 Agent 矩阵卡片
function renderAgentCards() {
  const container = document.getElementById("agentGridBox");
  const sortBy = document.getElementById("sortSelect").value;
  const agents = Object.values(state.agents);

  agents.sort((a, b) => {
    if (sortBy === "tps") return (b.currentTps || 0) - (a.currentTps || 0);
    if (sortBy === "tokens") {
      return (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens);
    }
    if (sortBy === "requests") return (b.requests || 0) - (a.requests || 0);
    return a.name.localeCompare(b.name);
  });

  let html = "";
  agents.forEach(ag => {
    const isStreaming = ag.currentTps > 0.5;
    const statusClass = isStreaming ? "streaming" : (ag.status === "offline" ? "offline" : "idle");
    const statusText = isStreaming ? "⚡ 生成中" : (ag.status === "offline" ? "已离线" : "💤 空闲待命");
    const icon = ROLE_ICONS[ag.role] || ROLE_ICONS.Default;
    const totalTokens = (ag.promptTokens || 0) + (ag.completionTokens || 0);

    html += `
      <div class="agent-card" id="card-${ag.id}">
        <div class="agent-card-top">
          <div class="agent-meta">
            <div class="agent-avatar" style="border-color: ${ag.color}40;">${icon}</div>
            <div class="agent-name-box">
              <div class="agent-name">${ag.name}</div>
              <div class="agent-model">${ag.model} · ${ag.role || "Agent"}</div>
            </div>
          </div>
          <div class="agent-badge-status ${statusClass}">
            ${statusText}
          </div>
        </div>

        <div class="agent-speed-row">
          <div class="agent-tps-large">
            <div class="tps-label">实时速率 TPS</div>
            <div class="tps-num" style="color: ${ag.color}">
              ${(ag.currentTps || 0).toFixed(1)} <span style="font-size: 11px; font-weight: normal; color: var(--text-dim);">tok/s</span>
            </div>
          </div>
          <canvas class="sparkline-canvas" id="spark-${ag.id}" width="130" height="38"></canvas>
        </div>

        <div class="agent-stats-grid">
          <div class="stat-item">
            <span class="stat-item-lbl">总 Token 消耗</span>
            <span class="stat-item-val">${formatNumber(totalTokens)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-item-lbl">调用次数</span>
            <span class="stat-item-val">${formatNumber(ag.requests || 0)} 次</span>
          </div>
          <div class="stat-item">
            <span class="stat-item-lbl">Prompt / Comp</span>
            <span class="stat-item-val" style="font-size: 11px;">${formatNumber(ag.promptTokens || 0)} / ${formatNumber(ag.completionTokens || 0)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-item-lbl">首字平均延迟</span>
            <span class="stat-item-val">${Math.round(ag.avgTtft || 0)} ms</span>
          </div>
        </div>

        <div class="agent-card-footer">
          <span>ID: <code>${ag.id}</code></span>
          <div class="card-actions">
            <button class="btn-icon" onclick="triggerAgentBurst('${ag.id}')" title="注入模拟突发流量">⚡ 模拟调用</button>
            <button class="btn-icon delete" onclick="removeAgent('${ag.id}')" title="注销/移除该 Agent">✕ 移除</button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // 绘制各卡片的微型火花折线图 (Sparkline)
  agents.forEach(ag => {
    drawSparkline(`spark-${ag.id}`, ag.history || [], ag.color);
  });
}

// 绘制单 Agent 迷你火花图
function drawSparkline(canvasId, data, color) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;

  ctx.clearRect(0, 0, w, h);
  if (!data || data.length < 2) return;

  const max = Math.max(...data, 10);
  const stepX = w / (data.length - 1);

  ctx.beginPath();
  data.forEach((val, i) => {
    const x = i * stepX;
    const y = h - (val / max) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = color || "#38bdf8";
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// 渲染曲线图底部的 Agent 图例开关
function renderChartLegends() {
  const container = document.getElementById("chartLegendBox");
  const agents = Object.values(state.agents);

  let html = "";
  agents.forEach(ag => {
    const isDimmed = state.hiddenAgentsInChart.has(ag.id);
    html += `
      <div class="legend-item ${isDimmed ? 'dimmed' : ''}" onclick="toggleAgentChartVisibility('${ag.id}')">
        <div class="legend-dot" style="background: ${ag.color};"></div>
        <span>${ag.name}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleAgentChartVisibility(id) {
  if (state.hiddenAgentsInChart.has(id)) {
    state.hiddenAgentsInChart.delete(id);
  } else {
    state.hiddenAgentsInChart.add(id);
  }
  renderChartLegends();
  drawRealtimeChart();
}

// 辅助方法：千分位格式化
function formatNumber(num) {
  return (num || 0).toLocaleString();
}

// 模拟器状态切换
async function toggleSimulator() {
  const nextStatus = !state.simulatorRunning;
  try {
    const res = await fetch("/api/simulator/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextStatus })
    });
    const result = await res.json();
    state.simulatorRunning = result.enabled;
    updateSimButtonUI();
  } catch (err) {
    console.error("切换模拟器失败", err);
  }
}

function updateSimButtonUI() {
  const btn = document.getElementById("btnToggleSim");
  const txt = document.getElementById("simStatus");
  if (state.simulatorRunning) {
    btn.className = "btn btn-simulator active";
    txt.textContent = "开启中";
  } else {
    btn.className = "btn btn-simulator";
    txt.textContent = "已暂停";
  }
}

// 手动注入单次流量突发
async function triggerAgentBurst(agentId) {
  try {
    await fetch("/api/metrics/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        promptTokens: Math.floor(Math.random() * 300) + 150,
        completionTokens: Math.floor(Math.random() * 600) + 200,
        durationSec: (Math.random() * 2 + 1.5).toFixed(2),
        ttftMs: Math.floor(Math.random() * 120) + 80,
        status: "success"
      })
    });
  } catch (e) {
    console.error("注入失败", e);
  }
}

// 注销 Agent
async function removeAgent(agentId) {
  if (!confirm(`确定要移除 Agent [${agentId}] 吗？`)) return;
  try {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    delete state.agents[agentId];
    renderAgentCards();
    renderRankingList();
  } catch (e) {
    console.error("移除失败", e);
  }
}

// 重置所有指标
async function resetAllMetrics() {
  if (!confirm("确定清空所有累计用量与计数指标吗？")) return;
  try {
    await fetch("/api/metrics/reset", { method: "POST" });
    Object.values(state.agents).forEach(ag => {
      ag.promptTokens = 0;
      ag.completionTokens = 0;
      ag.requests = 0;
      ag.errors = 0;
      ag.currentTps = 0;
      ag.history = new Array(state.maxHistoryPoints).fill(0);
    });
  } catch (e) {
    console.error("重置失败", e);
  }
}

// 模态弹窗控制
function openAddAgentModal() {
  document.getElementById("newAgentId").value = "agent-" + Math.random().toString(36).substring(2, 7);
  document.getElementById("addAgentModal").classList.add("active");
}

function openDocsModal() {
  document.getElementById("docsModal").classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

async function submitNewAgent() {
  const id = document.getElementById("newAgentId").value.trim();
  const name = document.getElementById("newAgentName").value.trim() || id;
  const model = document.getElementById("newAgentModel").value;
  const role = document.getElementById("newAgentRole").value;

  if (!id) return alert("请输入 Agent ID");

  try {
    await fetch("/api/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, model, role })
    });
    closeModal("addAgentModal");
  } catch (e) {
    alert("注册失败: " + e.message);
  }
}

// 导出 JSON/CSV 报表
function exportDataReport() {
  const agents = Object.values(state.agents);
  const rows = [
    ["Agent ID", "名称", "模型", "职责", "当前TPS(tok/s)", "Prompt Tokens", "Completion Tokens", "总 Tokens", "调用次数", "平均TTFT(ms)"]
  ];

  agents.forEach(a => {
    rows.push([
      a.id,
      a.name,
      a.model,
      a.role,
      (a.currentTps || 0).toFixed(1),
      a.promptTokens || 0,
      a.completionTokens || 0,
      (a.promptTokens || 0) + (a.completionTokens || 0),
      a.requests || 0,
      Math.round(a.avgTtft || 0)
    ]);
  });

  const csvContent = "\uFEFF" + rows.map(e => e.map(i => `"${i}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `AgentMetrics_Report_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 页面加载启动
window.addEventListener("DOMContentLoaded", () => {
  initCanvases();
  connectSSE();
});
