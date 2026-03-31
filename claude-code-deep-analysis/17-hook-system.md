# 17 - Hook 系统深度分析：用户可编程的生命周期

---

## 1. 什么是 Hook

Hook 是用户定义的**生命周期回调**——在 Claude Code 执行过程中的关键时刻触发。它们让用户可以：

- 每次文件修改后自动运行 lint
- 在执行危险命令前做额外检查
- 在 turn 结束后自动提交代码
- 阻止某些操作（比如禁止修改 production 配置）

**重要区分**：这里的 Hook 是 `utils/hooks/` 下的**生命周期 Hook 系统**，不是 React hooks（`hooks/` 目录）。

---

## 2. Hook 事件类型

### 2.1 完整事件列表

| 事件 | 触发时机 | 可阻断？ |
|------|---------|---------|
| `UserPromptSubmit` | 用户输入发送前 | 是 |
| `PreToolUse` | 工具执行前 | 是 |
| `PostToolUse` | 工具成功执行后 | 是（注入反馈） |
| `PostToolUseFailure` | 工具执行失败后 | 否 |
| `Stop` | turn 正常结束时 | 是（继续对话） |
| `StopFailure` | turn 因错误结束时 | 否（fire-and-forget） |
| `SessionStart` | 会话开始/恢复时 | 否 |
| `SubagentStart` | 子 agent 启动时 | 否 |
| `SubagentStop` | 子 agent 结束时 | 否 |
| `PreCompact` | 上下文压缩前 | 否 |
| `PostCompact` | 上下文压缩后 | 否 |
| `PermissionDenied` | 权限被拒绝时 | 否 |
| `Notification` | 通知事件 | 否 |

### 2.2 Matcher 过滤

每个事件类型有不同的 matcher 字段：

```
PreToolUse/PostToolUse → 按 tool_name 过滤
  例: 只在 Bash 工具时触发

PermissionDenied → 按 tool_name 过滤

Notification → 按 notification_type 过滤

SessionStart → 按 source 过滤
  source: 'startup' | 'resume' | 'clear' | 'compact'

SubagentStart/Stop → 按 agent_type 过滤
```

---

## 3. Hook 配置

### 3.1 settings.json 格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'About to run Bash'",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "FileEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx eslint --fix $EDITED_FILE",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查是否所有修改的文件都有对应的测试。$ARGUMENTS"
          }
        ]
      }
    ]
  }
}
```

### 3.2 Hook 类型

| 类型 | 执行方式 | 适用场景 |
|------|---------|---------|
| `command` | Shell 命令 | lint、测试、git 操作 |
| `prompt` | Haiku 模型评估 | 代码审查、规范检查 |
| `agent` | 多轮 agent 执行 | 复杂验证（最多 50 轮） |
| `http` | HTTP POST | 外部服务集成 |
| `function` | TypeScript 回调（session-only） | 编程式验证 |

### 3.3 条件执行

`if` 字段支持权限规则模式匹配：

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "check-git-safety.sh",
      "if": "Bash(git push *)"
    }
  ]
}
```

这个 hook 只在 Bash 执行 `git push` 时触发——其他 Bash 命令不触发。

---

## 4. Hook 执行引擎

### 4.1 Command Hook 执行

```
Hook 触发
  │
  ├─ 序列化输入为 JSON
  │   { "tool_name": "Bash", "tool_input": { "command": "npm test" } }
  │
  ├─ 替换 $ARGUMENTS 为 JSON
  │
  ├─ 执行 Shell 命令
  │   └─ 创建子进程
  │   └─ 设置超时（默认 5-60秒）
  │   └─ 捕获 stdout 和 stderr
  │
  └─ 处理退出码
      ├─ 0: 成功（静默通过）
      ├─ 2: 阻断（stderr 发给模型，阻止操作）
      └─ 其他: 非阻断错误（stderr 显示给用户）
```

**退出码 2 的特殊含义**是这个系统的核心设计——它让 hook 能够**阻止操作并告诉模型为什么**。模型看到 stderr 内容后，可以调整策略。

### 4.2 Prompt Hook 执行

```typescript
// execPromptHook.ts
async function execPromptHook(hook, jsonInput, signal) {
  // 1. 构建 prompt
  const prompt = hook.prompt.replace('$ARGUMENTS', jsonInput)
  
  // 2. 调用 Haiku 模型
  const response = await sideQuery({
    model: 'haiku',
    messages: [{ role: 'user', content: prompt }],
    timeout: 30_000,  // 30秒超时
  })
  
  // 3. 解析 JSON 响应
  // 期望格式: { ok: true } 或 { ok: false, reason: "..." }
  const result = parseJSON(response)
  
  // 4. 返回结果
  return {
    outcome: result.ok ? 'success' : 'blocking',
    reason: result.reason,
  }
}
```

### 4.3 Agent Hook 执行

```typescript
// execAgentHook.ts
async function execAgentHook(hook, jsonInput) {
  // 1. 启动子 agent（通过 query() 递归）
  const agentResult = await runSubAgent({
    prompt: hook.prompt.replace('$ARGUMENTS', jsonInput),
    maxTurns: 50,          // 最多 50 轮
    timeout: 60_000,       // 60秒超时
    tools: filteredTools,  // 过滤掉嵌套 agent 和 plan mode 工具
  })
  
  // 2. 从 StructuredOutput 工具获取结果
  return extractStructuredResult(agentResult)
}
```

Agent Hook 是最强大的类型——它可以**多轮推理**，读取文件、运行测试、检查结果，然后做出判断。

