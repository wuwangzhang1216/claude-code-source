# 15 - Session Resume 与 Bridge 深度分析：持久化与 IDE 集成

---

## 1. 两大子系统

Session Resume 和 Bridge 是两个相关但独立的系统：

- **Session Resume**：会话持久化和崩溃恢复——让 Claude Code 能从中断处继续
- **Bridge**：CLI/终端与 VS Code 扩展的双向通信——让 Claude Code 能在 IDE 中运行

---

## 2. Session Resume：WAL 式持久化

### 2.1 Transcript 存储

每个会话的消息以 **JSONL**（JSON Lines）格式持久化：

```
文件: ~/.claude/projects/{project-hash}/sessions/{session-id}.jsonl

每行一条消息:
{"type":"user","uuid":"abc","content":"帮我修改 app.ts",...}
{"type":"assistant","uuid":"def","content":[...],...}
{"type":"attachment","uuid":"ghi","attachment":{...},...}
```

### 2.2 什么会被持久化

| 消息类型 | 持久化 | 原因 |
|---------|--------|------|
| UserMessage | 是 | 用户输入和工具结果 |
| AssistantMessage | 是 | 模型响应 |
| AttachmentMessage | 是 | 记忆和技能上下文 |
| SystemMessage | 是 | 压缩边界、错误等 |
| ProgressMessage | **否** | 临时进度，恢复时无意义 |
| TombstoneMessage | **否** | 已处理的撤回 |

### 2.3 消息链重建

消息通过 `parentUuid` 链接，形成因果链：

```
UserMessage(uuid: "a")
  → AssistantMessage(uuid: "b", parentUuid: "a")
    → UserMessage(uuid: "c", parentUuid: "b")  // tool_result
      → AssistantMessage(uuid: "d", parentUuid: "c")
```

恢复时，通过 `parentUuid` 重建完整的消息树。

### 2.4 文件历史快照

除了消息，还持久化了**文件修改历史**：

```jsonl
{"type":"file_history_snapshot","files":{"src/app.ts":"原始内容..."}}
{"type":"attribution_snapshot","attributions":{...}}
```

这些快照支持 `/undo` 功能——即使 Claude Code 重启后，也能回退到之前的文件状态。

---

## 3. 崩溃恢复流程

### 3.1 恢复入口

```typescript
// utils/sessionRestore.ts:主函数
async function processResumedConversation({
  sessionId,
  transcriptMessages,
  appState,
}) {
  // 1. 恢复文件历史
  restoreFileHistoryFromLog(transcriptMessages)
  
  // 2. 恢复 attribution 状态
  restoreAttributionFromSnapshots(transcriptMessages)
  
  // 3. 恢复 TodoWrite 状态
  restoreTodoState(transcriptMessages)
  
  // 4. 恢复 agent 设置
  restoreAgentSettings(transcriptMessages)
  
  // 5. 恢复 worktree（如果在 worktree 中崩溃）
  restoreWorktreeForResume(transcriptMessages)
  
  // 6. 切换 session ID
  switchSession(sessionId)
  
  // 7. 恢复成本追踪
  restoreCostStateForSession(sessionId)
}
```

### 3.2 Worktree 恢复

如果 Claude Code 在 worktree 中崩溃了：

```typescript
// sessionRestore.ts:332-366
async function restoreWorktreeForResume(messages) {
  // 扫描消息历史，找到最后一次 EnterWorktree
  const lastWorktreeEntry = findLastWorktreeEntry(messages)
  
  if (lastWorktreeEntry && !hasMatchingExit(lastWorktreeEntry)) {
    // 崩溃时在 worktree 中
    // → cd 回 worktree 目录
    process.chdir(lastWorktreeEntry.worktreePath)
  }
}
```

### 3.3 TodoWrite 恢复

```typescript
// sessionRestore.ts:77-93
function restoreTodoState(messages) {
  // 从后往前扫描，找到最后一次 TodoWrite 工具调用
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isToolUse(messages[i], 'TodoWrite')) {
      return messages[i].input  // 最后一次的 todo 列表
    }
  }
  return null  // 没有 todo
}
```

---

## 4. 并发 Session 管理

### 4.1 Session 注册

每个运行中的 Claude Code 实例在文件系统中注册自己：

```typescript
// utils/concurrentSessions.ts:59-109
function registerSession() {
  const pidFile = `~/.claude/sessions/${process.pid}.json`
  writeFileSync(pidFile, JSON.stringify({
    pid: process.pid,
    sessionId: currentSessionId,
    cwd: process.cwd(),
    startTime: Date.now(),
    name: sessionName,
  }))
}
```

### 4.2 实时状态更新

```typescript
// 更新活动状态（供 `claude ps` 显示）
updateSessionActivity({
  lastActivity: Date.now(),
  currentTool: 'Bash(npm install)',
  status: 'executing',
})
```

