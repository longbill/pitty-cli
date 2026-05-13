# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Pitty CLI — 一个基于 OpenAI-compatible Chat Completions API 的 AI 编程助手 CLI。Node.js >= 18，CommonJS 模块。

## 常用命令

```bash
npm start                    # 启动 REPL 交互模式
npm test                     # 运行所有测试 (node --test test/*.test.js)
node pitty.js "你的提示词"    # 单次执行模式
echo "提示词" | node pitty.js # 管道输入模式
node pitty.js --init          # 创建默认配置文件 ~/.pitty.ini
node pitty.js --system-prompt # 打印当前系统提示词（含 PITTY.md 注入）
node pitty.js --switch-model  # 交互式切换模型
node pitty.js --ask "..."     # 以 ask 权限模式启动
```

## 架构

**入口:** `pitty.js` — CLI 参数解析，三种模式（REPL / 单次 / 管道），readline 确认回调。以 `provider/model` 格式解析模型引用。

**核心模块 (`lib/`):**

- `api.js` — OpenAI-compatible 流式 API 客户端。SSE `data:` 解析，支持 `reasoning_content` / `thinking` / `reasoning`，tool_calls 分片拼接，`stream_options: { include_usage: true }`
- `chat.js` — 对话主循环。多轮 tool call 循环（默认 10 轮），状态栏协调，工具执行结果格式化（16000 字符截断），`repairMessages()` 移除不完整 tool call 链
- `tools.js` — 工具注册中心。`ALL_TOOLS` 表驱动，根据权限模式筛选可见工具，`executeToolCall()` 处理 JSON 解析、参数校验、执行与错误捕获
- `permission.js` — 5 种权限模式：`none`、`read-only`、`ask`、`audit`、`accept-all`。各模式映射不同工具可见性，`CONFIRM_TOOLS` 列出需确认的危险工具（Write/Edit/Bash/BackgroundCreate/BackgroundStop）
- `audit.js` — audit 模式下用独立审计模型审查 tool calls，返回 JSON 格式的 SAFE/RISKY 分类
- `system.js` — 中文系统提示词构建。根据可见工具动态拼接工具使用说明，缓存按 cwd 键控（注意：未考虑工具列表变化）
- `config.js` — INI 配置加载与模型解析。`resolveModel()` 根据 `provider/model` 解出 apiKey/baseUrl/model/maxTokens/temperature，环境变量 `PITTY_API_KEY` / `PITTY_MODEL_NAME` 覆盖
- `memory.js` — 从 cwd 向上查找所有 `PITTY.md`（不区分大小写），合并注入系统提示
- `logger.js` — 调试日志写入 `/tmp/pitty/<timestamp>.log`
- `lang/` — i18n 系统，支持 zh/en 语言包。三个函数：`_(path)` 点路径查找、`_fmt(path, vars)` 模板插值、`t(toolName, args)` 工具调用描述
- `repl.js` — 交互式 REPL。原始 stdin 模式、光标移动、多行输入、bracketed paste、`[Pasted text #N]` 占位符、输入历史、Ctrl+C 中断、后台任务输出注入
- `render.js` / `statusbar.js` / `table.js` / `width.js` — 终端渲染系统。Markdown 行渲染、状态栏 spinner、CJK 宽度感知表格、ANSI 转义宽度处理

**工具 (`lib/tools/`):** 每个文件导出 `{ name, description, inputSchema, execute }`。

| 文件 | 功能 |
|------|------|
| `bash.js` | shell 命令执行，30s 超时，50KB 截断，超时或超阈值自动转后台 |
| `read.js` / `write.js` / `edit.js` | 文件读写与精确替换 |
| `glob.js` / `grep.js` | 文件/内容搜索，跳过 `.` 和 `node_modules` |
| `webFetch.js` | HTTP GET，15s 超时，50KB 截断 |
| `background*.js` | 后台任务 CRUD（创建/列表/读取/停止） |

**后台任务:** `backgroundTasks.js` 集中管理。Bash 超过 `bash_background_after_ms`（默认 30s）自动转入后台。REPL 显示运行中任务，新输出通过 `<system-reminder>` 注入下一轮。

## 关键设计

- **零外部依赖**（除 `string-width`）— 使用 Node.js 内置 `fetch`、`fs`、`readline`
- **流式响应** — SSE streaming，content + tool_calls 增量拼接
- **推理过程展示** — 兼容 `reasoning_content` / `thinking` / `reasoning` 多字段
- **并行工具执行** — 同轮多个 tool_calls 用 `Promise.all` 并行
- **权限-审计-确认流水线** — `resolveToolApprovals()` 顺序执行：权限检查 → audit 审查 → ask 确认 → accept-all 倒计时
- **消息修复** — `repairMessages()` 切断不完整的 assistant+tool_calls 链，避免 API 400 错误
- **PITTY.md 注入** — 从目录树根到 cwd 自动发现并注入为系统提示，影响 AI 行为
- **i18n 不可用时的回退** — `_(path)` 找不到时返回 path 本身作为兜底
