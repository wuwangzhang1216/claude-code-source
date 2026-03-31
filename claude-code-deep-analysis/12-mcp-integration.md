# 12 - MCP 集成深度分析：扩展性的核心

---

## 1. 什么是 MCP

Model Context Protocol（MCP）是 Anthropic 提出的开放协议，让 AI 应用可以连接外部工具服务器。Claude Code 通过 MCP 支持无限的工具扩展——数据库查询、GitHub 操作、Slack 消息、自定义企业工具等。

MCP 在 Claude Code 中的地位：**它是唯一不受 agent 工具过滤限制的工具来源。** 无论是 Explore agent（只读）还是 Plan agent（只读），MCP 工具始终可用。

---

## 2. 架构概览

```
Claude Code
  │
  ├─ MCP Client (services/mcp/client.ts, 3348行)
  │   ├─ connectToServer()        // 连接管理（memoized）
  │   ├─ fetchToolsForClient()    // 工具发现（LRU缓存）
  │   └─ callMCPTool()            // 工具调用
  │
  ├─ Transport Layer
  │   ├─ StdioClientTransport     // 子进程 MCP 服务器
  │   ├─ SSEClientTransport       // Server-Sent Events
  │   ├─ StreamableHTTPTransport  // HTTP 流式
  │   ├─ WebSocketTransport       // WebSocket
  │   ├─ InProcessTransport       // 进程内（Bun SDK）
  │   └─ SdkControlTransport      // CLI ↔ SDK 桥接
  │
  ├─ Auth Layer
  │   ├─ OAuth (services/oauth/)  // 标准 OAuth 流程
  │   └─ XAA/IDP                  // 企业身份联合
  │
  └─ Permission Layer
      ├─ channelAllowlist.ts      // 服务器白名单
      └─ channelPermissions.ts    // 结构化权限请求
```

---

## 3. 连接管理：connectToServer()

### 3.1 Memoized 连接工厂

```typescript
// services/mcp/client.ts:595
export const connectToServer = memoize(
  async (name: string, serverRef: McpServerRef) => {
    // 1. 选择 transport
    const transport = selectTransport(serverRef)
    
    // 2. 配置认证
    const authProvider = createAuthProvider(serverRef)
    
    // 3. 建立连接
    const client = new Client({ transport, auth: authProvider })
    await client.connect()
    
    return client
  },
  (name, ref) => `${name}:${JSON.stringify(ref)}`  // 缓存 key
)
```

`memoize` 确保同一个服务器只建立一次连接。缓存 key 是 `name:serverRef` 的组合——如果配置变了（比如换了端口），会创建新连接。

### 3.2 Transport 选择

根据 `serverRef` 的类型选择 transport：

| 配置类型 | Transport | 场景 |
|---------|-----------|------|
| `command` + `args` | StdioClientTransport | 本地子进程（如 `npx @mcp/server-postgres`） |
| `url` (http/https) | SSEClientTransport 或 StreamableHTTP | 远程 HTTP 服务器 |
| `url` (ws/wss) | WebSocketTransport | WebSocket 服务器 |
| 内部标记 | InProcessTransport | Bun SDK 内嵌服务器 |
| SDK 桥接 | SdkControlTransport | VS Code 扩展中的 MCP |

### 3.3 InProcessTransport：零网络开销

```typescript
// services/mcp/InProcessTransport.ts (64行)
// 创建一对链接的 transport
const [clientTransport, serverTransport] = createLinkedPair()

// 消息通过 microtask 传递，避免调用栈过深
queueMicrotask(() => {
  otherTransport.onmessage?.(message)
})
```

`InProcessTransport` 用于 Claude Code 自身内嵌的 MCP 服务器。消息直接在内存中传递，用 `queueMicrotask` 而非同步调用——防止深度递归（MCP 消息可能触发更多 MCP 调用）。

---

## 4. 工具发现与注册

### 4.1 工具枚举

```typescript
// services/mcp/client.ts:1743
export const fetchToolsForClient = lruCache(
  async (client: McpClient) => {
    const response = await client.request('tools/list')
    return response.tools.map(tool => createMcpToolAdapter(tool))
  },
  { maxSize: 12 }  // LRU 缓存最多 12 个服务器的工具列表
)
```

### 4.2 工具名称映射

MCP 工具在 Claude Code 中使用全限定名：

```
MCP 服务器: "postgres"
MCP 工具:   "query"
全限定名:   "mcp__postgres__query"
```

这个前缀确保了 MCP 工具和内置工具不会命名冲突。

### 4.3 工具元数据

MCP 工具可以携带元数据 hint：

```typescript
{
  destructiveHint: true,    // 有破坏性（如 DELETE 语句）
  readOnlyHint: true,       // 只读操作
  openWorldHint: true,      // 可能访问外部资源
  searchHint: "database queries",  // ToolSearch 匹配文本
  alwaysLoad: true,         // 不延迟加载，始终在 prompt 中
}
```

这些 hint 影响权限检查和工具编排——`readOnlyHint: true` 的工具可以参与并发批次。

---

## 5. 工具调用流程

