import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type {
  ModelGatewayPort,
  ModelMessage,
  ModelToolDefinition,
} from '../../application/ports/ModelGatewayPort'
import type { ToolExecutorPort, ToolExecutionResult } from '../../application/ports/ToolExecutorPort'
import { StreamingToolCallParser } from '../../application/support/StreamingToolCallParser'
import { parseToolCallMarkup } from '../../application/support/ToolCallMarkup'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import {
  SubAgentTask,
  type SubAgentPriority,
  type SubAgentRole,
} from '../../domain/agent/SubAgentTask'
import type { SubAgentOrchestratorPort } from '../../domain/agent/SubAgentOrchestratorPort'
import { getToolInputSchema } from '../tooling/toolInputSchemas'
import { loadProjectInstructions } from '../prompt/loadProjectInstructions'
import { GitWorktreeManager, type WorktreeHandle } from './GitWorktreeManager'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'

interface LocalSubAgentOptions {
  idGenerator: IdGeneratorPort
  logger: LoggerPort
  toolExecutor?: ToolExecutorPort
  createWorktreeToolExecutor?: () => ToolExecutorPort
  worktreeManagerFactory?: (workspaceRoot: string) => {
    create(taskId: string): Promise<WorktreeHandle>
    capturePatch(handle: WorktreeHandle): Promise<{ patch: string; status: string }>
    dispose(handle: WorktreeHandle): Promise<void>
  }
}

const MAX_AGENT_TURNS = 8
const MAX_TOOL_RESULT_CHARS = 6000
const PRIORITY_SCORE: Record<SubAgentPriority, number> = { high: 0, normal: 1, low: 2 }
const READ_ONLY_TOOL_IDS = new Set(['workspace-read', 'search-index', 'glob-search', 'file-ops'])
const IMPLEMENT_TOOL_IDS = new Set([...READ_ONLY_TOOL_IDS, 'shell-runner'])

