# Pitty CLI 项目分析

## 项目概述
Pitty CLI 是一个运行在终端中的 AI 编程助手，基于 DeepSeek API 提供代码辅助功能。用户可以在命令行中与 AI 交互，AI 能够使用多种工具来帮助完成编程任务。

关键特点：
- **纯 Node.js 实现** — 零运行时依赖
- **流式 SSE** — 实时显示 AI 响应
- **Markdown 终端渲染** — 支持代码块、表格（CJK 感知）、粗斜体、引用等
- **多模式** — REPL 交互、单次提问、管道输入
- **工具调用** — AI 可以直接操作文件系统和执行命令
- **国际化 (i18n)** — 内置中文 (zh) 和英文 (en) 语言包
- **多供应商兼容** — 通过配置 baseUrl 和模型可对接不同推理服务（DeepSeek、OpenAI 兼容 API 等）
- **PITTY.md 记忆注入** — 自动从工作目录向上查找 PITTY.md 文件注入系统提示

## 项目结构

```
/root/apps/pitty-cli/
├── pitty.js                   # 主入口文件
├── package.json               # 项目配置 (无外部依赖)
├── PITTY.md                   # 本文件 - 项目分析备忘
└── lib/
    ├── api.js                 # DeepSeek API 流式调用封装
    ├── chat.js                # 对话引擎 + Markdown 渲染 + 状态栏
    ├── config.js              # 配置加载与管理 (~/.pitty.json)
    ├── logger.js              # 日志记录到 /tmp/pitty/
    ├── memory.js              # 自动发现并注入 PITTY.md 内容
    ├── system.js              # 系统提示词动态构建
    ├── table.js               # CJK 感知的命令行表格渲染
    ├── tools.js               # 工具注册中心与调度执行
    ├── lang/
    │   ├── index.js           # 国际化路由 (t/ _/ _fmt)
    │   ├── zh.js              # 中文语言包
    │   └── en.js              # 英文语言包
    └── tools/                 # 各工具独立实现
        ├── bash.js            # 执行 shell 命令
        ├── read.js            # 读取文件
        ├── write.js           # 写入文件
        ├── edit.js            # 精确文本替换编辑
        ├── glob.js            # 简易 glob 文件搜索
        ├── grep.js            # 文本内容搜索
        └── webFetch.js        # HTTP 网页获取
```

## 核心模块详解

### 1. pitty.js — 主入口

处理命令行参数，支持三种运行模式：

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **REPL 交互** | `process.stdin.isTTY && !args.length` | 启动 readline 循环，持续对话 |
| **单次提问** | `args.length > 0` | 执行一次后退出 |
| **管道输入** | stdin 非 TTY | 读取 stdin 全部内容后执行 |

**内置命令**（REPL 模式下）：

| 命令 | 别名 | 功能 |
|------|------|------|
| `/clear` | `/c` | 清除对话历史 |
| `/exit` | `/q` | 退出 (Ctrl+C 两次也可) |
| `/help` | `/h` | 显示帮助信息 |

**CLI 参数**：

| 参数 | 功能 |
|------|------|
| `--help` / `-h` | 显示帮助 |
| `--init` | 创建默认配置文件 |
| `--system-prompt` / `-sp` | 打印当前目录的系统提示词 |

**特色功能**：
- **多行输入**：行尾以 `\` 结尾时自动进入续行模式
- **双 Ctrl+C 退出**：第一次提示"再按一次退出"，1 秒内第二次按下则退出
- **运行中 Ctrl+C**：立即取消当前 AI 响应
- **中断后自动恢复**：被取消后自动将上次输入写回 prompt 行

### 2. config.js — 配置管理

- **文件位置**: `~/.pitty.json`
- **默认配置**:

```json
{
  "apiKey": "",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "maxTokens": 4096,
  "maxContext": 256000,
  "maxTurns": 30,
  "temperature": 0,
  "lang": "zh",
  "tools": {
    "Bash": true,
    "Read": true,
    "Write": true,
    "Edit": true,
    "Glob": true,
    "Grep": true,
    "WebFetch": true
  }
}
```

- 支持环境变量 `PITTY_API_KEY` 自动注入
- 配置缓存：`load()` 首次调用后缓存 `_config`
- 修改过选项后自动保存

### 3. api.js — API 流式调用

**核心功能**：
- 基于 `fetch()` + SSE (Server-Sent Events) 实时流式读取
- 动态构建系统提示词注入
- 支持 `reasoning_content` 推理内容（兼容 DeepSeek R1 系列）
- 增量工具调用 (`delta.tool_calls`) 处理，按 `index` 合并
- 支持 `include_usage` 返回 token 用量统计

**多供应商兼容**：
通过 `config.baseUrl` 可对接任意 OpenAI 兼容 API（如 DeepSeek、通义千问等）
推理内容兼容多个字段名：`reasoning_content` / `thinking` / `reasoning`

### 4. chat.js — 对话引擎

这是项目最核心、最复杂的模块。

**Markdown 渲染器** (自实现，轻量)：
- `**粗体**`、`*斜体*`、`` `行内代码` ``
- 代码块 (以 `\`\`\`` 包裹，绿色显示)
- 引用块 (`>` 灰色显示)
- 标题 (`# ~ ` 灰色标记 + 粗体)
- 分隔线 (`---`, `***`, `___`)
- **表格** — CJK 感知宽度、自动换行、由 `lib/table.js` 渲染

