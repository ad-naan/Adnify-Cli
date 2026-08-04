import { spawn, type ChildProcess } from 'node:child_process'
import { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../../application/ports/ToolExecutorPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'

/**
 * JSON-RPC 2.0 消息类型。
 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/**
 * MCP server 连接配置。
 */
export interface McpServerConfig {
  /** 服务器显示名称 */
  name: string
  /** 可执行文件路径，如 `npx` 或 `node` */
  command: string
  /** 启动参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
}

/**
 * MCP 工具的元数据（从 listTools 响应映射而来）。
 */
export interface McpToolInfo {
  serverName: string
  toolName: string
  description: string
  inputSchema?: Record<string, unknown>
}

/**
 * 基于 stdio 的 MCP client。
 *
 * 协议：使用 JSON-RPC 2.0 over stdin/stdout 与 MCP server 通信。
 * 生命周期：
 *   1. spawn 子进程
 *   2. 发送 initialize 请求完成握手
 *   3. 发送 notifications/initialized 完成初始化
 *   4. 调用 tools/list 获取可用工具列表
 *   5. 调用 tools/call 执行工具
 *   6. 关闭时发送 shutdown + exit
 */
export class McpClient {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private buffer = ''
  private initialized = false
  private toolsCache: McpToolInfo[] | null = null

  constructor(
    private readonly config: McpServerConfig,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * 启动 MCP server 并完成握手。
   */
  async connect(): Promise<void> {
    if (this.process) {
      return
    }

    this.logger.info('MCP client connecting', { name: this.config.name, command: this.config.command })

    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...this.config.env },
      windowsHide: true,
    })

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      this.processBuffer()
    })

    this.process.on('error', (err) => {
      this.logger.error('MCP process error', { name: this.config.name, error: err.message })
      // Reject all pending requests
      for (const [, handler] of this.pending) {
        handler.reject(new Error(`MCP process error: ${err.message}`))
      }
      this.pending.clear()
    })

    this.process.on('exit', (code) => {
      this.logger.info('MCP process exited', { name: this.config.name, code })
      this.process = null
      this.initialized = false
      // Reject all pending requests
      for (const [, handler] of this.pending) {
        handler.reject(new Error(`MCP server exited (code ${code})`))
      }
      this.pending.clear()
    })

    // Send initialize request
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'adnify-cli',
        version: '1.0.0',
      },
    })

    this.logger.debug('MCP initialize result', {
      name: this.config.name,
      serverInfo: (initResult as Record<string, unknown>)?.serverInfo,
    })

    // Send initialized notification
    this.sendNotification('notifications/initialized', {})

    this.initialized = true
  }

  /**
   * 获取 MCP server 暴露的工具列表。
   */
  async listTools(): Promise<McpToolInfo[]> {
    if (this.toolsCache) {
      return this.toolsCache
    }

    const result = (await this.sendRequest('tools/list', {})) as {
      tools?: Array<{
        name: string
        description?: string
        inputSchema?: Record<string, unknown>
      }>
    }

    this.toolsCache = (result.tools ?? []).map((tool) => ({
      serverName: this.config.name,
      toolName: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    }))

    return this.toolsCache
  }

  /**
   * 调用 MCP server 上的工具。
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    })) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }

    if (result.isError) {
      const textParts = (result.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
      throw new Error(textParts.join('\n') || 'MCP tool returned an error')
    }

    const textParts = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')

    return textParts.join('\n') || '(no output)'
  }

  /**
   * 关闭 MCP 连接。
   */
  async disconnect(): Promise<void> {
    if (!this.process) {
      return
    }

    try {
      await this.sendRequest('shutdown', {})
      this.sendNotification('notifications/exit', {})
    } catch {
      // Best-effort shutdown
    }

    this.process.kill()
    this.process = null
    this.initialized = false
    this.toolsCache = null
    this.pending.clear()
  }

  /**
   * 获取服务名。
   */
  get serverName(): string {
    return this.config.name
  }

  /**
   * 是否已连接。
   */
  get isConnected(): boolean {
    return this.initialized && this.process !== null
  }

  // ─── 内部方法 ──────────────────────────────────────

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error(`MCP server "${this.config.name}" is not connected`))
    }

    const id = this.nextId++
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write(message)
    })
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const message: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    this.write(message)
  }

  private write(message: JsonRpcRequest | JsonRpcNotification): void {
    const data = JSON.stringify(message) + '\n'
    this.process?.stdin?.write(data, 'utf8')
  }

  private processBuffer(): void {
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (!line) continue

      try {
        const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification

        // Check if it's a response (has id and either result or error)
        if ('id' in message && (message.result !== undefined || message.error !== undefined)) {
          const handler = this.pending.get(message.id)
          if (handler) {
            this.pending.delete(message.id)
            if (message.error) {
              handler.reject(
                new Error(`${message.error.message} (code ${message.error.code})`),
              )
            } else {
              handler.resolve(message.result)
            }
          }
        }
      } catch {
        this.logger.warn('MCP: failed to parse message', {
          name: this.config.name,
          line: line.slice(0, 200),
        })
      }
    }
  }
}

