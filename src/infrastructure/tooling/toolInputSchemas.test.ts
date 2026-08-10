import { describe, expect, it } from 'bun:test'
import {
  getToolInputSchema,
  hasToolInputSchema,
  listSchemaToolIds,
  toModelToolDefinitions,
} from './toolInputSchemas'
import { loadPromptBundle } from '../prompt/loadPromptBundle'

/** schema 里声明的必填字段，必须和 handler 实际要求的一致 —— 两边漂移过一次，所以这里盯着。 */
describe('toolInputSchemas', () => {
  it('covers every tool in the prompt catalog', async () => {
    // 工具目录是运行时从 prompts/tools/*.md 读的。新增一个工具却忘了写 schema，
    // 模型就只能拿到 additionalProperties:true 的自由对象 —— 等于没有契约。
    const bundle = await loadPromptBundle()
    const missing = bundle.toolCatalog
      .map((tool) => tool.id)
      .filter((id) => !hasToolInputSchema(id))

    expect(missing).toEqual([])
  })

  it('does not declare schemas for tools that no longer exist', async () => {
    const bundle = await loadPromptBundle()
    const catalogIds = new Set(bundle.toolCatalog.map((tool) => tool.id))
    const orphaned = listSchemaToolIds().filter((id) => !catalogIds.has(id))

    expect(orphaned).toEqual([])
  })

  it('marks shell-runner argv as required', () => {
    // parseShellRunnerRequest 在 argv 为空时直接失败，schema 必须说明这点。
    const schema = getToolInputSchema('shell-runner')
    expect(schema.required).toEqual(['argv'])
  })

  it('describes argv as a string array, not a shell string', () => {
    // 模型很容易传 {"argv":"rg foo src"}，那样 execFile 会把整串当成一个可执行文件名。
    const schema = getToolInputSchema('shell-runner') as {
      properties: { argv: { type: string; items: { type: string }; description: string } }
    }
    expect(schema.properties.argv.type).toBe('array')
    expect(schema.properties.argv.items.type).toBe('string')
    expect(schema.properties.argv.description).toContain('Not a shell string')
  })

  it('enumerates exactly the file-ops actions runFileOps dispatches on', () => {
    // runFileOps 的 switch：read / list / write / update / patch，其余走 default 报错。
    const schema = getToolInputSchema('file-ops') as {
      properties: { action: { enum: string[] } }
    }
    expect(schema.properties.action.enum).toEqual(['read', 'list', 'write', 'update', 'patch'])
  })

  it('documents allowWrite, which every mutating file-ops action rejects without', () => {
    // writeFileAction / patchFileAction 都在 allowWrite !== true 时直接失败。
    // 模型不知道这个字段就会连续吃到失败，白烧几轮。
    const schema = getToolInputSchema('file-ops') as {
      properties: { allowWrite?: { type: string } }
    }
    expect(schema.properties.allowWrite?.type).toBe('boolean')
  })

  it('falls back to a permissive object for unknown tools', () => {
    // MCP 工具带自己的 inputSchema，不走这张表；未登记的工具不能因此完全不可用。
    const schema = getToolInputSchema('mcp__something__unknown')
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(true)
  })

  it('builds model tool definitions from the catalog', async () => {
    const bundle = await loadPromptBundle()
    const definitions = toModelToolDefinitions(bundle.toolCatalog)

    expect(definitions).toHaveLength(bundle.toolCatalog.length)

    const shell = definitions.find((definition) => definition.name === 'shell-runner')
    expect(shell?.inputSchema).toBeDefined()
    // description 非空：模型靠它决定何时调用，空描述等于让它瞎猜。
    expect(shell?.description.length).toBeGreaterThan(0)
  })
})
