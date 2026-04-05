<p align="center">
  <img src="assets/anthropic-claude-code.webp" alt="Claude Code" width="100%">
</p>

<h1 align="center">Claude Code 源码 — 架构研究与学习资料</h1>

<p align="center">
  <strong>生产级 AI Agent 内部实现，为学习而解剖。</strong>
</p>

<p align="center">
  <a href="https://github.com/anthropics/claude-code"><img src="https://img.shields.io/badge/Claude_Code-v2.1.89-6B4FBB?style=for-the-badge" alt="Claude Code v2.1.89"></a>
  <a href="#版权声明"><img src="https://img.shields.io/badge/License-Educational_Only-red?style=for-the-badge" alt="Educational Only"></a>
  <a href="#深度分析系列"><img src="https://img.shields.io/badge/Articles-18_Deep_Dives-blue?style=for-the-badge" alt="18 Articles"></a>
  <a href="#从源码运行"><img src="https://img.shields.io/badge/Status-Runnable-brightgreen?style=for-the-badge" alt="Runnable"></a>
</p>

<p align="center"><b><a href="README.md">English</a></b></p>

---

本仓库包含 [Claude Code](https://claude.ai/code)（Anthropic 的 AI 编程 CLI）的**提取源代码**，以及 **18 篇原创深度分析文章**（中英双语）对其架构进行全面拆解。源代码来自公开渠道，**严格仅供学习和研究用途**。

源代码的所有知识产权完全归 **Anthropic, PBC** 所有。

> **跟随官方更新，保持最新版本。** 本仓库跟随 Claude Code 官方发布节奏，始终与最新版本保持同步。官方每次发布新版本后，我们都会针对其 changelog 中面向用户、可落地的部分进行对应更新。每个版本的具体变更记录（包括本仓库已应用的改动和仅存在于官方的改动）请见 [`CHANGELOG.md`](CHANGELOG.md)。

---

[免责声明](#免责声明) · [为什么研究](#为什么研究这个代码库) · [架构总览](#架构总览) · [深度分析](#深度分析系列) · [从源码运行](#从源码运行) · [技术栈](#技术栈) · [项目结构](#项目结构) · [版权声明](#版权声明)

---

## 免责声明

> **重要：使用前请阅读**

**本仓库严格仅供学习和研究用途。**

- **来源**：本仓库引用的源代码来自公开渠道，包括 [instructkr/claw-code](https://github.com/instructkr/claw-code)。从源码运行的配置基于 [JiaranI/start-claude-code](https://github.com/JiaranI/start-claude-code)。其中包含 [Anthropic](https://anthropic.com) 公司的 [Claude Code](https://claude.ai/code) 产品的源代码。
- **知识产权**：源代码的所有知识产权完全归 **Anthropic, PBC** 所有。本仓库不主张对原始代码的任何所有权、著作权或权利。
- **用途**：本仓库**仅**作为学习材料提供，用于理解 AI Agent 系统架构和工程设计模式，面向学术研究、技术学习和教育讨论。
- **禁止用途**：本仓库及其内容**不得**用于：
  - 任何形式的商业用途
  - 构建竞品产品或服务
  - 再分发或重新打包源代码
  - 任何违反 Anthropic [服务条款](https://www.anthropic.com/terms) 或适用法律的行为
- **分析文章**：深度分析文章（`claude-code-deep-analysis/`）是仓库维护者撰写的**原创评论和分析**。文章中包含的代码片段用于评论、批评和教育目的，但这些文章不构成法律建议。
- **侵权处理**：如您是 Anthropic 的代表或认为本仓库侵犯了任何知识产权，请联系我们，我们将**立即删除**相关内容。您也可以通过 [GitHub 的 DMCA 流程](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy) 提交侵权通知。
- **免责条款**：本仓库按"现状"提供，不附带任何形式的保证。维护者不对因使用本材料而产生的任何后果承担责任。

---

## 为什么研究这个代码库？

Claude Code 是目前可公开观察到的最复杂的生产级 AI Agent 系统之一。与玩具框架和演示 Agent 不同，它为**真实世界的数小时编程会话**而设计，具备企业级可靠性。研究它能揭示任何教程都不会教的实战工程决策：

| 设计决策 | 洞察 |
|:---|:---|
| **循环优于图** | 用 `while(true)` 循环取代 DAG 工作流编排——更简单、更灵活、运行时更易推理 |
| **递归优于编排** | 子 Agent 递归调用 `query()`，自动继承压缩、错误恢复和流式处理 |
| **模型做决策，框架做执行** | 框架负责安全约束（并发、副作用、权限），所有推理留在模型中 |
| **为 4 小时会话而设计** | 四层上下文压缩和三级 413 错误恢复——在演示中看不见，在生产中不可或缺 |
| **不可变性即成本优化** | 不可变 API 消息最大化 prompt caching 命中率，长会话成本降低约 80% |

---

## 架构总览

```
                        CLI / VS Code / IDE 扩展
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   入口 (cli.tsx)        │
                        │   快速路径路由           │
                        └───────────┬───────────┘
                                    │
                        ┌───────────▼───────────┐
                        │     QueryEngine         │
                        │   会话管理               │
                        │   API 客户端封装         │
                        └───────────┬───────────┘
                                    │
                ┌───────────────────▼───────────────────┐
                │        query() — 核心 Agent 循环       │
                │   ┌─────────────────────────────────┐  │
                │   │  while (true) {                 │  │
                │   │    messages = buildPrompt()      │  │
                │   │    response = stream(messages)   │  │
                │   │    tools = extractToolCalls()    │  │
                │   │    if (!tools) break             │  │
                │   │    results = executePar(tools)   │  │
                │   │    messages.push(results)        │  │
                │   │    maybeCompress(messages)       │  │
                │   │  }                              │  │
                │   └─────────────────────────────────┘  │
                └──────┬──────────┬──────────┬──────────┘
                       │          │          │
              ┌────────▼──┐ ┌────▼────┐ ┌───▼────────┐
              │ 45+ 工具   │ │ 权限    │ │ 上下文     │
              │ Bash, Edit │ │ 系统    │ │ 压缩       │
              │ Glob, Grep │ │ 5 种    │ │ 4 层       │
              │ MCP, LSP…  │ │ 模式    │ │ + 413 恢复 │
              └────────────┘ └─────────┘ └────────────┘
```

### 关键指标

| 指标 | 数量 |
|:---|:---|
| 核心 Agent 循环 (`query.ts`) | 1,729 行 |
| 主 UI 组件 (`main.tsx`) | 4,683 行 |
| 工具实现 | 45+ |
| Slash 命令 | 87+ |
| React UI 组件 | 146+ |
| 工具函数 | 564+ |
| React Hooks | 85+ |
| 服务模块 | 38 |
| Feature Flag | 89 |
| System Prompt 组装 (`prompts.ts`) | 54.3 KB |

---

## 深度分析系列

我们撰写了 **18 篇原创文章**，对每个核心子系统进行源码级深度拆解。每篇文章均提供**中文**和**英文**版本。

**[进入分析系列 (中文) →](claude-code-deep-analysis/README.md)** ｜ **[Enter the analysis series (EN) →](claude-code-deep-analysis/README.en.md)**

### Part 1：核心 Agent 引擎

| # | 主题 | 中文 | English |
|:--|:------|:-----|:--------|
| 00 | 核心结论 | [中文](claude-code-deep-analysis/00-core-conclusion.md) | [EN](claude-code-deep-analysis/00-core-conclusion.en.md) |
| 01 | 入口流程 | [中文](claude-code-deep-analysis/01-entry-point.md) | [EN](claude-code-deep-analysis/01-entry-point.en.md) |
| 02 | 主循环 | [中文](claude-code-deep-analysis/02-main-loop.md) | [EN](claude-code-deep-analysis/02-main-loop.en.md) |
| 03 | 流式处理 | [中文](claude-code-deep-analysis/03-streaming.md) | [EN](claude-code-deep-analysis/03-streaming.en.md) |
| 04 | 工具编排 | [中文](claude-code-deep-analysis/04-tool-orchestration.md) | [EN](claude-code-deep-analysis/04-tool-orchestration.en.md) |
| 05 | 权限系统 | [中文](claude-code-deep-analysis/05-permission-system.md) | [EN](claude-code-deep-analysis/05-permission-system.en.md) |
| 06 | 子Agent | [中文](claude-code-deep-analysis/06-sub-agent.md) | [EN](claude-code-deep-analysis/06-sub-agent.en.md) |
| 07 | 上下文窗口 | [中文](claude-code-deep-analysis/07-context-window.md) | [EN](claude-code-deep-analysis/07-context-window.en.md) |
| 08 | 消息类型 | [中文](claude-code-deep-analysis/08-message-types.md) | [EN](claude-code-deep-analysis/08-message-types.en.md) |
| 09 | 不可变消息 | [中文](claude-code-deep-analysis/09-immutable-api-messages.md) | [EN](claude-code-deep-analysis/09-immutable-api-messages.en.md) |
| 10 | 架构图 | [中文](claude-code-deep-analysis/10-architecture-diagram.md) | [EN](claude-code-deep-analysis/10-architecture-diagram.en.md) |
| 11 | 设计哲学 | [中文](claude-code-deep-analysis/11-design-philosophy.md) | [EN](claude-code-deep-analysis/11-design-philosophy.en.md) |

### Part 2：外围子系统

| # | 主题 | 中文 | English |
|:--|:------|:-----|:--------|
| 12 | MCP 集成 | [中文](claude-code-deep-analysis/12-mcp-integration.md) | [EN](claude-code-deep-analysis/12-mcp-integration.en.md) |
| 13 | Memory 系统 | [中文](claude-code-deep-analysis/13-memory-system.md) | [EN](claude-code-deep-analysis/13-memory-system.en.md) |
| 14 | System Prompt | [中文](claude-code-deep-analysis/14-system-prompt.md) | [EN](claude-code-deep-analysis/14-system-prompt.en.md) |
| 15 | Session 与 Bridge | [中文](claude-code-deep-analysis/15-session-resume.md) | [EN](claude-code-deep-analysis/15-session-resume.en.md) |
| 16 | 工具实现 | [中文](claude-code-deep-analysis/16-tool-implementations.md) | [EN](claude-code-deep-analysis/16-tool-implementations.en.md) |
| 17 | Hook 系统 | [中文](claude-code-deep-analysis/17-hook-system.md) | [EN](claude-code-deep-analysis/17-hook-system.en.md) |

---

## 从源码运行

本仓库支持从源码本地启动 Claude Code（功能有所缩减）。已验证可成功运行，版本号 `2.1.89`。

### 环境要求

| 依赖 | 说明 |
|:---|:---|
| **Node.js** >= 18 | 运行 setup 脚本 |
| **Bun** >= 1.0 | 运行 Claude Code（setup 脚本会自动安装） |
| **认证方式** | Claude Pro/Max/Team 订阅（OAuth）**或** API Key（`sk-ant-xxx`） |

### 快速开始

```bash
# 1. 安装依赖并设置 shim
node scripts/setup.mjs

# 2. 使用 Claude 订阅账号登录（会打开浏览器）
./start.sh login

# 3. 启动
./start.sh
```

<p align="center">
  <img src="assets/screenshot.png" alt="使用订阅登录运行 Claude Code" width="100%">
  <br>
  <em>使用 Claude Pro/Max 订阅从源码运行 — Opus 4.6 (1M context) ✓</em>
</p>

<details>
<summary><strong>备选方案：使用 API Key</strong></summary>

```bash
export ANTHROPIC_API_KEY="sk-ant-xxx"
./start.sh
```

</details>

<details>
<summary><strong>Windows 用户</strong></summary>

```cmd
rem Windows 下使用 API Key（OAuth 登录需要 macOS/Linux 的 start.sh）
set ANTHROPIC_API_KEY=sk-ant-xxx
bun src/entrypoints/cli.tsx
```

- **ripgrep**：setup 脚本中的 tar 解压在 Windows 上可能失败。请手动安装 [ripgrep](https://github.com/BurntSushi/ripgrep/releases) 并确保 `rg` 在 PATH 中。
- **Bun 路径**：安装 Bun 后需要重启终端，或手动将 `%USERPROFILE%\.bun\bin` 添加到 PATH。
- **OAuth 登录**：`./start.sh login` 仅适用于 macOS/Linux。Windows 下运行 `bun src/entrypoints/cli.tsx auth login --claudeai`。

</details>

### 创建的 Shim 文件

以下文件是为了让源码可运行而创建的，**不属于原始源码**：

| 文件 | 作用 |
|:---|:---|
| `package.json` | 从 import 语句逆向工程出的 100+ 依赖声明 |
| `tsconfig.json` | TypeScript 配置，含 `baseUrl` 和 `.js → .ts/.tsx` 路径解析 |
| `bunfig.toml` | Bun 配置，指定 preload 插件 |
| `preload.ts` | 核心 shim：`bun:bundle` 模拟（`feature()` 返回 `false`）、`MACRO.*` 全局变量注入 |
| `scripts/setup.mjs` | 一键安装：依赖安装、私有包 stub、缺失文件生成、ripgrep 下载 |
| `start.sh` | macOS/Linux 启动脚本，支持 OAuth 登录（`./start.sh login`）、多种凭证检测（Keychain/文件/环境变量）、第三方代理自动检测 |

### 工作原理

| 问题 | 解决方案 |
|:---|:---|
| `bun:bundle` 编译时 API | `preload.ts` 提供运行时 shim，`feature()` 全部返回 `false` |
| 89 个 Feature Flag | 全部禁用（所有 feature-gated 代码路径不执行） |
| `MACRO.*` 编译时宏 | `preload.ts` 中定义为 `globalThis.MACRO` 全局变量 |
| `from 'src/...'` 导入 | 源码放在 `src/` 目录下，`tsconfig.json` 中 `baseUrl: "."` 使路径自然解析 |
| 无 `package.json` | 已从 import 语句逆向工程出 100+ 依赖 |
| `@ant/*` 内部包 | `scripts/setup.mjs` 创建空实现 stub |

### 不可用的功能（缺失私有包）

| 功能 | 缺失的包 | 说明 |
|:---|:---|:---|
| Computer Use（电脑操控） | `@ant/computer-use-mcp` | 截屏、鼠标点击、键盘输入等 |
| 原生键鼠输入 | `@ant/computer-use-input` | Rust/enigo 原生绑定 |
| macOS 截屏/窗口管理 | `@ant/computer-use-swift` | Swift 原生绑定，仅 macOS |
| Chrome 浏览器集成 | `@ant/claude-for-chrome-mcp` | Chrome 扩展 MCP server |
| 沙箱运行时 | `@anthropic-ai/sandbox-runtime` | 命令执行沙箱 |
| MCP Bridge | `@anthropic-ai/mcpb` | MCP 协议桥接 |

<details>
<summary><strong>所有 89 个 Feature Flag（全部禁用）</strong></summary>

由于 `feature()` 在运行时返回 `false`，以下功能全部被禁用：

`ABLATION_BASELINE` `AGENT_MEMORY_SNAPSHOT` `AGENT_TRIGGERS` `BRIDGE_MODE` `BUDDY` `BUILDING_CLAUDE_APPS` `CCR_AUTO_CONNECT` `COORDINATOR_MODE` `DAEMON` `DIRECT_CONNECT` `DUMP_SYSTEM_PROMPT` `FORK_SUBAGENT` `HISTORY_PICKER` `KAIROS` `MCP_SKILLS` `MONITOR_TOOL` `NATIVE_CLIPBOARD_IMAGE` `PERFETTO_TRACING` `QUICK_SEARCH` `SSH_REMOTE` `STREAMLINED_OUTPUT` `TEAMMEM` `TEMPLATES` `TERMINAL_PANEL` `TORCH` `ULTRAPLAN` `ULTRATHINK` `VOICE_MODE` `WEB_BROWSER_TOOL` `WORKFLOW_SCRIPTS` 等共 89 个。

</details>

### 构建流程推断

```
TypeScript 源码
  │
  ├─ Bun bundler (bun build)
  │   ├─ 注入 MACRO.* 常量 (--define)
  │   ├─ 解析 feature() 调用 → 设置 89 个 feature flag 的 true/false
  │   ├─ Dead Code Elimination → 移除未启用 feature 的代码分支
  │   └─ 打包为单文件 JS bundle
  │
  ├─ 可选：Bun compile → 编译为单文件可执行二进制
  │
  └─ 发布到 npm (@anthropic-ai/claude-code)
```

### 故障排查

| 错误 | 解决方案 |
|:---|:---|
| `Cannot find module 'src/...'` | 确认源码在 `src/` 目录下，且 `bunfig.toml` 存在 |
| `Missing 'default' export in module '*.md'` | 运行 `node scripts/setup.mjs` 重新生成缺失的 stub 文件 |
| `Cannot find package '@ant/...'` | 运行 `node scripts/setup.mjs` 重新创建 stub |
| `bun: command not found` | 安装 Bun：`curl -fsSL https://bun.sh/install \| bash`（或重启终端） |
| `No authentication found` | 运行 `./start.sh login` 使用 OAuth 登录，或 `export ANTHROPIC_API_KEY="sk-ant-xxx"` 使用 API Key |
| 使用非 Anthropic 代理 | `start.sh` 会自动检测并设置；手动启动时需设置 `DISABLE_PROMPT_CACHING=1` 和 `DISABLE_INTERLEAVED_THINKING=1` |

### 如果你想运行官方版本

```bash
npm install -g @anthropic-ai/claude-code
```

---

## 技术栈

| 层次 | 技术 |
|:---|:---|
| **运行时** | Node.js >= 18, Bun >= 1.0 |
| **语言** | TypeScript + React JSX |
| **UI** | React 19，自定义终端渲染器，146+ 组件 |
| **CLI** | Commander.js 12 |
| **AI/LLM** | Anthropic SDK, Claude Agent SDK, AWS Bedrock, Azure Identity |
| **协议** | Model Context Protocol (MCP, 6 种传输), LSP, OAuth/XAA |
| **可观测性** | OpenTelemetry (traces, metrics, logs) + OTLP 导出器 |
| **代码工具** | ripgrep, Sharp (图片处理), Marked, Turndown, Diff |

---

## 项目结构

```
claude-code-source/
├── README.md                         # English documentation
├── README.zh.md                      # 本文档（中文）
├── assets/                           # 图片资源
│   ├── anthropic-claude-code.webp
│   └── screenshot.png
├── package.json                      # 依赖声明（逆向工程）
├── tsconfig.json                     # TypeScript 配置
├── bunfig.toml                       # Bun preload 配置
├── preload.ts                        # 运行时 shim（feature flag、宏）
├── start.sh                          # 启动脚本
├── scripts/setup.mjs                 # 一键安装脚本
│
├── claude-code-deep-analysis/        # 18 篇原创分析文章（中文 + EN）
│   ├── README.md                     #   系列索引（中文）
│   ├── README.en.md                  #   系列索引（English）
│   ├── 00-core-conclusion.md         #   每篇文章有 .md + .en.md
│   ├── 00-core-conclusion.en.md
│   ├── ...
│   └── 17-hook-system.en.md
│
└── src/                              # Claude Code 源码（Anthropic）
    ├── query.ts                      # 核心 Agent 循环（1,729 行）
    ├── QueryEngine.ts                # 会话管理（46.6 KB）
    ├── Tool.ts                       # 工具接口与注册（29.5 KB）
    ├── main.tsx                      # 主 React 组件（4,683 行）
    │
    ├── entrypoints/                  # 入口文件（CLI、MCP、SDK 类型）
    ├── commands/                     # 87+ slash 命令
    ├── tools/                        # 45+ 工具实现
    │   ├── BashTool/                 #   Shell 执行（430 KB 安全代码）
    │   ├── AgentTool/                #   子 Agent 执行
    │   ├── FileEditTool/             #   文件编辑与 diff 匹配
    │   ├── MCPTool/                  #   Model Context Protocol
    │   └── ...                       #   30+ 更多工具
    │
    ├── services/                     # 38 个服务模块
    │   ├── api/                      #   Anthropic API 集成
    │   ├── mcp/                      #   MCP 协议（25 个子目录）
    │   ├── compact/                  #   上下文压缩
    │   ├── SessionMemory/            #   跨会话记忆
    │   └── ...
    │
    ├── components/                   # 146+ React UI 组件
    ├── hooks/                        # 85+ React Hooks
    ├── utils/                        # 564+ 工具函数
    ├── permissions/                  # 权限系统（5 种模式）
    ├── bridge/                       # CLI ↔ VS Code 集成
    ├── constants/                    # System Prompt 组装与配置
    ├── memdir/                       # 跨会话记忆系统
    ├── skills/                       # Skill/插件系统
    ├── voice/                        # 语音输入处理
    └── ...
```

---

## 版权声明

- **源代码**：所有权利归 **Anthropic, PBC** 所有。不授予任何许可。
- **分析文章**（`claude-code-deep-analysis/`）：仓库维护者的原创评论和分析。代码片段仅用于教育目的。

**联系方式**：如有任何问题，请通过 GitHub Issues 联系。
