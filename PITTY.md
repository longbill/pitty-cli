# Pitty CLI 项目备忘

这份文档是给后续 Pitty/Agent 会话快速理解当前代码库用的。保持准确、简洁、偏工程事实；不要写空泛说明。

## 项目定位

Pitty CLI 是一个终端里的 AI 编程助手，基于 OpenAI-compatible Chat Completions API。它支持：

- 交互式 REPL、单次命令、管道输入三种运行方式。
- SSE 流式输出，兼容 reasoning 字段和 function tool calls。
- 多 provider / 多模型配置，模型引用格式为 `provider/model`。
- 权限模式控制工具暴露与执行确认。
- 文件读写、精确编辑、搜索、Bash、网页抓取、后台任务管理。
- 自动注入当前目录向上的 `PITTY.md` 作为系统记忆。

技术栈：Node.js CommonJS，入口 `pitty.js`，要求 Node.js >= 18。测试使用 `node --test`。

## 常用命令

```bash
npm test
node pitty.js --help
node pitty.js --system-prompt
node pitty.js --switch-model
node pitty.js --ask "帮我分析当前项目"
```

如果通过 bin/link 安装，也可用：

```bash
pitty
pitty --ask "..."
```

## 目录结构

```text
/root/apps/pitty-cli/
├── pitty.js                    # CLI 入口与参数分发
├── package.json                # npm scripts / bin / 依赖
├── PITTY.md                    # 当前备忘，会被系统提示注入
├── lib/
│   ├── api.js                  # OpenAI-compatible streaming API 调用与 SSE 解析
│   ├── audit.js                # audit 模式下的工具调用安全审查
│   ├── backgroundTasks.js      # 后台任务注册、输出增量、状态管理
│   ├── chat.js                 # 对话主循环、工具调用、权限确认、状态栏
│   ├── config.js               # ~/.pitty.ini 读取、模型解析、权限配置
│   ├── ini.js                  # 简单 INI parser
│   ├── inputHistory.js         # REPL 输入历史
│   ├── logger.js               # /tmp/pitty/ 日志
│   ├── memory.js               # 向上查找 PITTY.md 并拼入系统提示
│   ├── permission.js           # 权限模式与工具可见性
│   ├── render.js               # Markdown 终端渲染
│   ├── repl.js                 # 交互式 REPL、粘贴、Ctrl+C、shell 集成
│   ├── safePath.js             # 工具文件路径安全限制
│   ├── statusbar.js            # spinner / 状态栏
│   ├── switchModel.js          # 交互式模型切换
│   ├── system.js               # 系统提示词构建
│   ├── table.js                # 表格渲染
│   ├── toolConfirm.js          # 工具确认提示格式化
│   ├── tools.js                # 工具注册与 executeToolCall
│   ├── width.js                # ANSI/CJK 字符宽度
│   ├── lang/                   # i18n：zh/en 与 t/_/_fmt
│   └── tools/                  # Bash/Read/Write/Edit/Glob/Grep/WebFetch/Background*
└── test/
    ├── chat-statusbar.test.js
    ├── helpers.js
    ├── repl.test.js
    ├── tool-confirm.test.js
    └── tools.test.js
```

## 入口与运行模式

`pitty.js` 做这些事：

1. 处理 `--help`、`--init`、`--system-prompt`、`--switch-model`。
2. 处理权限覆盖参数：`--accept-all`、`--read-only`、`--ask`、`--audit`、`--none`。
3. 解析主模型配置，缺少 API key 时退出。
4. 根据 stdin/args 分发：
   - TTY 且无 args：启动 `lib/repl.js`。
   - 有 args：把 args join 成 prompt，调用 `chat.run()` 后退出。
   - 非 TTY 且无 args：读取 stdin 后调用 `chat.run()`。

工具确认函数在 CLI 和 REPL 各有一份，都会临时释放 raw stdin 给 readline。

## 配置系统

主配置：`~/.pitty.ini`，由 `lib/config.js` 管理。

重要配置项：

| 配置 | 说明 |
|---|---|
| `main_model` | 主模型引用，必须是 `provider/model` |
| `audit_model` | audit 模式使用的审计模型引用 |
| `permission_mode` | 默认权限模式 |
| `max_turns` | 配置项存在，但当前 `chat.run()` 默认没有读取它 |
| `accept_all_wait_seconds` | accept-all 自动确认倒计时，默认 5 |
| `bash_background_after_ms` | Bash 自动转后台阈值，默认 30000 |
| `[provider.xxx]` | provider 配置段 |
| `api_key` | provider API key |
| `base_url` | provider API base URL，不要带 `/chat/completions` |
| `models` | provider 下允许的模型名列表 |
| `max_tokens` | 单次响应最大 tokens，默认 4096 |
| `temperature` | 默认 0.6 |

