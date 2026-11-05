# ⚡ AgentPulse — Multi-Agent Realtime Usage & Throughput Monitor

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Zero_Dependencies-✓-blue" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

> 一个专为多智能体系统（Multi-Agent System）打造的 **零依赖、开箱即用** 的桌面实时监控应用。实时呈现各 Agent 的 Token 消耗、输出速率（Tokens/s）、调用频率、首字响应延迟（TTFT）与健康状态。

## ✨ 核心特性

- 🚀 **零依赖** — 纯 Node.js 原生实现，无需安装任何 npm 包
- 📈 **实时速度曲线** — 60FPS Canvas 贝塞尔平滑绘制，60 秒滑动时间窗口
- 🏎️ **瞬时吞吐仪表盘** — 半圆渐变弧度仪表 + 动态指针
- 🏆 **消耗排行榜** — Prompt/Completion 双色堆叠进度条，按占比排序
- 🧩 **Agent 矩阵卡片** — 响应式自适应网格，内嵌独立火花图（Sparkline）
- 🔌 **热插拔** — 新 Agent 首次上报数据自动发现注册，超时自动离线
- 📡 **SSE 实时推送** — Server-Sent Events 低开销长连接，1 秒聚合刷新
- 🎛️ **内置流量模拟器** — 开箱即看动态波形，一键开关

## 🏗️ 系统架构

```
Agent 执行环境 (LangChain / AutoGen / CrewAI / 原生 API / ...)
        │  POST /api/metrics/report (流式分片回调 / API 网关 / 直接上报)
        ▼
AgentPulse 后端引擎 (Node.js)
  • 动态 Agent 注册表 & 心跳检测 (Streaming / Idle / Offline)
  • 滑动窗口 EMA 平滑: TPS_t = 0.35 × TPS_{t-1} + 0.65 × ΔTok
  • 聚合统计: TPS, TTFT, 堆叠占比, 成功率
        │  SSE (Server-Sent Events) 每秒推送
        ▼
AgentPulse 桌面视窗 (Canvas + CSS Grid 响应式)
  • 实时对比曲线 • 仪表盘 • 排行榜 • Agent 卡片矩阵
```

## 🚀 快速开始

### 方式 1：命令行启动（推荐）

```bash
git clone https://github.com/8976543/AgentPulse.git
cd AgentPulse
npm start        # 启动服务 + 自动打开桌面窗口
```

### 方式 2：仅启动后端服务

```bash
npm run server   # 浏览器打开 http://127.0.0.1:4190
```

### 方式 3：Windows 一键运行

直接双击 `start.bat`。

### 方式 4：独立 EXE（无需 Node.js 环境）

```bash
node build-bundle.js                                          # 1. 内联所有静态资源
node --experimental-sea-config sea-config.json                # 2. 生成 SEA blob
copy node.exe dist\AgentPulse.exe                             # 3. 复制 Node 运行时
npx postject dist\AgentPulse.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2  # 4. 注入
```

## 📡 数据接入

### Agent 自动上报（推荐）

任何 Agent 向以下端点 POST 一条数据即可自动注册并展示：

```bash
curl -X POST http://127.0.0.1:4190/api/metrics/report \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-agent","promptTokens":200,"completionTokens":150,"durationSec":2.0,"ttftMs":110,"status":"success"}'
```

### Python SDK 示例

```python
import requests

def report(agent_id, prompt_tok, comp_tok, duration, ttft=100):
    requests.post("http://127.0.0.1:4190/api/metrics/report", json={
        "agentId": agent_id,
        "promptTokens": prompt_tok,
        "completionTokens": comp_tok,
        "durationSec": duration,
        "ttftMs": ttft,
        "status": "success"
    })

# 在 Agent 流式输出回调中调用
report("agent-coder", 320, 180, 2.5)
```

### 给其他 AI Agent 的自注册指令

将以下指令直接发给任何有命令执行能力的 Agent，它会自行完成注册与持续上报：

> 你需要接入 AgentPulse 监控系统（http://127.0.0.1:4190）。执行一次注册命令：`curl -X POST http://127.0.0.1:4190/api/agents/register -H "Content-Type: application/json" -d '{"id":"你的ID","name":"你的名称","model":"你的模型","role":"Coder/Researcher/Planner/Reviewer/Chatbot 选一个"}'`。之后每次完成任务时上报用量：`curl -X POST http://127.0.0.1:4190/api/metrics/report -H "Content-Type: application/json" -d '{"agentId":"你的ID","promptTokens":输入token数,"completionTokens":输出token数,"durationSec":耗时秒数,"ttftMs":首字延迟ms,"status":"success"}'`。

## 📊 监控指标定义

| 指标 | 单位 | 计算方式 |
|---|---|---|
| 实时输出速度 (TPS) | Tokens/s | 滑动窗口 EMA 平滑 |
| 首字时间 (TTFT) | ms | 请求发出 → 首个 Token 到达 |
| 总 Token 消耗 | count | Prompt + Completion 累计 |
| 调用次数 | 次 | 成功 + 失败轮次 |
| 成功率 | % | (请求数 - 错误数) / 请求数 |

## 📂 项目结构

```
AgentPulse/
├── server.js              # 后端监控引擎 & HTTP/SSE 服务
├── launch-desktop.js       # 桌面应用启动器 (Edge App Mode)
├── build-bundle.js         # EXE 打包构建脚本
├── sea-config.json         # Node.js SEA 配置
├── start.bat               # Windows 一键启动
├── test_agent_client.py    # Python 测试客户端示例
├── package.json
└── public/
    ├── index.html          # 仪表盘界面
    └── app.js              # 前端可视化引擎 (Canvas)
```

## 📝 API 参考

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/stream` | GET | SSE 实时数据流 |
| `/api/metrics/report` | POST | 上报指标数据 |
| `/api/agents/register` | POST | 手动注册 Agent |
| `/api/agents/:id` | DELETE | 移除 Agent |
| `/api/simulator/toggle` | POST | 开关模拟器 |
| `/api/metrics/reset` | POST | 重置统计数据 |

## License

MIT