---

## 5. Hook 与主循环的集成

### 5.1 UserPromptSubmit

```
用户输入 "帮我部署到生产环境"
  │
  ├─ executeUserPromptSubmitHooks()
  │   └─ Hook: "检查是否在非工作时间"
  │       ├─ 退出码 0 → stdout 传给模型（"当前是凌晨 2 点，注意"）
  │       └─ 退出码 2 → 阻止（"非工作时间禁止部署"，清除输入）
  │
  └─ 如果通过 → 继续进入 query() 循环
```

### 5.2 PreToolUse

```
模型决定执行 Bash("rm -rf /tmp/cache")
  │
  ├─ 权限检查 (canUseTool)
  │
  ├─ executePreToolUseHooks()
  │   └─ Hook: "检查 rm 命令的目标"
  │       ├─ 退出码 0 → 允许执行
  │       └─ 退出码 2 → 阻止，stderr 发给模型
  │           模型看到: "不允许删除 /tmp/cache，请使用清理脚本"
  │           模型调整: 改为执行 "cleanup.sh"
  │
  └─ 执行工具
```

### 5.3 Stop Hook

Stop Hook 是 query.ts 中**第 6 个 continue site** 的核心：

```
模型完成响应（needsFollowUp = false）
  │
  ├─ handleStopHooks()
  │   └─ Hook: "检查修改的文件是否有测试"
  │       ├─ 退出码 0 → 正常结束
  │       ├─ 退出码 2 → blockingErrors
  │       │   ├─ 将 stderr 作为消息加入 messages
  │       │   ├─ state = { ..., stopHookActive: true }
  │       │   └─ continue → 模型看到错误，继续工作
  │       └─ preventContinuation → 强制结束
  │
  └─ return { reason: 'completed' }
```

**`stopHookActive: true`** 防止 hook 在重试时重复执行——避免"hook 阻断 → 重试 → hook 又阻断"的无限循环。

---

## 6. Hook 来源优先级

```
用户设置 (~/.claude/settings.json)           最高优先级
  │
项目设置 (.claude/settings.json)
  │
本地设置 (.claude/settings.local.json)
  │
插件 Hook (~/.claude/plugins/*/hooks/)
  │
内置 Hook                                    最低优先级
```

### 6.1 企业管控

```typescript
// 企业策略可以限制 hook 来源
if (policySettings.allowManagedHooksOnly) {
  // 只允许管理员推送的 hook
  // 用户/项目/本地/插件 hook 全部被忽略
}
```

---

## 7. Hook 输入/输出 Schema

### 7.1 PreToolUse 输入

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run tests"
  }
}
```

### 7.2 PostToolUse 输入

```json
{
  "tool_name": "FileEdit",
  "inputs": {
    "file_path": "src/app.ts",
    "old_string": "...",
    "new_string": "..."
  },
  "response": {
    "success": true,
    "patch": "..."
  }
}
```

### 7.3 PostToolUseFailure 输入

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "error": "Command failed with exit code 1",
  "error_type": "execution_error",
  "is_interrupt": false,
  "is_timeout": false,
  "tool_use_id": "toolu_abc123"
}
```

### 7.4 StopFailure 输入

```json
{
  "error_type": "rate_limit",
  "message": "Rate limit exceeded, retry after 30s"
}
```

错误类型包括：`rate_limit`、`authentication_failed`、`billing_error`、`invalid_request`、`server_error`、`max_output_tokens`、`unknown`。

---

## 8. Function Hook：编程式回调

```typescript
// sessionHooks.ts
// 只在当前 session 有效的 TypeScript 回调

addFunctionHook('PreToolUse', {
  id: 'my-validator',
  callback: async (input) => {
    if (input.tool_name === 'Bash' && input.tool_input.command.includes('sudo')) {
      return false  // 阻止
    }
    return true  // 允许
  }
})

// 可以通过 ID 移除
removeFunctionHook('my-validator')
```

Function Hook 用于**编程式集成**——比如 Skill 系统注册的临时 hook，在技能执行完后自动移除。

---

## 9. 性能和遥测

### 9.1 性能追踪

```typescript
// Hook 执行时间被追踪
addToTurnHookDuration(hookDuration)
// 累计到每个 turn 的 hook 总耗时
// 用于识别慢 hook（可能影响用户体验）
```

### 9.2 进度指示

```typescript
// 长时间运行的 hook 显示进度
startHookProgressInterval(hookName)
// 每秒更新一次 "Running hook: validate-tests..."
```

### 9.3 超时处理

```typescript
// 超时 = abort signal
const signal = createCombinedAbortSignal(
  parentAbortSignal,      // 用户取消
  timeoutSignal(timeout), // 超时
)
// 超时后 outcome = 'cancelled'，不阻断操作
```

---

## 10. 总结

Claude Code 的 Hook 系统让**用户成为框架的共同作者**：

1. **声明式配置**——settings.json 中定义，不需要写代码
2. **多种执行方式**——Shell 命令、LLM 评估、多轮 agent、HTTP、TypeScript 回调
3. **精细控制**——按工具名、命令模式、事件类型过滤
4. **安全集成**——退出码 2 的阻断机制让 hook 能安全地阻止操作
5. **企业管控**——策略可以限制只使用管理员批准的 hook

Hook 系统回答了一个关键问题：**如何让 agent 框架适应每个团队的独特工作流？** 不是通过修改框架代码，而是通过用户可配置的生命周期回调。
