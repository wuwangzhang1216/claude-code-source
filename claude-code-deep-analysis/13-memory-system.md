# 13 - Memory 系统深度分析：跨会话的记忆

---

## 1. 为什么需要 Memory

AI 编程助手的一个根本问题是：**每次会话都从零开始。** 上一次你告诉它"我们项目用的是 pnpm 不是 npm"，下次会话它又会用 npm。

Claude Code 的 Memory 系统解决了这个问题——它让模型能够跨会话记住用户的偏好、项目上下文、和工作模式。

---

## 2. 存储架构

### 2.1 目录结构

```
~/.claude/
  └─ projects/
      └─ {project-hash}/
          └─ memory/
              ├─ MEMORY.md          # 入口文件（索引）
              ├─ user_role.md       # 用户角色记忆
              ├─ feedback_testing.md # 反馈记忆
              ├─ project_auth.md    # 项目记忆
              └─ ...                # 最多 200 个文件
```

### 2.2 记忆文件格式

每个记忆文件使用 frontmatter 格式：

```markdown
---
name: 用户偏好-测试
description: 用户偏好使用真实数据库而非 mock 进行集成测试
type: feedback
---

集成测试必须使用真实数据库，不用 mock。

**Why:** 上季度 mock 测试通过但生产迁移失败的事故。
**How to apply:** 写测试时，配置连接到测试数据库而非 mock。
```

### 2.3 MEMORY.md：索引入口

`MEMORY.md` 是一个**索引文件**，不是记忆本身：

```markdown
- [用户角色](user_role.md) — 高级后端工程师，熟悉 Go 和 React
- [测试偏好](feedback_testing.md) — 集成测试用真实数据库
- [项目认证](project_auth.md) — 认证重写因合规要求驱动
```

关键限制：
- 最多 200 行（`MAX_ENTRYPOINT_LINES`）
- 最大 25KB（`MAX_ENTRYPOINT_BYTES`）
- 超出限制时截断并添加警告

---

## 3. 记忆检索：findRelevantMemories()

### 3.1 检索流程

```
用户输入 "帮我写测试"
  │
  ├─ 1. 扫描记忆目录（memoryScan）
  │     └─ 读取每个文件的 frontmatter（前30行）
  │     └─ 按修改时间排序
  │     └─ 最多 200 个文件
  │
  ├─ 2. 构建记忆清单
  │     └─ "[feedback] feedback_testing.md (3天前): 集成测试用真实数据库"
  │     └─ "[user] user_role.md (7天前): 高级后端工程师"
  │
  ├─ 3. 调用 Claude Sonnet 选择相关记忆
  │     └─ 输入：用户消息 + 记忆清单 + 最近使用的工具
  │     └─ 输出：JSON { selected_memories: ["feedback_testing.md", ...] }
  │     └─ 最多选择 5 个
  │
  └─ 4. 读取选中的记忆文件全文
        └─ 作为 AttachmentMessage 注入上下文
```

### 3.2 智能过滤

```typescript
// findRelevantMemories.ts:39
async function findRelevantMemories({
  query,
  memoryDir,
  recentlyUsedTools,      // 最近使用的工具（抑制 API 文档类记忆）
  alreadySurfacedPaths,   // 已经展示过的记忆（避免重复）
}) {
  // 排除 MEMORY.md（已在 system prompt 中）
  // 排除已经通过 FileRead 读取过的记忆
  // 排除本 session 已展示过的记忆
}
```

**工具感知过滤**是一个巧妙的设计——如果用户刚用 FileRead 读了某个记忆文件，就不需要再通过 Memory 系统注入它。

### 3.3 Session 字节预算

```typescript
const MAX_SESSION_BYTES = 60 * 1024  // 60KB 累计上限
```

整个 session 中通过 Memory 注入的总字节数不超过 60KB。这防止了长会话中记忆累积占满上下文窗口。

---

## 4. 异步预取：startRelevantMemoryPrefetch()

### 4.1 RAII 模式

```typescript
// query.ts:301-304
using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
  state.messages,
  state.toolUseContext,
)
```

`using` 关键字确保了预取的生命周期管理：
- **启动**：第一次循环迭代时
- **消费**：工具执行后、下一轮 API 调用前
- **清理**：generator 退出时自动 dispose（记录遥测数据）

### 4.2 火与忘 + 延迟消费