### 4.3 过期清理

```typescript
// countConcurrentSessions.ts:168-204
function countConcurrentSessions() {
  const pidFiles = readdir('~/.claude/sessions/')
  let liveCount = 0
  
  for (const file of pidFiles) {
    const { pid } = JSON.parse(readFileSync(file))
    if (isProcessRunning(pid)) {
      liveCount++
    } else {
      // 进程已死，清理 PID 文件
      unlinkSync(file)
    }
  }
  
  return liveCount
}
```

---

## 5. Bridge 系统：IDE 集成

### 5.1 架构概览

```
VS Code Extension
  │
  ├─ WebSocket / SSE 连接
  │
  ▼
Bridge Server (bridgeMain.ts)
  │
  ├─ 消息路由
  │
  ▼
Claude Code CLI (replBridge.ts)
  │
  ├─ QueryEngine
  │
  ▼
Agent 执行
```

### 5.2 两代 Transport

**v1: WebSocket + POST**

```
读取: WebSocket 长连接接收消息
写入: HTTP POST 发送工具结果
```

**v2: SSE + CCR**

```
读取: SSE (Server-Sent Events) 流式接收
写入: CCR (Claude Code Remote) Client 事件推送
序列号: 支持安全重连（无需全量重放）
```

v2 的序列号机制是关键改进——重连时只需要从断点处继续，而不是重放整个 session。

### 5.3 消息流

```
用户在 VS Code 中输入
  → Extension 封装为控制请求
    → Transport 传输到 CLI
      → replBridge.ts 解析
        → handleIngressMessage()
          → 路由到 QueryEngine
            → Agent 执行
              → 结果通过 Transport 回传
                → Extension 渲染到 UI
```

### 5.4 Bridge 状态机

```
ready → connected → (通信中) → disconnected → reconnecting → connected
                                    │
                                    └→ failed (超过重试次数)
```

重连使用**指数退避**，最多 5 次尝试。

### 5.5 控制请求类型

Bridge 支持多种控制请求：

| 请求类型 | 方向 | 用途 |
|---------|------|------|
| 模型切换 | Extension → CLI | 用户切换模型 |
| 权限审批 | Extension → CLI | 用户在 IDE 中审批权限 |
| 取消请求 | Extension → CLI | 用户按 ESC |
| 进度更新 | CLI → Extension | 工具执行进度 |
| 消息输出 | CLI → Extension | 模型响应 |
| 状态同步 | 双向 | Bridge 连接状态 |

### 5.6 远程权限桥接

```typescript
// bridge/remotePermissionBridge.ts
// 当 CLI 需要权限确认，但 UI 在 VS Code Extension 中时
// 权限请求通过 bridge 发到 Extension
// Extension 显示确认对话框
// 用户的选择通过 bridge 回传到 CLI
```

这确保了即使 CLI 在后台运行（没有终端 UI），权限确认仍然能通过 IDE 界面进行。

---

## 6. Session 创建和归档

### 6.1 创建

```typescript
// bridge/createSession.ts
async function createSession(bridgeConfig) {
  const response = await fetch('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      environment_id: bridgeConfig.environmentId,
      title: deriveTitle(messages),
    })
  })
  return response.json()  // { session_id, ... }
}
```

### 6.2 标题更新

Session 标题是**延迟生成**的——第一轮对话完成后，根据内容自动生成标题：

```
用户: "帮我修复 auth 模块的 JWT 过期 bug"
  → 自动标题: "修复 JWT 过期 bug"
```

### 6.3 归档

完成或超时的 session 被归档：

```typescript
// 状态: 'completed' | 'failed' | 'interrupted'
archiveSession(sessionId, { status: 'completed' })
```

---

## 7. 可信设备

### 7.1 设备信任

```typescript
// bridge/trustedDevice.ts
// Bridge 连接需要设备信任验证
// 防止未授权设备通过 bridge 控制 Claude Code
```

设备信任确保了只有用户自己的设备（或用户明确授权的设备）能通过 bridge 连接到 Claude Code。

---

## 8. 总结

Session Resume 和 Bridge 系统解决了两个核心问题：

**Session Resume** 回答了："如果 Claude Code 崩溃了怎么办？"
- JSONL transcript 提供了 WAL 式的持久化
- 消息链通过 parentUuid 重建
- 文件历史快照支持 /undo
- Worktree 和 todo 状态自动恢复

**Bridge** 回答了："如何在 IDE 中使用 Claude Code？"
- 双向通信连接 CLI 和 VS Code Extension
- 两代 transport（WebSocket → SSE+CCR）不断优化
- 权限请求透明桥接到 IDE 界面
- 序列号机制支持安全重连

这两个系统合在一起，让 Claude Code 从一个"终端工具"升级为一个**持久化的、跨界面的编程环境**。
