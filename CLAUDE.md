# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

DSC (DeepSeek Code CLI) — 一个基于 DeepSeek API 的 AI 编程助手 CLI，类似 Claude Code 但后端使用 DeepSeek 模型。纯 Node.js 实现，零外部依赖。

## 常用命令

```bash
npm start                    # 启动 REPL 交互模式
node dsc.js "你的提示词"      # 单次执行模式
echo "提示词" | node dsc.js  # 管道输入模式
node dsc.js --init           # 创建默认配置文件 ~/.dsc.json
```

## 架构

**入口:** `dsc.js` — CLI 参数解析，三种模式（REPL / 单次 / 管道）

**核心模块 (`lib/`):**

- `api.js` — DeepSeek API HTTP 客户端。SSE 流式解析，支持 tool_calls、reasoning_content、用量统计。Stream 到 `/chat/completions`
- `chat.js` — 主循环编排。多轮 tool call 循环（默认最多 15 轮），思考中状态栏动画，工具结果格式化，tokens 用量累积显示
- `tools.js` — 工具注册中心。从配置读取启用的工具列表，将 API tool_calls 路由到对应执行函数
- `system.js` — 系统提示词生成器。根据启用的工具动态拼接中文系统提示词（身份、系统说明、任务执行、谨慎操作、工具使用、语气风格、环境信息）
- `config.js` — 配置管理。读写 `~/.dsc.json`，默认值：模型 `deepseek-chat`、baseUrl `https://api.deepseek.com`、maxTokens 4096、temperature 0
- `logger.js` — 日志。写入 `/tmp/dsc/<startup_timestamp>.log`，记录请求/响应/错误

**工具实现 (`lib/tools/`):**

每个工具文件导出 `{ name, description, inputSchema, execute }` 结构。通过 `tools.js` 统一注册。

| 文件 | 功能 |
|------|------|
| `bash.js` | 通过 spawn 执行 shell 命令，30s 超时，50KB 输出截断 |
| `read.js` | 读文件，支持 offset/limit 分段读取 |
| `write.js` | 写文件，自动创建目录 |
| `edit.js` | 精确字符串替换编辑 |
| `glob.js` | 文件搜索，简单递归实现（非 node-glob），跳过 `.` 和 `node_modules` 目录 |
| `grep.js` | 文件内容搜索，支持目录遍历 |
| `webFetch.js` | HTTP GET 获取 URL 内容，15s 超时，50KB 截断 |

## 关键设计

- **零外部依赖** — 使用 Node.js 18+ 内置 `fetch`、`fs`、`readline`
- **流式响应** — SSE streaming 解析，单行 `data: ` 协议，content + tool_calls 分片拼接
- **推理过程展示** — 支持 `reasoning_content` / `thinking` / `reasoning` 多字段兼容。思考期间显示状态栏 `思考中 Ns  <推理片段>`
- **并行工具执行** — 一轮中的多个 tool_calls 使用 `Promise.all` 并行执行
- **工具结果截断** — 超过 16000 字符截断后返回给模型
- **系统提示词中文** — 所有 prompt 均为中文，包含二次元语气风格要求
