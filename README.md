# Pitty CLI

> AI 编程助手，在你的终端里 🚀

**Pitty CLI** 是一个基于 OpenAI-compatible Chat Completions API 的交互式编程助手。支持流式输出、函数调用、多 Provider/多模型、权限模式控制，内置文件读写、搜索、Bash 执行等工具。

## 安装

```bash
npm install -g pitty-cli
```

## 快速开始

```bash
# 初始化配置文件
pitty --init
# 编辑 ~/.pitty.ini，填入你的 API Provider 配置

# 启动交互模式
pitty

# 单次问答
pitty --ask "分析一下当前项目的代码结构"

# 管道输入
echo "帮我优化这段代码" | pitty
```

## 配置

编辑 `~/.pitty.ini`：

```ini
main_model = openrouter/qwen3-6b

[provider.openrouter]
api_key = sk-xxx
base_url = https://openrouter.ai/api/v1
models = qwen3-6b, deepseek-chat
```

完整配置项：

| 配置 | 说明 |
|------|------|
| `main_model` | 主模型引用，格式 `provider/model` |
| `permission_mode` | 权限模式：`web-only` / `read-only` / `ask` / `audit` / `accept-all` |
| `max_turns` | 最大对话轮数（默认 100） |
| `max_tokens` | 单次响应最大 tokens（默认 4096） |
| `temperature` | 采样温度（默认 0.6） |

## 权限模式

| 模式 | 说明 |
|------|------|
| `web-only` | 只能抓取网页 |
| `read-only` | 只读文件、搜索代码 |
| `ask` | 写入/执行前需确认 |
| `audit` | 工具调用由审计模型审查 |
| `accept-all` | 危险操作倒计时后自动放行 |

## 命令行选项

```bash
pitty --help                     # 帮助
pitty --init                     # 初始化配置
pitty --system-prompt            # 查看当前系统提示词
pitty --switch-model             # 交互式切换模型
pitty --ask "你的问题"           # 单次问答模式
pitty --accept-all               # 以 accept-all 模式运行
pitty --read-only                # 以 read-only 模式运行
pitty --audit                    # 以 audit 模式运行
```

## 环境变量

- `PITTY_API_KEY` — 覆盖所有 Provider 的 API key
- `PITTY_MODEL_NAME` — 覆盖 `main_model`

## 命令（交互模式）

| 命令 | 说明 |
|------|------|
| `/model` | 选择模型 |
| `/clear` | 清除会话 |
| `/init` | 初始化 PITTY.md |
| `/exit` | 退出 |
| `/help` | 帮助 |

## 技术特点

- 零外部依赖（除 `string-width`）
- 流式 SSE 解析，支持 reasoning / thinking 字段
- 路径安全：阻止敏感目录访问、符号链接绕过
- URL 安全：阻止私有 IP、二进制内容、DNS 解析检查
- 审计模式：自动审查工具调用
- 后台任务：长命令自动转后台运行
- 中英文双语支持

## 许可证

MIT
