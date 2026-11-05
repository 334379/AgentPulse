"""
Agent 监控打点客户端示例 (Python SDK 集成示范)
展示真实业务中的 Agent (如 LangChain / AutoGen / CrewAI / 原生 OpenAI)
如何将流式输出的每秒 Token 速度及用量实时上报给桌面监控端。
"""

import time
import random
import urllib.request
import json

MONITOR_API_URL = "http://127.0.0.1:4190/api/metrics/report"

def report_metric(agent_id, prompt_tokens, comp_tokens, duration_sec, ttft_ms=100, status="success"):
    payload = {
        "agentId": agent_id,
        "promptTokens": prompt_tokens,
        "completionTokens": comp_tokens,
        "durationSec": duration_sec,
        "ttftMs": ttft_ms,
        "status": status
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        MONITOR_API_URL,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"上报打点失败 (确保桌面应用已启动): {e}")
        return False

def simulate_streaming_agent(agent_id="my-custom-agent", total_tokens=400):
    """
    模拟流式生成过程：分片推送生成 Token，实时呈现每秒输出速度
    """
    print(f"[*] Agent [{agent_id}] 开始流式响应输出...")
    remaining = total_tokens
    chunk_size = 45 # 模拟 45 tokens/chunk
    prompt_tokens = 180

    # 模拟首字延迟 (TTFT)
    time.sleep(0.12)
    first_chunk = True

    while remaining > 0:
        this_chunk = min(chunk_size, remaining)
        remaining -= this_chunk

        # 上报分片生成数据
        report_metric(
            agent_id=agent_id,
            prompt_tokens=prompt_tokens if first_chunk else 0, # Prompt 仅第一次上报
            comp_tokens=this_chunk,
            duration_sec=0.5,
            ttft_ms=120 if first_chunk else 0
        )
        first_chunk = False
        time.sleep(0.5)

    print(f"[OK] Agent [{agent_id}] stream finished, total: {total_tokens} tokens")

if __name__ == "__main__":
    print(">>> 正在向 AgentPulse 监控端推送外部 Agent 打点数据...")
    # 模拟外部一个专门处理 SQL 分析的 Agent 执行
    for round_idx in range(5):
        simulate_streaming_agent(agent_id="agent-sql-bi-expert", total_tokens=random.randint(200, 500))
        time.sleep(1.0)
