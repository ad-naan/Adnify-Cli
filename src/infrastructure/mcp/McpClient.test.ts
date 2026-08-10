import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import { McpClient, McpRegistry } from './McpClient'

const silentLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fakeMcpServer.ts',
)

function workspace() {
  return new WorkspaceContext({
    rootPath: process.cwd(),
    isGitRepository: true,
    packageManager: 'bun',
    topLevelEntries: [],
  })
}

describe('McpClient stdio integration', () => {
  test('connects, discovers tools, and calls a tool', async () => {
    const client = new McpClient(
      {
        name: 'fixture',
        command: process.execPath,
        args: [fixturePath],
      },
      silentLogger,
    )

    try {
      await client.connect()
      expect(client.isConnected).toBe(true)

      const tools = await client.listTools()
      expect(tools).toHaveLength(2)
      expect(tools[0]?.toolName).toBe('echo')
      expect(tools[0]?.inputSchema?.type).toBe('object')

      expect(await client.callTool('echo', { text: 'hello' })).toBe('echo:hello')
    } finally {
      await client.disconnect()
    }

    expect(client.isConnected).toBe(false)
  })
})

describe('McpRegistry', () => {
  test('maps discovered tools and routes execution to the connected server', async () => {
    const registry = new McpRegistry(silentLogger)

    try {
      await registry.addServer({
        name: 'fixture',
        command: process.execPath,
        args: [fixturePath],
      })

      expect(registry.getConnectedServers()).toEqual(['fixture'])
      expect(registry.hasTool('mcp__fixture__echo')).toBe(true)

      const descriptors = await registry.getAllToolDescriptors()
      expect(descriptors).toHaveLength(2)
      expect(descriptors[0]?.id).toBe('mcp__fixture__echo')
      expect(descriptors[0]?.riskLevel).toBe('careful')

      const result = await registry.executeTool({
        toolId: 'mcp__fixture__echo',
        input: '{"text":"through-registry"}',
        workspace: workspace(),
      })
      expect(result).toEqual({
        toolId: 'mcp__fixture__echo',
        ok: true,
        content: 'echo:through-registry',
      })

      const missing = await registry.executeTool({
        toolId: 'mcp__missing__echo',
        input: '{}',
        workspace: workspace(),
      })
      expect(missing?.ok).toBe(false)
      expect(missing?.content).toContain('is not connected')
    } finally {
      await registry.disconnectAll()
    }
  })
})