const READ_ONLY_TOOLS: ModelToolDefinition[] = [
  {
    name: 'workspace-read',
    description: 'Inspect workspace structure and package metadata without modifying anything.',
    inputSchema: getToolInputSchema('workspace-read'),
  },
  {
    name: 'search-index',
    description: 'Search literal code and project text in the current workspace.',
    inputSchema: getToolInputSchema('search-index'),
  },
  {
    name: 'glob-search',
    description: 'Find workspace files using one or more glob patterns.',
    inputSchema: getToolInputSchema('glob-search'),
  },
  {
    name: 'file-ops',
    description: 'Read a text file or list a directory. Sub-agents cannot write or patch files.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'list'] },
        path: { type: 'string', description: 'Workspace-relative path. Defaults to ".".' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
]

const IMPLEMENT_TOOLS: ModelToolDefinition[] = [
  ...READ_ONLY_TOOLS.slice(0, 3),
  {
    name: 'file-ops',
    description: 'Read, list, write, update, or patch text files inside this isolated worktree.',
    inputSchema: getToolInputSchema('file-ops'),
  },
  {
    name: 'shell-runner',
    description: 'Run approved project inspection and verification commands inside this isolated worktree.',
    inputSchema: getToolInputSchema('shell-runner'),
  },
]

/**
 * Runs focused sub-agents in isolated contexts.
 *
 * Research workers stay read-only. Implementation workers edit and verify inside disposable
 * Git worktrees, then return a patch for the parent agent to review and apply.
 */
export class LocalSubAgentOrchestrator implements SubAgentOrchestratorPort {
  constructor(
    private readonly gateway: ModelGatewayPort | null,
    private readonly config: ModelConfig,
    private readonly options: LocalSubAgentOptions,
  ) {}

  createTasks(tasks: Array<{
    title: string
    instruction: string
    contextSummary?: string
    priority?: SubAgentPriority
    role?: SubAgentRole
  }>): SubAgentTask[] {
    return tasks.map((task) =>
      SubAgentTask.create({
        id: this.options.idGenerator.next(),
        title: task.title,
        instruction: task.instruction,
        contextSummary: task.contextSummary,
        priority: task.priority ?? 'normal',
        role: task.role ?? 'general',
      }),
    )
  }

  async runBatch(
    tasks: SubAgentTask[],
    options: {
      maxConcurrency: number
      workspace: WorkspaceContext
      abortSignal?: AbortSignal
      onTaskStart?: (taskId: string, title: string) => void
      onTaskComplete?: (taskId: string, success: boolean, result?: string) => void
    },
  ): Promise<SubAgentTask[]> {
    const pending = tasks
      .filter((task) => task.status === 'pending')
      .sort((left, right) => PRIORITY_SCORE[left.priority] - PRIORITY_SCORE[right.priority])
    if (pending.length === 0) return tasks

    const maxConcurrent = Math.max(1, Math.min(options.maxConcurrency, pending.length))
    let nextIndex = 0

    const executeTask = async (task: SubAgentTask): Promise<void> => {
      if (options.abortSignal?.aborted) {
        task.markCancelled()
        options.onTaskComplete?.(task.id, false, 'Cancelled')
        return
      }

      task.markRunning()
      options.onTaskStart?.(task.id, task.title)

      try {
        if (!this.gateway) {
          throw new Error('No model gateway configured for sub-agent execution')
        }

        const result = await this.runTaskInIsolation(task, options.workspace, options.abortSignal)
        if (!result.trim()) throw new Error('Sub-agent returned empty response')

        task.markCompleted(result.trim())
        options.onTaskComplete?.(task.id, true, task.result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (options.abortSignal?.aborted) {
          task.markCancelled()
        } else {
          task.markFailed(message)
        }
        options.onTaskComplete?.(task.id, false, message)
      }
    }

    const workers = Array.from({ length: maxConcurrent }, async () => {
      while (nextIndex < pending.length && !options.abortSignal?.aborted) {
        const task = pending[nextIndex++]
        if (task) await executeTask(task)
      }
    })

    await Promise.allSettled(workers)

    for (const task of pending) {
      if (task.status === 'pending') {
        task.markCancelled()
        options.onTaskComplete?.(task.id, false, 'Cancelled')
      }
    }

    return tasks
  }

  private async runTaskInIsolation(
    task: SubAgentTask,
    workspace: WorkspaceContext,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    if (task.role !== 'implement' || !workspace.isGitRepository || !this.options.createWorktreeToolExecutor) {
      return this.runFocusedAgent(task, workspace, abortSignal, this.options.toolExecutor, false)
    }

    const manager = this.options.worktreeManagerFactory?.(workspace.rootPath) ??
      new GitWorktreeManager(workspace.rootPath, this.options.logger)
    const handle = await manager.create(task.id)
    const isolatedWorkspace = new WorkspaceContext({
      rootPath: handle.path,
      isGitRepository: true,
      packageManager: workspace.packageManager,
      topLevelEntries: workspace.topLevelEntries,
    })

    try {
      const result = await this.runFocusedAgent(
        task,
        isolatedWorkspace,
        abortSignal,
        this.options.createWorktreeToolExecutor(),
        true,
      )
      const captured = await manager.capturePatch(handle)
      return [
        result,
        '',
        '## Isolated worktree result',
        `status:\n${captured.status || '(clean)'}`,
        captured.patch ? `patch:\n${truncate(captured.patch, 8000)}` : 'patch: (none)',
        'The parent agent must review and apply this patch to the main workspace.',
      ].join('\n')
    } finally {
      await manager.dispose(handle)
    }
  }

  private async runFocusedAgent(
    task: SubAgentTask,
    workspace: WorkspaceContext,
    abortSignal?: AbortSignal,
    toolExecutor: ToolExecutorPort | undefined = this.options.toolExecutor,
    allowImplementation = false,
  ): Promise<string> {
    let messages = await this.buildSubAgentMessages(task, workspace)
    let verificationRequired = false
    let verificationNudgeSent = false

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const parser = new StreamingToolCallParser()
      let accumulated = ''
      let visibleText = ''
      let nativeToolCall: { toolCallId: string; name: string; input: string } | null = null

      for await (const chunk of this.gateway!.streamChat({
        messages,
        model: this.config.model,
        temperature: 0,
        maxTokens: this.config.maxTokens,
        abortSignal,
        tools: toolExecutor ? (allowImplementation ? IMPLEMENT_TOOLS : READ_ONLY_TOOLS) : undefined,
      })) {
        if (chunk.toolCall && !nativeToolCall) {
          nativeToolCall = {
            toolCallId: chunk.toolCall.toolCallId,
            name: chunk.toolCall.toolName,
            input: chunk.toolCall.input,
          }
        }
        accumulated += chunk.delta
        visibleText += parser.push(chunk.delta).text
      }

      const flushed = parser.flush()
      visibleText += flushed.text
      const toolCall = nativeToolCall ?? flushed.toolCall ?? parseToolCallMarkup(accumulated)

      if (!toolCall && allowImplementation && verificationRequired && !verificationNudgeSent) {
        verificationNudgeSent = true
        messages = [
          ...messages,
          { role: 'assistant', content: visibleText.trim() || accumulated.trim() },
          {
            role: 'user',
            content: 'You modified files in the worktree. Run the narrowest relevant test, typecheck, lint, or build before finishing.',
          },
        ]
        continue
      }

      if (!toolCall) return visibleText.trim() || accumulated.trim()

      const result = await this.executeAgentTool(
        toolCall.name,
        toolCall.input,
        workspace,
        toolExecutor,
        allowImplementation,
        abortSignal,
      )
      if (result.ok && allowImplementation && isMutatingFileInput(toolCall.name, toolCall.input)) {
        verificationRequired = true
        verificationNudgeSent = false
      } else if (allowImplementation && verificationRequired && isVerificationInput(toolCall.name, toolCall.input)) {
        verificationRequired = false
      }
      messages = nativeToolCall
        ? [
            ...messages,
            {
              role: 'assistant',
              content: visibleText.trim(),
              toolCalls: [{
                toolCallId: nativeToolCall.toolCallId,
                toolName: nativeToolCall.name,
                input: nativeToolCall.input,
              }],
            },
            {
              role: 'tool',
              content: truncate(result.content, MAX_TOOL_RESULT_CHARS),
              toolCallId: nativeToolCall.toolCallId,
              toolName: nativeToolCall.name,
              ok: result.ok,
            },
          ]
        : [
            ...messages,
            { role: 'assistant', content: visibleText.trim() || accumulated.trim() },
            {
              role: 'user',
              content: [
                `Read-only tool result for ${result.toolId}:`,
                result.ok ? 'status: ok' : 'status: failed',
                truncate(result.content, MAX_TOOL_RESULT_CHARS),
                '',
                'Continue the assigned subtask. Cite file paths and symbols in the final result.',
              ].join('\n'),
            },
          ]
    }

    throw new Error(`Sub-agent reached the ${MAX_AGENT_TURNS}-turn tool limit`)
  }

  private async executeAgentTool(
    toolName: string,
    input: string,
    workspace: WorkspaceContext,
    toolExecutor: ToolExecutorPort | undefined,
    allowImplementation: boolean,
    abortSignal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const allowedTools = allowImplementation ? IMPLEMENT_TOOL_IDS : READ_ONLY_TOOL_IDS
    if (!toolExecutor || !allowedTools.has(toolName)) {
      return { toolId: toolName, ok: false, content: `Tool "${toolName}" is not available to sub-agents.` }
    }

    if (toolName === 'file-ops') {
      try {
        const parsed = JSON.parse(input) as { action?: unknown }
        const action = parsed.action ?? 'read'
        if (!allowImplementation && action !== 'read' && action !== 'list') {
          return {
            toolId: toolName,
            ok: false,
            content: 'Sub-agents may only use file-ops read or list actions.',
          }
        }
      } catch {
        return { toolId: toolName, ok: false, content: 'Tool input must be valid JSON.' }
      }
    }

    return toolExecutor.execute({ toolId: toolName, input, workspace, abortSignal })
  }

  private async buildSubAgentMessages(task: SubAgentTask, workspace: WorkspaceContext): Promise<ModelMessage[]> {
    const roleInstruction: Record<SubAgentRole, string> = {
      general: 'Investigate the assigned question and return a grounded answer.',
      explore: 'Map the relevant implementation, dependencies, and control flow before concluding.',
      review: 'Look for correctness, security, regression, and maintainability risks. Rank concrete findings.',
      test: 'Identify missing coverage, failure modes, and the smallest meaningful verification strategy.',
      implement: 'Implement the assigned change in your isolated git worktree and run the narrowest relevant verification.',
    }

    const systemLines = [
      task.role === 'implement'
        ? 'You are an isolated implementation worker. All writes stay inside a disposable git worktree.'
        : 'You are an isolated read-only coding sub-agent.',
      roleInstruction[task.role],
      task.role === 'implement'
        ? 'You may read and edit worktree files and run allowlisted verification commands. You cannot browse the web or spawn agents.'
        : 'You may search and read the workspace, but you cannot modify files, run shell commands, browse the web, or spawn agents.',
      'Use tools when evidence is not already present. Do not guess about repository code.',
      'Final output must include: conclusion, evidence with file paths/symbols, risks or unknowns, and a recommended next action.',
      'Do not ask the user questions. Return a compact result for a parent coding agent.',
      `Workspace: ${workspace.rootPath}`,
      `Task: ${task.title}`,
      '',
      'If native tools are unavailable, request exactly one tool with:',
      '<adnify_tool_call name="tool-id">{"key":"value"}</adnify_tool_call>',
      task.role === 'implement'
        ? 'Allowed tool ids: workspace-read, search-index, glob-search, file-ops, shell-runner.'
        : 'Allowed tool ids: workspace-read, search-index, glob-search, file-ops (read/list only).',
    ]

    if (task.contextSummary) systemLines.push(`Context: ${task.contextSummary}`)
    const projectInstructions = await loadProjectInstructions(workspace.rootPath)
    if (projectInstructions) {
      systemLines.push('', 'Repository instructions:', projectInstructions)
    }

    return [
      { role: 'system', content: systemLines.join('\n') },
      { role: 'user', content: task.instruction },
    ]
  }
}

function truncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  return `${content.slice(0, maxLength)}\n\n[truncated ${content.length - maxLength} characters]`
}

function isMutatingFileInput(toolName: string, input: string): boolean {
  if (toolName !== 'file-ops') return false
  try {
    const action = (JSON.parse(input) as { action?: unknown }).action
    return action === 'write' || action === 'update' || action === 'patch'
  } catch {
    return false
  }
}

function isVerificationInput(toolName: string, input: string): boolean {
  if (toolName !== 'shell-runner') return false
  try {
    const argv = (JSON.parse(input) as { argv?: unknown }).argv
    return Array.isArray(argv) && /\b(test|typecheck|lint|build|check|tsc|eslint|vitest|jest)\b/i.test(argv.join(' '))
  } catch {
    return false
  }
}
