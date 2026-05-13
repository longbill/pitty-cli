# Pitty CLI 项目备忘

## 项目概述

Pitty CLI 是一个运行在终端中的 AI 编程助手，基于 OpenAI-compatible Chat Completions API 实现流式对话与工具调用。用户可以通过 REPL、单次命令或管道输入与模型交互，模型可以在权限控制下读取/编辑文件、搜索代码、执行命令、管理后台任务、获取网页内容。

当前项目特点：

- **Node.js CLI**：入口为 `pitty.js`，CommonJS 模块，要求 Node.js >= 18。
- **流式 SSE**：通过 `/chat/completions` 的 stream 接口实时输出内容。
- **OpenAI-compatible 多供应商支持**：配置 provider、model、base_url，可对接 DeepSeek、本地推理服务或其他兼容接口。
- **多模型配置**：模型引用格式为 `provider/model`，支持 `--switch-model` 交互切换主模型。
- **工具调用**：支持文件读写、精确编辑、搜索、命令执行、网页获取、后台任务管理。
- **权限模式**：支持 `none`、`read-only`、`ask`、`audit`、`accept-all`。
- **审计模式**：`audit` 模式会先调用审计模型审查工具调用风险。
- **REPL 交互**：支持原始 stdin、光标移动、历史记录、粘贴占位、Ctrl+C 中断、后台任务提醒。
- **终端渲染**：支持 Markdown 渲染、状态栏、CJK 宽度处理、表格渲染。
- **PITTY.md 记忆注入**：自动从当前目录向上查找 PITTY.md 并注入系统提示。

## 项目结构

```text
/root/apps/pitty-cli/
├── pitty.js                    # CLI 主入口
├── package.json                # npm 配置
├── package-lock.json
├── PITTY.md                    # 当前项目备忘
├── AGENTS.md
├── CLAUDE.md
├── end.js
├── lib/
│   ├── api.js                  # OpenAI-compatible 流式 API 调用
│   ├── audit.js                # 工具调用审计
│   ├── backgroundTasks.js      # 后台任务状态管理
│   ├── chat.js                 # 对话主循环、工具调用、状态栏协调
│   ├── config.js               # INI 配置加载、模型解析、权限配置
│   ├── ini.js                  # 简单 INI 解析
│   ├── inputHistory.js         # REPL 输入历史
│   ├── logger.js               # 日志写入 /tmp/pitty/
│   ├── memory.js               # PITTY.md 自动发现与注入
│   ├── permission.js           # 权限模式与工具可用性
│   ├── render.js               # Markdown/终端渲染
│   ├── repl.js                 # 交互式 REPL
│   ├── safePath.js             # 文件路径安全限制
│   ├── statusbar.js            # 终端状态栏
│   ├── switchModel.js          # 交互式模型切换
│   ├── system.js               # 系统提示词构建
│   ├── table.js                # CJK 感知表格渲染
│   ├── toolConfirm.js          # 工具确认提示格式化
│   ├── tools.js                # 工具注册与分发
│   ├── width.js                # 字符宽度计算
│   ├── lang/
│   │   ├── index.js            # i18n 路由：t / _ / _fmt
│   │   ├── zh.js               # 中文语言包
│   │   └── en.js               # 英文语言包
│   └── tools/
│       ├── bash.js             # 执行 shell 命令，长任务自动转后台
│       ├── read.js             # 读取文件
│       ├── write.js            # 写入文件
│       ├── edit.js             # 精确文本替换
│       ├── glob.js             # 文件 glob 搜索
│       ├── grep.js             # 文本/正则搜索
│       ├── webFetch.js         # 获取网页内容
│       ├── backgroundCreate.js # 创建后台任务
│       ├── backgroundList.js   # 列出后台任务
│       ├── backgroundRead.js   # 读取后台任务输出
│       └── backgroundStop.js   # 停止后台任务
└── test/
    ├── chat-statusbar.test.js
    ├── helpers.js
    ├── repl.test.js
    ├── tool-confirm.test.js
    └── tools.test.js
```

## 入口与运行模式

入口文件：`pitty.js`

运行模式：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| REPL 交互 | `process.stdin.isTTY && !args.length` | 启动 `lib/repl.js` |
| 单次提问 | 有命令行参数 | 调用 `chat.run()` 后退出 |
| 管道输入 | stdin 非 TTY 且无参数 | 读取 stdin 后调用 `chat.run()` |

主要 CLI 参数：

| 参数 | 功能 |
|---|---|
| `--help` / `-h` | 显示帮助 |
| `--init` | 写入默认配置文件 |
| `--system-prompt` / `-sp` | 打印当前目录构建出的系统提示 |
| `--switch-model` | 交互式切换主模型 |
| `--accept-all` | 本次启动使用 accept-all 权限模式 |
| `--read-only` | 本次启动使用 read-only 权限模式 |
| `--ask` | 本次启动使用 ask 权限模式 |
| `--audit` | 本次启动使用 audit 权限模式 |
| `--none` | 本次启动使用 none 权限模式 |