**状态栏系统**：
- 动画旋转指示器 (10 帧 spinner)
- 实时显示当前状态（思考中 / 生成中 / 运行中）
- 耗时计数器
- Token 用量统计（上下文占比 ↑输入 ↓输出）

**对话修复 (repairMessages)**：
- 递归清理不完整的工具调用对
- 若中断导致工具调用没有结果，自动修剪对应 `assistant` 消息及其后的所有 `tool` 消息

**工具执行流程**：
1. 发送消息到 API
2. 流式渲染 AI 回复
3. 检测 `tool_calls` → 若存在则执行
4. 同类工具调用合并显示（如批量 Read 合并为"让我看看这几个文件"）
5. 将结果注入对话上下文
6. 循环直到 AI 不再调用工具或达到 `maxTurns`

### 5. system.js — 系统提示构建

**动态组装系统提示词**，包含：
- 身份介绍 (从语言包取)
- 系统说明
- 任务执行规范
- 代码风格指南
- 操作安全规范
- **工具使用指南** — 根据启用的工具动态生成对应的使用规则
- **PITTY.md 注入** — 调用 memory.js 注入项目 PITTY.md
- 环境信息（cwd、git、平台、shell、日期）

### 6. memory.js — PITTY.md 自动发现

- 从当前工作目录开始，向上逐级目录查找 `PITTY.md`（不区分大小写）
- 找到的所有 PITTY.md 文件内容合并注入系统提示
- 头部附加指令提示，告知 AI 这些内容优先级高于默认行为

### 7. tools.js — 工具注册与调度

- 7 个工具统一注册，通过 `config.tools` 控制启用/禁用
- `executeToolCall()` — 解析参数 JSON → 执行 → 错误兜底
- 工具调用结果格式化：超长内容自动截断至 16000 字符

### 8. logger.js — 日志系统

- 日志目录：`/tmp/pitty/`
- 文件命名：`{{启动时间戳}}.log`
- 记录：请求体、响应、错误、启动信息
- 请求/响应内容截断至 2000 字符，避免日志过大

### 9. table.js — 命令行表格渲染

**独立实现，无依赖**。特点：
- **CJK 字符宽度感知** — 中文字符计为 2 个字符宽度
- **ANSI 转义序列感知** — 正确计算带颜色的字符宽度
- **自动折行** — 超出列宽时自动换行，支持 CJK 字符精确折行
- **自适应列宽** — 根据终端宽度自动分配（含最小宽度 3 字符）
- **边框样式** — 使用制表符 `┌─┬┐│├─┼┤└─┴┘`

### 10. lang/ — 国际化系统

**三级路由函数**：
- `t(name, args)` — 工具标签翻译
- `_(path, ...args)` — 深层路径查找，支持函数调用
- `_fmt(path, vars)` — 模板插值

支持 `lang: "zh"` 或 `lang: "en"` 配置。

## 可用工具

| 工具名 | 功能 | 实现文件 | 关键参数 | 限制 |
|--------|------|---------|---------|------|
| **Bash** | 执行 shell 命令 | `tools/bash.js` | `command`, `timeout`(默认60s), `workdir` | stdout/stderr 各截断 50000 字符 |
| **Read** | 读取文件 | `tools/read.js` | `file_path`, `offset`, `limit` | 内容最大 1MB |
| **Write** | 写入文件 | `tools/write.js` | `file_path`, `content` | 自动创建目录 |
| **Edit** | 精确替换 | `tools/edit.js` | `file_path`, `old_string`, `new_string` | 精确匹配，只替换第一次出现 |
| **Glob** | 搜索文件 | `tools/glob.js` | `pattern`, `directory` | 最大返回 200 个结果；简易实现（非完整 glob） |
| **Grep** | 搜索内容 | `tools/grep.js` | `pattern`, `path`, `include`, `maxResults` | 默认最多 50 条结果；忽略 `.` 和 `node_modules` |
| **WebFetch** | 获取网页 | `tools/webFetch.js` | `url` | 超时 15s；内容截断 50000 字符 |

**工具实现特点**：
- 每个工具 `execute(args, opts)` 异步或同步均可
- `opts.signal` — AbortSignal 支持取消
- 标准返回格式 `{ result: { ... } }` 或 `{ error: "..." }`

## 对话流程架构

```
用户输入 → messages.push({role: "user"})
  ↓
API 流式调用 → 渲染内容 / 收集 reasoning
  ↓
检测 tool_calls? ───否──→ 输出统计信息，结束
  │
  是
  ↓
分组显示工具调用 → 并行执行 → 结果注入 messages
  ↓
回到 API 调用 (循环，最多 maxTurns 轮)
```

## 已知局限

1. **Glob 实现简单** — 不是完整 glob 实现，对复杂模式支持有限
2. **Edit 只替换第一个匹配** — 不支持替换所有出现
3. **Grep 不支持真正的正则** — 目前只有 `includes()` 的简单字符串匹配
4. **无外部依赖** — 所有功能自实现（Markdown 渲染、表格、glob 等），功能相对基础
5. **无会话持久化** — 退出后对话历史不保存
6. **语言包硬编码** — 不支持热加载或插件式扩展

## 使用方式

```bash
# 初始化配置
pitty --init
vim ~/.pitty.json   # 填入 API key

# 交互式会话
pitty

# 单次提问
pitty "帮我分析这个错误"

# 管道输入
cat error.txt | pitty "分析以下错误"

# 查看当前目录的系统提示
pitty --system-prompt

# 指定语言 (配置文件设置 lang: "en" 即可切换英文)
```