环境变量：

- `PITTY_API_KEY`：覆盖所有 provider 的 `api_key`，但只有 `_config.provider` 存在时生效。
- `PITTY_MODEL_NAME`：覆盖 `main_model`。

`resolveModel(modelRef)` 会检查 provider 存在，并在 provider 配置了 `models` 时要求模型名在列表里。

## API 与流式解析

`lib/api.js`：

- 请求地址为 `${baseUrl}/chat/completions`。
- 每次请求动态调用 `buildSystemPrompt(tools)`，再追加历史消息。
- 工具以 OpenAI function tool schema 发送，`tool_choice = 'auto'`。
- 开启 `stream: true` 和 `stream_options: { include_usage: true }`。
- SSE 解析 `data:` 行，合并：
  - `delta.content`
  - `delta.reasoning_content`
  - `delta.thinking`
  - `delta.reasoning`
  - `delta.tool_calls`
  - `usage`
- 解析失败的 SSE 行只写日志，不中断主流程。

注意：`audit.js` 调用同一个 `api.chat()` 时把 audit system prompt 作为普通 message 传入；`api.chat()` 仍会额外加 Pitty 的 system prompt。

## 对话主循环

核心在 `lib/chat.js` 的 `run(input, messagesOrOpts, opts)`：

1. 兼容 `run(input, messages, opts)` 和 `run(input, opts)` 两种调用。
2. 默认确认策略：`opts.confirm === undefined ? true : opts.confirm`。
3. 当前最大轮数：`opts.maxTurns || 10`。
4. 读取当前权限下可见工具 `getApiTools()`。
5. 修复历史中不完整/非法 tool-call 消息：`repairMessages()`。
6. 添加用户消息，循环请求模型。
7. 渲染 content；reasoning 只统计 token，若最终只有 reasoning 无 content，则把 reasoning 当输出显示。
8. 有工具调用时进入权限/确认/audit 流程。
9. 已批准工具使用 `Promise.all` 并行执行。
10. 工具结果写回 `role: tool`，结果内容超过 16000 字符截断。
11. 无工具调用时输出 usage/上下文状态并结束。

中断：`currentAbort` 暴露 getter；REPL Ctrl+C 会 abort 当前请求。`abortRun()` 会移除刚加入的 user message 并修复消息。

## 权限模式

`lib/permission.js` 决定模型看得见哪些工具：

| 模式 | 工具 |
|---|---|
| `none` | `WebFetch` |
| `read-only` | `Read`, `Glob`, `Grep`, `WebFetch` |
| `ask` | 全工具，危险工具需人工确认 |
| `audit` | 全工具，工具调用先交给审计模型 |
| `accept-all` | 全工具，危险工具倒计时后自动确认 |

危险工具：`Write`, `Edit`, `Bash`, `BackgroundCreate`, `BackgroundStop`。

默认权限来自 `permission_mode`，非法或缺省回退为 `read-only`。CLI 权限参数只影响本次进程。

## 工具系统

`lib/tools.js` 注册全部工具并根据权限过滤。执行流程：

1. 按 `toolCall.function.name` 查表。
2. JSON parse `function.arguments`。
3. 校验 `inputSchema.required`。
4. 调用 `tool.execute(args, { signal })`。
5. 捕获异常并返回 `{ error }`。

现有工具：

| 工具 | 文件 | 要点 |
|---|---|---|
| `Read` | `lib/tools/read.js` | 读取文件，支持 offset/limit |
| `Write` | `lib/tools/write.js` | 写文件，必要时创建目录 |
| `Edit` | `lib/tools/edit.js` | 精确替换第一次出现的字符串 |
| `Glob` | `lib/tools/glob.js` | glob 搜索，跳过 dotfiles/node_modules，结果最多返回 200 个 |
| `Grep` | `lib/tools/grep.js` | 文本/正则搜索，支持 include 和 maxResults |
| `WebFetch` | `lib/tools/webFetch.js` | 拉取 URL 文本 |
| `Bash` | `lib/tools/bash.js` | bash -c 执行，超时/长任务自动转后台 |
| `BackgroundCreate` | `lib/tools/backgroundCreate.js` | 创建后台 shell 任务 |
| `BackgroundList` | `lib/tools/backgroundList.js` | 列后台任务 |
| `BackgroundRead` | `lib/tools/backgroundRead.js` | 读后台任务输出 |
| `BackgroundStop` | `lib/tools/backgroundStop.js` | 停止后台任务 |