## 配置系统

配置模块：`lib/config.js`

主配置文件：

```text
~/.pitty.ini
```

如果 `~/.pitty.ini` 不存在，会使用空配置启动，`--init` 会写入 INI 格式配置。

重要配置项：

| 配置 | 说明 |
|---|---|
| `main_model` | 主模型引用，格式为 `provider/model` |
| `audit_model` | 审计模型引用 |
| `permission_mode` | 默认权限模式 |
| `max_turns` | 最大工具循环轮数配置项 |
| `accept_all_wait_seconds` | accept-all 模式自动确认倒计时 |
| `bash_background_after_ms` | Bash 命令自动转后台阈值 |
| `[provider.xxx]` | provider 配置段 |
| `api_key` | provider API key |
| `base_url` | provider API base URL |
| `models` | provider 下可用模型列表 |
| `max_tokens` | 单次响应最大 token |
| `temperature` | 采样温度 |

环境变量覆盖：

| 环境变量 | 作用 |
|---|---|
| `PITTY_API_KEY` | 覆盖所有 provider 的 `api_key` |
| `PITTY_MODEL_NAME` | 覆盖 `main_model` |

模型引用必须包含 `/`，例如：

```text
local/qwen3
openai/gpt-4.1
```

`resolveModel()` 会根据 provider 名和模型名解析出 `apiKey`、`baseUrl`、`model`、`maxTokens`、`temperature`。

## API 调用

模块：`lib/api.js`

核心逻辑：

1. 根据当前 provider 配置拼接：
   ```text
   {baseUrl}/chat/completions
   ```
2. 动态构建 system prompt。
3. 追加历史消息。
4. 如果有可用工具，转成 OpenAI function tools schema。
5. 使用 `fetch()` 发起 stream 请求。
6. 按 SSE `data:` 行解析增量内容。
7. 合并：
   - `delta.content`
   - `delta.reasoning_content`
   - `delta.thinking`
   - `delta.reasoning`
   - `delta.tool_calls`
   - `usage`

支持 `stream_options: { include_usage: true }`。

## 对话主循环

模块：`lib/chat.js`

主要职责：

- 维护 `messages`。
- 在每轮开始前修复不完整 tool call 消息。
- 调用 `api.chat()`。
- 流式渲染模型输出。
- 收集 token usage。
- 处理 reasoning-only 输出。
- 检测工具调用。
- 走权限 / 确认 / 审计流程。
- 并行执行已批准的工具调用。
- 将工具结果写回 `messages`。
- 循环直到没有工具调用或达到最大轮数。

关键函数：

| 函数 | 作用 |
|---|---|
| `run()` | 对话主循环 |
| `repairMessages()` | 移除不完整或非法排列的工具调用消息 |
| `resolveToolApprovals()` | 权限、确认、审计、自动接受流程 |
| `formatResult()` | 将工具执行结果转为 tool message content |

工具结果超过 16000 字符会被截断。

## 权限模式

模块：`lib/permission.js`

| 模式 | 可用工具 |
|---|---|
| `none` | `WebFetch` |
| `read-only` | `Read`, `Glob`, `Grep`, `WebFetch` |
| `ask` | 全工具，危险工具需用户确认 |
| `audit` | 全工具，先由审计模型审查 |
| `accept-all` | 全工具，危险工具倒计时后自动确认 |

危险工具列表：

```text
Write, Edit, Bash, BackgroundCreate, BackgroundStop
```

默认权限模式由 `permission_mode` 决定；如果没有配置或配置非法，默认回退到 `read-only`。

CLI 权限参数只影响本次进程，通过 `config.setPermissionOverride()` 设置。

## 工具系统

模块：`lib/tools.js`

工具注册表：

| 工具 | 文件 | 作用 |
|---|---|---|
| `Bash` | `lib/tools/bash.js` | 执行 shell 命令，支持超时和自动后台化 |
| `Read` | `lib/tools/read.js` | 读取文件内容 |
| `Write` | `lib/tools/write.js` | 写入文件，必要时创建目录 |
| `Edit` | `lib/tools/edit.js` | 精确替换第一次出现的字符串 |
| `Glob` | `lib/tools/glob.js` | 按 glob 模式搜索文件 |
| `Grep` | `lib/tools/grep.js` | 文本/正则搜索文件内容 |
| `WebFetch` | `lib/tools/webFetch.js` | 获取网页文本内容 |
| `BackgroundCreate` | `lib/tools/backgroundCreate.js` | 创建后台 shell 任务 |
| `BackgroundList` | `lib/tools/backgroundList.js` | 列出后台任务 |
| `BackgroundRead` | `lib/tools/backgroundRead.js` | 读取后台任务输出 |
| `BackgroundStop` | `lib/tools/backgroundStop.js` | 停止后台任务 |