```
循环迭代开始
  │
  ├─ startRelevantMemoryPrefetch() → 异步启动
  │     └─ 调用 findRelevantMemories()
  │     └─ 记录 settledAt 时间戳
  │
  ├─ 四层上下文压缩
  ├─ API 调用
  ├─ 工具执行
  │
  └─ getAttachmentMessages()
        └─ 检查 pendingMemoryPrefetch 是否已完成
        └─ 如果完成 → 创建 AttachmentMessage
        └─ 如果未完成 → 跳过（不阻塞）
```

**不阻塞是关键**——记忆检索通常需要 1-3 秒（调用 Sonnet），如果阻塞主循环会影响响应速度。通过异步预取，记忆检索和模型调用/工具执行重叠执行。

### 4.3 遥测追踪

```typescript
// dispose 时记录
logEvent('tengu_memdir_prefetch_collected', {
  settledAt: prefetch.settledAt,
  consumedOnIteration: prefetch.consumedOnIteration,
  // -1=从未消费, 0=隐藏（被过滤）, N=在第N轮可见
})
```

---

## 5. 记忆类型

### 5.1 五种记忆类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `user` | 用户角色和偏好 | "高级后端工程师，熟悉 Go" |
| `feedback` | 行为反馈（做/不做） | "不要 mock 数据库" |
| `project` | 项目上下文和进展 | "认证重写因合规需求" |
| `reference` | 外部资源指针 | "Bug 追踪在 Linear INGEST 项目" |

### 5.2 什么不应该存为记忆

- 代码模式和架构（从代码中读取）
- Git 历史（从 git log 读取）
- 调试方案（修复已在代码中）
- CLAUDE.md 中已有的内容
- 当前会话的临时信息

---

## 6. Session Memory：自动记忆提取

### 6.1 工作原理

```
会话进行中...
  │
  ├─ 达到 token/工具调用阈值
  │
  ├─ shouldExtractMemory() → true
  │
  ├─ 启动后台子 agent（非阻塞）
  │   └─ buildSessionMemoryUpdatePrompt()
  │   └─ agent 分析对话，提取关键信息
  │   └─ 写入/更新记忆文件
  │
  └─ markSessionMemoryInitialized()
      └─ 后续按周期更新
```

### 6.2 渐进提取

Session Memory 不是一次性提取，而是**渐进式**的：

1. **初始化**：达到首次阈值后提取
2. **增量更新**：追踪 `lastSummarizedMessageId`，只处理新消息
3. **周期触发**：基于 token 增量和工具调用次数

---

## 7. Team Memory

### 7.1 团队共享

```
~/.claude/memories/team/    # 团队记忆目录
  ├─ onboarding.md          # 新人指南
  ├─ code_style.md          # 代码风格
  └─ deployment.md          # 部署流程
```

Team Memory 存在单独的 `team/` 目录下，通过同步机制在团队成员间共享。

### 7.2 双层记忆 prompt

当 Team Memory 启用时，system prompt 包含两层记忆：

```
个人记忆（~/.claude/memories/）
  + 团队记忆（~/.claude/memories/team/）
    → 合并后注入 system prompt
```

---

## 8. 与 System Prompt 的集成

### 8.1 静态注入

`MEMORY.md` 的内容在每次 turn 开始时作为 system prompt 的一部分注入：

```typescript
// constants/prompts.ts:495
systemPromptSection('memory', () => loadMemoryPrompt())
```

这是一个**缓存友好**的操作——因为 MEMORY.md 在会话期间通常不变，这个 section 可以被 prompt cache 复用。

### 8.2 动态注入

`findRelevantMemories()` 找到的额外记忆通过 `AttachmentMessage` 动态注入：

```
System Prompt（包含 MEMORY.md 索引）
  + AttachmentMessage(memory: "feedback_testing.md 的完整内容")
    → 模型同时看到索引和具体记忆
```

---

## 9. 总结

Claude Code 的 Memory 系统是一个**多层次、异步、智能**的记忆架构：

1. **存储层**：文件系统 + frontmatter 格式，简单可靠
2. **检索层**：Sonnet 驱动的相关性匹配，比关键词搜索更准确
3. **注入层**：静态（MEMORY.md）+ 动态（AttachmentMessage），分级注入
4. **提取层**：Session Memory 自动提取，无需用户手动操作
5. **共享层**：Team Memory 支持团队知识传播

这套系统让 Claude Code 不再是一个"每次从零开始"的工具，而是一个**越用越了解你**的编程伙伴。
