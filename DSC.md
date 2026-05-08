# DSC - DeepSeek Code CLI 项目分析

## 项目概述
DSC 是一个运行在终端中的 AI 编程助手，基于 DeepSeek API 提供代码辅助功能。用户可以在命令行中与 AI 交互，AI 能够使用多种工具来帮助完成编程任务。

## 项目结构

```
/root/apps/dsc/
├── dsc.js                 # 主入口文件
├── package.json           # 项目配置
├── lib/
│   ├── api.js             # DeepSeek API 调用封装
│   ├── chat.js            # 对话管理与主循环
│   ├── config.js          # 配置加载与管理
│   ├── logger.js          # 日志记录
│   ├── system.js          # 系统提示构建
│   ├── tools.js           # 工具管理与执行
│   └── tools/             # 各个工具的实现
│       ├── bash.js        # 执行 shell 命令
│       ├── read.js        # 读取文件
│       ├── write.js       # 写入文件
│       ├── edit.js        # 精确编辑文件
│       ├── glob.js        # 搜索文件
│       ├── grep.js        # 搜索文件内容
│       └── webFetch.js    # 获取网页内容
└── DSC.md                 # 本文件 - 项目分析备忘
```

## 核心模块说明

### 1. dsc.js - 主入口
- 处理命令行参数，支持三种模式：
  - 交互式 REPL 模式 (`dsc`)
  - 单次提问模式 (`dsc "your prompt"`)
  - 管道模式 (`echo "prompt" | dsc`)
- 提供 `--help` 和 `--init` 命令
- 检查 API key 是否配置正确
- REPL 内置命令: `/clear`, `/exit`, `/help`

### 2. config.js - 配置管理
- 配置文件位置: `~/.dsc.json`
- 默认配置:
  ```json
  {
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "maxTokens": 4096,
    "maxContext": 256000,
    "temperature": 0,
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
- 支持通过环境变量 `DEEPSEEK_API_KEY` 设置 API key

### 3. api.js - API 调用
- 使用流式响应 (SSE) 处理 DeepSeek 聊天补全 API
- 动态构建系统提示词，基于当前启用的工具
- 支持 reasoning_content 推理内容的单独处理
- 正确处理增量工具调用
- 记录请求和响应日志

### 4. chat.js - 对话主循环
- 实现 markdown 在终端中的彩色渲染
- 状态栏显示当前状态和 token 使用情况
- 支持多轮工具调用循环，默认最大 15 轮
- 格式化工具调用结果，超长内容自动截断
- 统计 token 使用量，显示上下文占用比例

### 5. system.js - 系统提示构建
- 动态生成系统提示词，包含以下部分：
  - 身份介绍
  - 系统信息
  - 执行任务指南
  - 操作安全规范
  - 工具使用规则
  - 语气风格要求
  - 当前环境信息

### 6. tools.js - 工具管理
- 统一管理所有工具，根据配置启用/禁用工具
- 提供工具列表给 API
- 统一执行工具调用，处理参数解析和错误

## 可用工具

| 工具名 | 功能 | 说明 |
|--------|------|------|
| **Bash** | 执行 shell 命令 | 用于运行命令、脚本和 CLI 工具，默认超时 30s |
| **Read** | 读取文件内容 | 支持指定起始行和读取行数，优先使用专用工具而不是 cat |
| **Write** | 写入文件 | 创建新文件或覆盖已有文件 |
| **Edit** | 精确编辑 | 通过匹配精确字符串进行替换，适合做局部修改 |
| **Glob** | 搜索文件 | 使用 glob 模式匹配文件，代替 find/ls |
| **Grep** | 搜索内容 | 正则搜索文件内容，代替 grep/rg |
| **WebFetch** | 网页获取 | 获取 URL 的文本内容 |

## 工具实现特点

每个工具都遵循相同的结构：
```javascript
module.exports = {
  name: 'ToolName',
  description: '工具描述',
  inputSchema: { /* JSON Schema for OpenAI function call */ },
  async execute(args) { /* 执行逻辑，返回结果 */ }
}
```

## 使用方式

```bash
# 初始化配置
dsc --init

# 编辑配置文件添加 API key
vim ~/.dsc.json

# 开始交互式会话
dsc

# 单次提问
dsc "如何修复这个 npm 错误?"

# 管道输入
cat error.txt | dsc "帮我分析这个错误"
```

## 项目特点

1. **纯 Node.js 实现** - 不需要额外的运行时依赖
2. **工具调用支持** - AI 可以直接操作文件和执行命令
3. **流式输出** - 实时显示 AI 响应
4. **终端美化** - 支持 markdown 彩色渲染
5. **可配置** - 可单独启用/禁用每个工具
6. **符合安全规范** - 对危险操作有提醒，要求用户确认
