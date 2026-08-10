import { createInterface } from 'node:readline'

interface JsonRpcMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
}

function reply(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const lines = createInterface({ input: process.stdin })

lines.on('line', (line) => {
  const message = JSON.parse(line) as JsonRpcMessage

  if (message.method === 'notifications/initialized') {
    return
  }

  if (message.method === 'notifications/exit') {
    process.exit(0)
  }

  if (message.id === undefined) {
    return
  }

  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1.0.0' },
    })
    return
  }

  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo the provided text',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        {
          name: 'fail',
          description: 'Return a tool-level failure',
          inputSchema: { type: 'object' },
        },
      ],
    })
    return
  }

  if (message.method === 'tools/call') {
    const params = message.params ?? {}
    if (params.name === 'fail') {
      reply(message.id, {
        isError: true,
        content: [{ type: 'text', text: 'fixture failure' }],
      })
      return
    }

    const args = params.arguments as Record<string, unknown> | undefined
    reply(message.id, {
      content: [{ type: 'text', text: `echo:${String(args?.text ?? '')}` }],
    })
    return
  }

  if (message.method === 'shutdown') {
    reply(message.id, {})
  }
})
