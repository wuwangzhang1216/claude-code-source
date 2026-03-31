# 14 - System Prompt 构建深度分析：模型行为的根基

---

## 1. 为什么 System Prompt 值得单独分析

System Prompt 是模型行为的**源头**——模型的每一个决策都受 system prompt 影响。Claude Code 的 system prompt 不是一个静态字符串，而是一个**动态组装**的多模块系统，涉及缓存优化、多源合并、和运行时适配。

---

## 2. 模块化架构

### 2.1 Section 系统

```typescript
// constants/systemPromptSections.ts:20
function systemPromptSection(name: string, compute: () => string) {
  // 缓存 section 的计算结果
  // cache break = false → 结果可被 prompt cache 复用
}

// :32
function DANGEROUS_uncachedSystemPromptSection(name, compute, reason) {
  // cache break = true → 每次重新计算
  // 用于动态变化的内容（如 MCP 服务器连接状态）
}
```

两种 section 的区别：

| 类型 | 缓存行为 | 适用场景 |
|------|----------|----------|
| `systemPromptSection` | 缓存结果，跨 turn 复用 | 静态内容（规则、指令） |
| `DANGEROUS_uncachedSystemPromptSection` | 每次重新计算 | 动态内容（MCP 指令） |

### 2.2 动态边界

```typescript
// constants/prompts.ts:105-115
SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

这个边界将 system prompt 分为两部分：

```
[静态部分 - 全局可缓存]
  ├─ 基础指令
  ├─ 代码风格规则
  ├─ 工具使用指南
  └─ 安全规则
  
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__

[动态部分 - 每 session 不同]
  ├─ 环境信息（CWD、git 状态）
  ├─ Memory 内容
  ├─ MCP 服务器指令
  └─ 用户语言偏好
```

**静态部分**在所有用户、所有 session 间共享 prompt cache。**动态部分**每个 session 不同，但在同一 session 的多个 turn 间可以缓存。

---

## 3. Prompt 组装流程

### 3.1 主函数

```typescript
// constants/prompts.ts:491-577
function getSystemPrompt({
  tools,                        // 可用工具集
  model,                        // 模型 ID
  additionalWorkingDirectories, // 额外工作目录
  mcpClients,                   // MCP 服务器连接
}): SystemPromptSection[] {
  
  return [
    // 静态 sections
    getSimpleIntroSection(),           // "你是一个交互式 agent..."
    getSimpleSystemSection(),          // 系统行为规则
    getSimpleDoingTasksSection(),      // 任务执行指南
    getActionsSection(),               // 风险评估框架
    getUsingYourToolsSection(),        // 工具使用偏好
    getToneAndStyleSection(),          // 语气和风格
    
    // 动态 sections
    systemPromptSection('memory', () => loadMemoryPrompt()),
    systemPromptSection('env_info', () => computeEnvInfo()),
    systemPromptSection('language', () => getLanguageSection()),
    systemPromptSection('output_style', () => getOutputStyleSection()),
    
    // 可能破坏缓存的 sections
    DANGEROUS_uncachedSystemPromptSection(
      'mcp_instructions',
      () => getMcpInstructions(mcpClients),
      'MCP 服务器可能在运行时连接/断开'
    ),
  ]
}
```

### 3.2 Section 解析

```typescript
// systemPromptSections.ts:43
async function resolveSystemPromptSections(sections) {
  const results = []
  for (const section of sections) {
    const content = section.cached 
      ? getCachedOrCompute(section) 
      : section.compute()
    if (content) results.push(content)
  }
  return results.join('\n\n')
}
```

空 section 被跳过——如果没有 MCP 指令、没有语言偏好，对应的 section 就不会出现在 prompt 中。

---

## 4. 核心 Section 详解

### 4.1 Intro Section：角色定义

```
你是一个交互式 agent，帮助用户完成软件工程任务。
使用下面的指令和可用工具来协助用户。
```

还包含：
- 网络安全风险指令（防止 prompt injection）
- 输出风格引用（如果用户配置了）

### 4.2 System Section：系统行为

定义了模型应该如何处理系统级行为：

- **工具执行**：在用户选择的权限模式下执行
- **System Tag 处理**：`<system-reminder>` 等标签的含义
- **Prompt Injection 警告**：工具结果可能包含注入尝试
- **Hook 反馈**：如何解读 hook 的输出
- **自动压缩**：上下文压缩的存在告知

### 4.3 Doing Tasks Section：代码风格

这是 prompt 中最长的 section 之一，定义了 Claude Code 的编码哲学：

```
- 不要过度工程化（no over-engineering）
- 不要添加未请求的功能
- 不要添加不必要的错误处理
- 信任内部代码和框架保证
- 只在系统边界验证（用户输入、外部 API）
- 三行相似代码比过早抽象好
- 不要创建向后兼容 hack
```

### 4.4 Actions Section：风险评估

定义了**可逆性和爆炸半径**评估框架：

```
对于难以逆转、影响共享系统、或可能有风险的操作：
- 破坏性操作：删除文件/分支、drop 数据库表
- 难以逆转：force-push、git reset --hard
- 对他人可见：push 代码、创建 PR、发消息
- 上传到第三方工具
```

### 4.5 Using Your Tools Section：工具偏好

```
- 不要用 Bash 运行 cat/grep/sed，用专用工具（Read/Grep/Edit）
- TodoWrite 追踪进度
- 多个独立工具调用时并行执行
- 有依赖的工具调用顺序执行
```

### 4.6 Environment Info Section：运行时上下文

```typescript
function computeEnvInfo() {
  return `
  - 主工作目录: ${cwd}
  - 是否 Git 仓库: ${isGitRepo}
  - 额外工作目录: ${additionalDirs}
  - 平台: ${platform}
  - Shell: ${shell}
  - OS 版本: ${osVersion}
  - 模型: ${modelDescription}
  - 知识截止: ${knowledgeCutoff}
  `
}
```

---

## 5. 缓存优化

### 5.1 缓存层次

```
Level 1: systemPromptSection 的 memoize 缓存
  └─ 同一 session 内，section 只计算一次

