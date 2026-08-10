import type { ModelToolDefinition } from '../../application/ports/ModelGatewayPort'
import type { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'

/**
 * 内置工具的输入 schema —— 模型看到的参数契约的唯一来源。
 *
 * 为什么在 TS 里而不在 prompts/tools/*.md：
 * `parseFrontmatter` 是平铺的 `key: value` 解析器，遇到缩进子键会直接抛
 * `Invalid frontmatter line`，表达不了嵌套结构。
 *
 * 每条 schema 都是从对应 handler 的**实际解析逻辑**反推的，不是从系统提示的散文抄的 ——
 * 散文和 handler 已经漂移过（例如 shell-runner.md 通篇没提过它唯一的参数 argv）。
 * 改 handler 的入参时，这里必须跟着改；`toolInputSchemas.test.ts` 盯着这件事。
 */
const TOOL_INPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  'workspace-read': {
    type: 'object',
    properties: {
      focus: {
        type: 'string',
        description: 'Optional area to focus the summary on, e.g. "package.json".',
      },
    },
    additionalProperties: false,
  },

  'search-index': {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Literal text to search for across indexed files.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of matches to return. Defaults to 10.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  'glob-search': {
    type: 'object',
    // pattern 与 patterns 二选一：handler 先读 pattern，再合并 patterns 数组。
    // JSON Schema 的 anyOf 在部分 provider 上支持不佳，所以用描述说明而不是结构约束。
    properties: {
      pattern: {
        type: 'string',
        description: 'A single glob pattern, e.g. "src/**/*.ts". Use this or "patterns".',
      },
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple glob patterns. Use this or "pattern".',
      },
    },
    additionalProperties: false,
  },

  'file-ops': {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'list', 'write', 'update', 'patch'],
        description: 'Defaults to "read" when omitted. "update" and "patch" are equivalent.',
      },
      path: {
        type: 'string',
        description: 'Workspace-relative path. Must stay inside the workspace. Defaults to ".".',
      },
      content: { type: 'string', description: 'Full file content. Required for "write".' },
      oldText: {
        type: 'string',
        description: 'Exact text to replace. Required for "update"/"patch"; cannot be empty.',
      },
      newText: {
        type: 'string',
        description: 'Replacement text. Required for "update"/"patch".',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every occurrence instead of requiring exactly one match.',
      },
      expectedCount: {
        type: 'integer',
        minimum: 1,
        description: 'Fail unless oldText matches exactly this many times.',
      },
      allowWrite: {
        type: 'boolean',
        description:
          'Must be true for write/update/patch. Explicit acknowledgement that this modifies a file.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },

  'shell-runner': {
    type: 'object',
    properties: {
      argv: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          'Command and arguments as separate elements, e.g. ["rg","useState","src"]. Not a shell string — no pipes, redirects, or globbing.',
      },
    },
    required: ['argv'],
    additionalProperties: false,
  },

  'web-search': {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Maximum number of results. Defaults to 5.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  'web-fetch': {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Absolute URL to fetch. Must start with http:// or https://.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },

  task: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        description:
          'Subtasks to run in parallel. Each runs in its own isolated context and cannot see this conversation or call tools.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short label for progress display, e.g. "Audit error handling".',
            },
            instruction: {
              type: 'string',
              description:
                'The full self-contained task. The sub-agent sees nothing else, so include every fact and code excerpt it needs.',
            },
            contextSummary: {
              type: 'string',
              description: 'Optional background the sub-agent should assume.',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high'],
              description: 'Defaults to "normal". Does not affect ordering, only reporting.',
            },
          },
          required: ['title', 'instruction'],
          additionalProperties: false,
        },
      },
      maxConcurrency: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'How many subtasks run at once. Defaults to 3.',
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
}

/** 没有登记 schema 的工具（例如未来新增的）退化成自由 JSON 对象，不至于直接不可用。 */
const FALLBACK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
}

export function getToolInputSchema(toolId: string): Record<string, unknown> {
  return TOOL_INPUT_SCHEMAS[toolId] ?? FALLBACK_SCHEMA
}

export function hasToolInputSchema(toolId: string): boolean {
  return toolId in TOOL_INPUT_SCHEMAS
}

export function listSchemaToolIds(): string[] {
  return Object.keys(TOOL_INPUT_SCHEMAS)
}

/**
 * 把工具目录转成原生 function calling 的工具定义。
 * description 用目录里的完整描述 —— 模型靠它判断什么时候该用这个工具。
 */
export function toModelToolDefinitions(
  catalog: ReadonlyArray<Pick<ToolDescriptor, 'id' | 'description'>>,
): ModelToolDefinition[] {
  return catalog.map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: getToolInputSchema(tool.id),
  }))
}