执行流程：

1. 根据 `toolCall.function.name` 找工具。
2. JSON parse 参数。
3. 校验 `inputSchema.required`。
4. 调用 `tool.execute(args, { signal })`。
5. 捕获错误并返回 `{ error }`。

工具是否暴露给模型由当前权限模式决定，而不是旧版 `config.tools`。

## REPL

模块：`lib/repl.js`

主要能力：

- 自绘 prompt。
- 原始 stdin 模式输入。
- 光标移动与行刷新。
- 多行输入显示。
- bracketed paste 模式。
- 长粘贴/多行粘贴自动替换为 `[Pasted text #N]` 占位符，提交前展开。
- 输入历史。
- Ctrl+C：运行中中断当前请求；空闲时用于退出。
- 工具确认时临时释放 stdin 给 readline。
- 后台任务状态展示。
- 后台任务新输出以 `<system-reminder>` 注入下一轮。
- 用户在 REPL 中执行过的 shell 输出也可作为 `<system-reminder>` 注入。
- 启动时显示当前权限模式和可用工具列表。

REPL 里会调用同一个 `chat.run()`，并共享同一份 `messages` 历史。

## 系统提示与记忆注入

### system.js

模块：`lib/system.js`

系统提示包含：

- 身份说明。
- 执行任务规则。
- 代码风格规则。
- 操作安全规则。
- 根据当前可见工具生成的工具使用规则。
- PITTY.md 注入内容。
- 环境信息：cwd、是否 git、平台、系统版本、shell、日期。

### memory.js

模块：`lib/memory.js`

从当前工作目录开始向上查找 `PITTY.md`，不区分大小写，并把找到的内容合并注入 system prompt。

## 渲染系统

相关模块：

- `lib/render.js`
- `lib/statusbar.js`
- `lib/table.js`
- `lib/width.js`

能力：

- Markdown 行渲染。
- 代码块渲染。
- 引用、标题、分隔线。
- 行内代码、粗体、斜体。
- 表格渲染。
- CJK 宽度感知。
- ANSI 转义序列宽度处理。
- 状态栏 spinner。
- 上下文 token 用量显示。

## 后台任务

相关模块：

- `lib/backgroundTasks.js`
- `lib/tools/backgroundCreate.js`
- `lib/tools/backgroundList.js`
- `lib/tools/backgroundRead.js`
- `lib/tools/backgroundStop.js`

Bash 工具也会在长任务或预计超过阈值时转入后台。REPL 会显示仍在运行的后台任务，并在有新输出时生成 system reminder。

## 日志

模块：`lib/logger.js`

日志目录：

```text
/tmp/pitty/
```

记录内容包括：

- 启动信息。
- 请求消息。
- API 响应摘要。
- 错误信息。

日志内容会截断，避免文件过大。

## 测试

测试命令：

```bash
npm test
```

当前测试状态：

```text
62 tests
62 pass
0 fail
```

测试覆盖：

- chat 状态栏。
- REPL stdin handling。
- 后台任务提醒。
- 输入历史。
- 模型切换。
- 工具确认格式化。
- safePath。
- Glob。
- Read。
- Write。
- Edit。
- Bash。
- Background task tools。
- Grep。
- executeToolCall。

## 已知注意点

1. `lib/chat.js` 中 `run()` 当前使用 `opts.maxTurns || 10`，可能没有读取 `config.getMaxTurns()`；如果希望配置项 `max_turns` 生效，需要检查这里。
2. `lib/system.js` 的 system prompt 缓存只按 cwd 缓存，但 prompt 内容依赖可见工具列表；切换权限模式后可能需要让缓存也考虑工具列表。
3. `PITTY.md` 会影响之后 agent 的系统提示，修改这里要保持准确、简洁、不过度假设。
4. 默认权限是 `read-only`，需要写文件或执行命令时应使用 `--ask`、`--audit` 或 `--accept-all`。
5. 项目目录是共享 root 工作区，不要擅自删除文件、重置 git、停止服务或覆盖未知改动。

## 常用命令

```bash
# 安装依赖
npm install

# 启动 REPL
node pitty.js

# 单次提问
node pitty.js "分析当前项目"

# 管道输入
cat error.log | node pitty.js "分析这个错误"

# 初始化配置
node pitty.js --init

# 查看系统提示
node pitty.js --system-prompt

# 切换模型
node pitty.js --switch-model

# 运行测试
npm test
```

如果通过 npm link 或 bin 安装，也可以使用：

```bash
pitty
pitty --switch-model
pitty --ask "帮我修复这个问题"
```