文件类工具会经过 `safePath.js`。当前运行在 root 用户时，home 是 `/root`，路径边界行为要结合测试理解。

## Bash 与后台任务

`lib/tools/bash.js`：

- 默认 timeout 60000ms。
- 默认 `backgroundAfter` 来自 `bash_background_after_ms`，否则 30000ms。
- 会先用正则估计明显长任务：`sleep` 超阈值、`tail -f`、`watch`、`top/htop/btop`、无限 `ping`、dev server、foreground `docker compose up` 等，命中则立即创建后台任务。
- 普通命令运行超过 `backgroundAfter` 会注册为后台任务并先返回 task id。
- stdout/stderr 内部最多收集 10MB，返回给模型最多各 50000 字符。
- abort signal 会 SIGTERM 子进程。

`lib/backgroundTasks.js` 保存进程内后台任务；REPL 会在下一轮通过 `<system-reminder>` 注入新输出。

## REPL 行为

`lib/repl.js`：

- 原始 stdin，自绘 prompt：`Pitty[目录名]: `。
- 支持左右移动、上下历史、多行输入、删除。
- 启用 bracketed paste；多行或过长粘贴会变成 `[Pasted text #N]` 占位，提交前展开。
- 启动时显示当前权限模式与可用工具。
- AI 运行中 Ctrl+C abort；空闲时 Ctrl+C 用于退出逻辑。
- 工具确认时临时关闭 raw mode 并恢复 stdin。
- 支持用户在 REPL 中执行 shell 命令，命令输出会作为 `<system-reminder>` 注入后续对话。
- 后台任务有新输出时，也会作为 `<system-reminder>` 注入后续对话。

`repl._test` 暴露了 `formatBackgroundTaskReminder` 供测试。

## 系统提示与记忆注入

`lib/system.js` 构建系统提示：身份、任务规则、代码风格、安全规则、可见工具使用规则、PITTY.md 记忆、环境信息。

`lib/memory.js` 从当前目录向根目录查找文件名大小写不敏感的 `PITTY.md`，按根到当前目录的顺序合并。内容会以“代码库和用户指令”形式注入，优先级高。

注意：`system.js` 的 `_cache` 目前只按 `cwd` 缓存 prompt，未把工具列表/权限模式纳入缓存 key。若同一进程内切换工具可见性，system prompt 可能不更新。

## 渲染与 i18n

- `lib/render.js`：Markdown 行渲染、代码块、标题、列表、表格等。
- `lib/table.js`：表格渲染。
- `lib/width.js`：ANSI 转义与 CJK 宽度处理。
- `lib/statusbar.js`：状态栏/spinner/耗时。
- `lib/lang/zh.js`、`lib/lang/en.js`：语言包。
- `lib/lang/index.js`：`t` / `_` / `_fmt` 路由。

改输出文案时优先更新语言包，不要把用户可见固定文案散落到逻辑代码里。

## 测试现状

测试命令：

```bash
npm test
```

测试覆盖重点：

- chat 状态栏和消息修复。
- REPL stdin handling、输入历史、后台任务 reminder。
- 模型切换。
- 工具确认文案。
- safePath。
- Glob/Read/Write/Edit/Bash/Background/Grep。
- `executeToolCall()`。

修改代码后务必运行 `npm test`。只改文档时可不跑完整测试，但要至少确认文件内容写入正确。

## 当前已知注意点

1. `lib/chat.js` 当前使用 `const maxTurns = opts.maxTurns || 10`，没有读取 `config.getMaxTurns()`，所以配置项 `max_turns` 默认不生效。
2. `lib/system.js` 的 system prompt 缓存只按 cwd，不按工具列表/权限模式。
3. `lib/audit.js` 的审计请求仍会经过 `api.chat()` 自动添加 Pitty 系统提示，审计 system prompt 不是唯一 system prompt。
4. 项目位于共享 root 工作区，不要擅自删除文件、reset、停止服务、覆盖未知改动。
5. 默认权限通常是 `read-only`；需要写文件或执行命令时，用 `--ask`、`--audit` 或 `--accept-all` 启动。
6. `PITTY.md` 会直接影响后续 agent 行为，修改时保持事实准确，不要写临时猜测。