Level 2: Prompt Cache 的静态前缀
  └─ 动态边界之前的内容，跨 API 调用复用

Level 3: Prompt Cache 的动态部分
  └─ 同一 session 内，动态部分也可能被缓存
```

### 5.2 clearSystemPromptSections()

```typescript
// systemPromptSections.ts:65
function clearSystemPromptSections() {
  // 清除所有 memoize 缓存
  // 触发场景: /clear, /compact, MCP 服务器连接变化
}
```

当需要刷新 system prompt 时（如 MCP 服务器列表变化），调用此函数清除缓存，下一次 API 调用会重新计算所有 section。

### 5.3 DANGEROUS_uncachedSystemPromptSection 的代价

MCP 指令被标记为 `DANGEROUS_uncached`，意味着它**每次 API 调用都重新计算**。如果 MCP 服务器频繁连接/断开，这会导致动态部分的 prompt cache 失效。

这是一个有意识的权衡：**正确性优先于缓存效率**。MCP 指令必须反映当前连接状态，即使这意味着更多的 cache miss。

---

## 6. 多源合并

### 6.1 信息来源

System Prompt 的内容来自多个来源：

```
1. 硬编码指令（constants/prompts.ts）
   └─ 角色定义、代码风格、安全规则

2. 用户配置
   ├─ CLAUDE.md 文件（项目级规则）
   ├─ 语言偏好（settings.json）
   └─ 输出风格偏好（settings.json）

3. 运行时上下文
   ├─ 环境信息（CWD、OS、模型）
   ├─ Git 状态
   └─ MCP 服务器连接

4. 记忆系统
   ├─ MEMORY.md（索引）
   └─ 相关记忆（动态选择）

5. 工具描述
   └─ 每个工具的 description()（动态生成）
```

### 6.2 CLAUDE.md 集成

CLAUDE.md 是项目级的规则文件，内容会被注入 system prompt：

```markdown
# CLAUDE.md 示例
- 使用 pnpm 而非 npm
- 测试框架用 vitest
- 提交消息用中文
```

Claude Code 会搜索当前目录及父目录中的 CLAUDE.md，合并后注入。

---

## 7. Agent 特化

### 7.1 不同 Agent 的 Prompt 差异

子 agent 使用**不同的 system prompt**，但共享大部分静态 section：

```
主 agent:
  [所有 section] + [完整工具描述] + [MCP 指令]

Explore agent:
  [基础 section] + [只读工具描述] + [探索专用指令]

Plan agent:
  [基础 section] + [只读工具描述] + [规划专用指令]
```

### 7.2 Proactive/KAIROS 路径

自主 agent 有独立的 prompt 组装路径：

```typescript
// constants/prompts.ts:466-489
if (isProactiveAgent()) {
  return [
    reminders, memory, envInfo, language,
    mcpInstructions, scratchpad, frc, summarization,
    getProactiveSection(),  // 自主行为指南
  ]
}
```

---

## 8. 总结

Claude Code 的 System Prompt 构建不是"写一段提示词"——它是一个**工程系统**：

1. **模块化**——20+ 个 section 独立管理，可缓存/可清除
2. **缓存感知**——动态边界将 prompt 分为可缓存和不可缓存两部分
3. **多源合并**——5 种信息来源动态组装
4. **安全分层**——代码风格、风险评估、prompt injection 防护
5. **适配性**——根据 agent 类型、模型能力、运行时环境调整内容

System Prompt 是 Claude Code 行为的**源代码**——如果 query.ts 是框架的心脏，那 prompts.ts 就是框架的灵魂。
