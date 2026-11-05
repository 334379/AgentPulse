@echo off
title AgentPulse 桌面监控客户端
cd /d "%~dp0"
echo ====================================================
echo        AgentPulse - 多 Agent 实时监控桌面应用
echo ====================================================
echo 正在拉起独立桌面窗口与实时采集服务...
node launch-desktop.js
pause