/**
 * 管理多个 MCP server 连接的注册中心。
 *
 * 职责：
 *   1. 启动/停止多个 MCP server
 *   2. 聚合所有 server 的工具列表
 *   3. 路由工具调用到正确的 server
 *   4. 将 MCP 工具注册为 ToolDescriptor
 */
export class McpRegistry {
  private clients = new Map<string, McpClient>()

  constructor(private readonly logger: LoggerPort) {}

  /**
   * 注册并连接一个 MCP server。
   */
  async addServer(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      this.logger.warn('MCP server already registered', { name: config.name })
      return
    }

    const client = new McpClient(config, this.logger)
    await client.connect()
    this.clients.set(config.name, client)

    const tools = await client.listTools()
    this.logger.info('MCP server connected', {
      name: config.name,
      toolCount: tools.length,
    })
  }

  /**
   * 断开并移除一个 MCP server。
   */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      await client.disconnect()
      this.clients.delete(name)
    }
  }

  /**
   * 断开所有 MCP server 连接。
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [, client] of this.clients) {
      promises.push(client.disconnect())
    }
    await Promise.allSettled(promises)
    this.clients.clear()
  }

  /**
   * 获取所有 MCP server 暴露的工具，映射为 ToolDescriptor 列表。
   */
  async getAllToolDescriptors(): Promise<ToolDescriptor[]> {
    const allTools = await this.getAllTools()
    return allTools.map(
      (tool) =>
        new ToolDescriptor({
          id: `mcp__${tool.serverName}__${tool.toolName}`,
          name: tool.toolName,
          description: tool.description,
          category: 'mcp',
          riskLevel: 'careful',
        }),
    )
  }

  /**
   * 获取所有 MCP server 暴露的原始工具信息。
   */
  async getAllTools(): Promise<McpToolInfo[]> {
    const results: McpToolInfo[] = []
    for (const [, client] of this.clients) {
      const tools = await client.listTools()
      results.push(...tools)
    }
    return results
  }

  /**
   * 执行 MCP 工具调用。
   *
   * toolId 格式：`mcp__<serverName>__<toolName>`
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult | null> {
    const { toolId, input } = request

    if (!toolId.startsWith('mcp__')) {
      return null // Not an MCP tool
    }

    const parts = toolId.split('__')
    if (parts.length < 3) {
      return null
    }

    const serverName = parts[1]!
    const toolName = parts.slice(2).join('__')
    const client = this.clients.get(serverName)

    if (!client) {
      return { toolId, ok: false, content: `MCP server "${serverName}" is not connected.` }
    }

    try {
      let args: Record<string, unknown> = {}
      if (input) {
        try {
          args = JSON.parse(input)
        } catch {
          args = { input }
        }
      }

      const result = await client.callTool(toolName, args)
      return { toolId, ok: true, content: result }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { toolId, ok: false, content: `MCP tool error: ${msg}` }
    }
  }

  /**
   * 检查给定的 toolId 是否是已注册的 MCP 工具。
   */
  hasTool(toolId: string): boolean {
    if (!toolId.startsWith('mcp__')) return false
    const serverName = toolId.split('__')[1]
    return serverName ? this.clients.has(serverName) : false
  }

  /**
   * 获取当前已连接的 server 名称列表。
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.values())
      .filter((c) => c.isConnected)
      .map((c) => c.serverName)
  }
}