### 5.1 标准调用

```
模型输出 tool_use: mcp__postgres__query
  │
  ├─ findToolByName() → 识别为 MCP 工具
  ├─ canUseTool() → 权限检查
  │   ├─ channelAllowlist 检查
  │   └─ 用户确认（如需要）
  ├─ client.request('tools/call', { name: 'query', arguments: {...} })
  │   └─ 通过 transport 发送到 MCP 服务器
  ├─ 接收结果
  │   ├─ 内容截断检查（mcpContentNeedsTruncation）
  │   └─ 格式化为 tool_result
  └─ yield 结果给主循环
```

### 5.2 URL Elicitation

某些 MCP 工具需要用户提供 URL（如 OAuth 回调）：

```typescript
// services/mcp/client.ts:2813+
async function callMCPToolWithUrlElicitationRetry(client, tool, args) {
  const result = await client.request('tools/call', { name: tool, arguments: args })
  
  if (result.requiresUrl) {
    // 弹窗请求用户提供 URL
    const url = await askUserForUrl(result.urlPrompt)
    // 带 URL 重试
    return client.request('tools/call', { name: tool, arguments: { ...args, url } })
  }
  
  return result
}
```

### 5.3 结构化权限请求

MCP 服务器可以通过 channel permissions 请求结构化审批：

```
MCP 服务器 → 发送 permission 请求（带 5 字符 ID）
  → Claude Code UI 显示请求
    → 用户回复 "yes abc12" 或 "no abc12"
      → 匹配 ID，返回决策给 MCP 服务器
```

ID 生成还有一个有趣的细节——它会**过滤掉脏话**，避免随机生成的 ID 碰巧是不雅词汇。

---

## 6. 认证系统

### 6.1 OAuth 流程

```
用户连接需要认证的 MCP 服务器
  │
  ├─ OIDC Discovery → 获取 authorization_endpoint
  ├─ PKCE 生成 → code_verifier + code_challenge
  ├─ 打开浏览器 → 用户登录
  ├─ 本地监听 callback → 接收 authorization_code
  ├─ 交换 access_token
  └─ 存入 Keychain（安全存储）
```

### 6.2 XAA 企业认证

Cross-App Access（XAA）支持企业身份联合：

```
用户的企业 IDP
  → OIDC 登录获取 IDP token
    → 交换为 MCP 服务器的 access_token
      → 存入 Keychain
```

这让企业用户可以用公司的 SSO 登录 MCP 服务器，不需要为每个服务器单独管理凭证。

---

## 7. Agent 集成

### 7.1 Agent 专属 MCP 服务器

Agent 定义可以声明专属 MCP 服务器：

```typescript
// runAgent.ts:95-218
async function initializeAgentMcpServers(agentDef, parentClients) {
  const mergedClients = { ...parentClients }  // 继承父 agent 的连接
  
  for (const server of agentDef.mcpServers) {
    mergedClients[server.name] = await connectToServer(server)  // 新建连接
  }
  
  return {
    clients: mergedClients,
    cleanup: async () => {
      // 只清理新建的连接，不关闭继承的
      for (const server of agentDef.mcpServers) {
        await mergedClients[server.name].close()
      }
    }
  }
}
```

### 7.2 企业策略限制

```typescript
if (isRestrictedToPluginOnly('mcp')) {
  // 只允许企业管理员批准的 MCP 服务器
  // 用户自定义的被拒绝
}

if (isSourceAdminTrusted(source)) {
  // 内置/策略定义的 agent 绕过限制
}
```

---

## 8. 连接生命周期管理

### 8.1 React Hook 管理

`useManageMCPConnections`（1141 行）是 MCP 连接的 React 生命周期管理器：

```
启动 → 连接所有配置的 MCP 服务器
  │
  ├─ 监听 authVersion 变化 → 重新认证
  ├─ 监听 refreshActivePlugins → 重新连接
  ├─ 连接失败 → 指数退避重试（最多 5 次）
  ├─ 去重 Claude.ai MCP 服务器
  └─ 策略过滤 → filterMcpServersByPolicy()
```

### 8.2 指令注入

MCP 服务器可以提供 `instructions`——模型在每次调用时都能看到的上下文信息：

```typescript
function getMcpInstructions(mcpClients) {
  return mcpClients
    .filter(c => c.connected && c.instructions)
    .map(c => `## ${c.name}\n${c.instructions}`)
    .join('\n\n')
}
```

这些指令被注入到 system prompt 中，让模型了解每个 MCP 服务器的能力和使用方式。

---

## 9. 总结

MCP 集成是 Claude Code 的**扩展性基石**。它的设计体现了几个关键原则：

1. **协议标准化**——MCP 是开放协议，任何人都可以实现服务器
2. **Transport 抽象**——六种 transport 覆盖了从进程内到跨网络的所有场景
3. **安全分层**——OAuth + XAA + channelAllowlist + 权限弹窗，多层防护
4. **缓存优化**——连接 memoized、工具列表 LRU 缓存，减少重复开销
5. **agent 透明**——MCP 工具对所有 agent 类型可用，不受工具过滤影响
