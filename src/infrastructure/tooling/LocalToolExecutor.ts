import { relative } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ToolApprovalPort } from '../../application/ports/ToolApprovalPort'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorPort,
} from '../../application/ports/ToolExecutorPort'
import {
  classifyFileOpsRisk,
  resolveToolAuthorization,
} from '../../domain/tooling/services/ToolApprovalPolicy'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'
import { isApprovedDecision } from '../../domain/tooling/value-objects/ToolApproval'
import { ToolExecutionDeadline } from './ToolExecutionDeadline'
import { autoApproveToolApproval } from './PendingToolApprovalAdapter'
import { parseFileOpsRequest, runFileOps, type FileOpsRequest } from './handlers/fileOpsHandler'
import { handleSearchIndex } from './handlers/searchIndexHandler'
import { formatShellCommandEffect } from './classifyShellCommand'
import { parseShellRunnerRequest, runShellCommand } from './handlers/shellRunnerHandler'
import { toolFailure } from './handlers/ToolHandler'
import { replaceFirst } from './toolPathGuard'
import { handleWorkspaceRead } from './handlers/workspaceReadHandler'
import { handleGlobSearch } from './handlers/globSearchHandler'
import { handleWebFetch } from './handlers/webFetchHandler'
import { handleWebSearch } from './handlers/webSearchHandler'
import { formatTaskPreview, parseTaskRequest, runTaskBatch } from './handlers/taskHandler'
import type { McpRegistry } from '../mcp/McpClient'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'
import type { SubAgentOrchestratorPort } from '../../domain/agent/SubAgentOrchestratorPort'
import { computeDiffStats, computeLineDiff, formatDiffAsText } from '../diff/DiffEngine'
import type { PermissionMode } from '../../application/dto/UiPreferences'
import type { UserInteractionPort } from '../../application/ports/UserInteractionPort'
import { runAskUser } from './handlers/askUserHandler'
import type { RuntimeControlPort } from '../../application/ports/RuntimeControlPort'
import type { CodeDiagnostic, DiagnosticsPort } from '../../application/ports/DiagnosticsPort'
import { isAssistantMode } from '../../domain/assistant/value-objects/AssistantMode'
import type { AnimationLevel, PermissionMode as RuntimePermissionMode } from '../../application/dto/UiPreferences'
import { SUPPORTED_APP_LOCALES, type AppLocale } from '../../application/i18n/AppI18n'
import { handlePlanDocument } from './handlers/planDocumentHandler'
import { handleTodoWrite } from './handlers/todoWriteHandler'
import {
  RUNTIME_BUDGET_LIMITS,
  formatRuntimeBudget,
  normalizeRuntimeBudget,
  type RuntimeBudget,
  type RuntimeBudgetPatch,
  type RuntimeBudgetPort,
} from '../../application/ports/RuntimeBudgetPort'
import { MutableRuntimeBudget } from '../runtime/MutableRuntimeBudget'

/**
 * 工具调度入口。
 *
 * 分派到 handler，并在动作真正发生前统一做审批判定 —— 审批集中在这一层，
 * 因为只有解析完 payload 才知道「这是读还是写」「这条命令具体是什么」。
 * MCP 工具（mcp__前缀）委托给 McpRegistry 处理。
 *
 * 每次执行都有超时保护，防止卡死 agent 循环。计时只在真正干活时流逝，
 * 等用户审批的那段不算 —— 详见 ToolExecutionDeadline。
 */
/** file-ops 中会改动磁盘的动作 —— 只有这些需要事前快照。 */
const MUTATING_FILE_OPS = new Set(['write', 'update', 'patch', 'multi-patch'])

/** 内置可执行工具清单 —— 未知工具报错时回显给模型，帮它自纠而不是瞎猜。 */
const BUILTIN_TOOL_IDS = [
  'workspace-read',
  'search-index',
  'glob-search',
  'file-ops',
  'shell-runner',
  'web-search',
  'web-fetch',
  'task',
  'ask-user',
  'runtime-control',
  'plan-document',
  'todo-write',
] as const

export class LocalToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly approval: ToolApprovalPort = autoApproveToolApproval,
    private readonly mcpRegistry?: McpRegistry,
    private readonly checkpoints?: CheckpointManager,
    /**
     * 取子代理编排器。
     *
     * 传的是函数而不是实例：executor 在 gateway 之前就构造好了，而 gateway 还会随
     * `:model` 切换被替换掉。直接存实例会让 task 工具一直用着旧模型的网关。
     * 返回 undefined 表示当前没配 API key —— 此时 task 工具报错而不是静默失败。
     */
    private readonly resolveSubAgents?: () => SubAgentOrchestratorPort | undefined,
    private readonly resolvePermissionMode: () => PermissionMode = () => 'manual',
    private readonly userInteraction?: UserInteractionPort,
    private readonly runtimeControl?: RuntimeControlPort,
    private readonly runtimeBudget: RuntimeBudgetPort = new MutableRuntimeBudget(),
    /**
     * 写后诊断 provider（可选）。写入落盘且成功后，对被编辑文件做一次
     * 语言服务诊断，把类型/语法错误当轮反馈给模型。诊断是纯建议性的：
     * 未配置或失败都不影响写入结果。
     */
    private readonly diagnostics?: DiagnosticsPort,
  ) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const budget = this.runtimeBudget.get()
    const deadline = new ToolExecutionDeadline(
      request.toolId === 'task' ? budget.taskTimeoutMs : budget.toolTimeoutMs,
    )

    try {
      return await Promise.race([
        this.executeInner(request, deadline),
        deadline.expired.then(() => toolFailure(request.toolId, deadline.describeTimeout())),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return toolFailure(request.toolId, `Tool execution error: ${message}`)
    } finally {
      // 无论走哪条路都要清掉定时器，否则事件循环会被残留的 timer 按住。
      deadline.dispose()
    }
  }

  private async executeInner(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    // MCP tools are routed to the McpRegistry
    if (request.toolId.startsWith('mcp__') && this.mcpRegistry) {
      const denial = await this.ensureApproved(
        {
          toolId: request.toolId,
          riskLevel: 'dangerous',
          summary: `invoke external MCP tool ${request.toolId}`,
          scope: 'outside',
          kind: 'network',
          mutates: true,
        },
        deadline,
      )
      if (denial) return denial
      const mcpResult = await this.mcpRegistry.executeTool(request)
      if (mcpResult) {
        return mcpResult
      }
      return toolFailure(request.toolId, `MCP tool "${request.toolId}" is not registered.`)
    }

    switch (request.toolId) {
      case 'workspace-read':
        return handleWorkspaceRead(request)
      case 'search-index':
        return handleSearchIndex(request)
      case 'glob-search':
        return handleGlobSearch(request)
      case 'web-search':
        return handleWebSearch(request)
      case 'web-fetch':
        return handleWebFetch(request)
      case 'file-ops':
        return this.executeFileOps(request, deadline)
      case 'shell-runner':
        return this.executeShellRunner(request, deadline)
      case 'task':
        return this.executeTask(request, deadline)
      case 'ask-user':
        if (!this.userInteraction) {
          return toolFailure(request.toolId, 'Interactive user questions are unavailable in this runtime.')
        }
        deadline.pause()
        try {
          return await runAskUser(request, this.userInteraction)
        } finally {
          deadline.resume()
        }
      case 'runtime-control':
        return this.executeRuntimeControl(request, deadline)
      case 'plan-document':
        return handlePlanDocument(request)
      case 'todo-write':
        return handleTodoWrite(request)
      default: {
        // 模型偶尔会幻觉出不存在的工具名(常见:把 MCP 命名风格用到内置工具上,
        // 或沿用旧版工具名)。报错时附上真实可用清单,把一次注定失败的猜测
        // 变成一次可自纠的重试,省掉一整轮无效往返。
        const mcpHint = this.mcpRegistry
          ? ' (mcp__<server>__<tool> for external MCP tools)'
          : ''
        return toolFailure(
          request.toolId,
          `Unknown tool "${request.toolId}". Available tools:${mcpHint} ${BUILTIN_TOOL_IDS.join(', ')}.`,
        )
      }
    }
  }

  private async executeFileOps(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const parsed = parseFileOpsRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { action, resolvedPath } = parsed.value
    const targetPath = parsed.value.scope === 'outside'
      ? resolvedPath
      : toRelativePath(request.workspace.rootPath, resolvedPath)
    const scope = parsed.value.scope === 'outside' ? 'outside' : classifyWorkspaceTarget(targetPath)
    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel: classifyFileOpsRisk(action),
        summary: `${action} ${targetPath}`,
        targetPath,
        scope,
        kind: action === 'read' || action === 'list' ? 'read' : 'write',
        mutates: MUTATING_FILE_OPS.has(action),
        preview: await buildFileOpsPreview(parsed.value, targetPath),
      },
      deadline,
    )

    if (denial) {
      return denial
    }

    // Snapshot the pre-write state so a successful tool call can be rolled back later.
    // Failed validation or writes must not leave a restore point for an operation that never landed.
    let snapshotId: string | undefined
    if (this.checkpoints && parsed.value.scope === 'workspace' && MUTATING_FILE_OPS.has(action)) {
      try {
        snapshotId = this.checkpoints.captureBeforeWrite(
          targetPath,
          `file-ops ${action} ${targetPath}`,
          {
            sessionId: request.sessionId,
            toolId: request.toolId,
            toolInput: request.input,
          },
        )
      } catch {
        // Checkpoints are a recovery aid, not an availability boundary for an approved write.
      }
    }

    const result = await runFileOps(parsed.value)
    if (!result.ok && snapshotId) {
      this.checkpoints?.deleteSnapshot(snapshotId)
    }

    // 写后诊断：仅对工作区内、成功落盘的写入运行。诊断失败绝不改写 result。
    if (
      result.ok &&
      parsed.value.scope === 'workspace' &&
      MUTATING_FILE_OPS.has(action) &&
      this.diagnostics?.supportsFile(resolvedPath)
    ) {
      try {
        const found = await this.diagnostics.getFileDiagnostics(
          request.workspace.rootPath,
          resolvedPath,
        )
        const report = formatDiagnostics(found)
        if (report) {
          return { ...result, content: `${result.content}\n\n${report}` }
        }
      } catch {
        // 诊断是建议性的，任何异常都保持原始写入结果不变。
      }
    }

    return result
  }

  private async executeShellRunner(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const parsed = parseShellRunnerRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { riskLevel, summary, effect } = parsed.value.classification
    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel,
        summary,
        scope: 'workspace',
        kind: classifyShellIntentKind(summary),
        mutates: effect.writes.length > 0,
        // 命令风险展开：光一个 careful 标签说明不了批准之后会发生什么，
        // `git add` 和 `git reset --hard` 在面板上长得一模一样。
        preview: formatShellCommandEffect(effect),
      },
      deadline,
    )

    return denial ?? runShellCommand(parsed.value)
  }

  private async executeTask(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const orchestrator = this.resolveSubAgents?.()
    if (!orchestrator) {
      return toolFailure(
        request.toolId,
        'Sub-agents are unavailable because no model is configured. Do the work directly instead.',
      )
    }

    const budget = this.runtimeBudget.get()
    const parsed = parseTaskRequest(request, {
      maxTasks: budget.maxSubTasksPerBatch,
      maxConcurrency: budget.maxSubAgentConcurrency,
    })
    if (!parsed.ok) {
      return parsed.result
    }

    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel: 'careful',
        summary: `dispatch ${parsed.value.tasks.length} sub-agent task(s)`,
        scope: 'workspace',
        kind: 'orchestration',
        mutates: false,
        preview: formatTaskPreview(parsed.value),
      },
      deadline,
    )

    return denial ?? runTaskBatch(request, parsed.value, orchestrator)
  }

  private async executeRuntimeControl(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    if (!this.runtimeControl) {
      return toolFailure(request.toolId, 'Runtime settings control is unavailable.')
    }

    let input: {
      action?: unknown
      value?: unknown
      provider?: unknown
      model?: unknown
      budget?: unknown
      rationale?: unknown
    }
    try {
      input = JSON.parse(request.input) as typeof input
    } catch {
      return toolFailure(request.toolId, 'runtime-control input must be valid JSON.')
    }

    const action = typeof input.action === 'string' ? input.action : ''
    const value = typeof input.value === 'string' ? input.value.trim() : ''
    const rationale = typeof input.rationale === 'string' ? input.rationale.trim() : ''

    if (action === 'inspect') {
      return {
        toolId: request.toolId,
        ok: true,
        content: [
          `assistantMode=${request.session?.mode ?? 'unknown'}`,
          `permissionMode=${this.runtimeControl.getPermissionMode()}`,
          formatRuntimeBudget(this.runtimeControl.getRuntimeBudget?.() ?? this.runtimeBudget.get()),
          this.runtimeControl.inspect(),
        ].join('\n'),
      }
    }

    if (action === 'begin-execution') {
      if (!request.session) {
        return toolFailure(request.toolId, 'begin-execution requires an active session.')
      }
      const currentPermission = this.runtimeControl.getPermissionMode()
      const targetPermission = value || (currentPermission === 'plan' ? 'workspace' : currentPermission)
      if (!isPermissionMode(targetPermission)) {
        return toolFailure(request.toolId, 'begin-execution value must be manual, workspace, or auto when provided.')
      }
      if (targetPermission === 'plan') {
        return toolFailure(request.toolId, 'begin-execution cannot keep the permission mode in plan.')
      }

      const needsChange = request.session.mode === 'plan' || currentPermission === 'plan'
      if (!needsChange) {
        return { toolId: request.toolId, ok: true, content: 'Execution is already enabled.' }
      }

      const denial = await this.ensureApproved({
        toolId: request.toolId,
        riskLevel: 'dangerous',
        summary: `leave explicit plan restrictions and begin implementation with ${targetPermission} permissions`,
        scope: 'protected',
        kind: 'other',
        mutates: false,
        preview: rationale || 'The assistant will be able to edit workspace files and run checks under the selected permission policy.',
      }, deadline)
      if (denial) return denial

      request.session.switchMode('agent', new Date())
      if (currentPermission !== targetPermission) {
        await this.runtimeControl.setPermissionMode(targetPermission)
      }
      return {
        toolId: request.toolId,
        ok: true,
        content: `Execution enabled: assistantMode=agent, permissionMode=${targetPermission}. Continue the requested implementation now.`,
      }
    }

    if (action === 'set-assistant-mode') {
      if (!request.session || !isAssistantMode(value)) {
        return toolFailure(request.toolId, 'set-assistant-mode requires value chat, agent, or plan.')
      }
      const increasesCapability = request.session.mode === 'plan' && value !== 'plan'
      const denial = increasesCapability
        ? await this.ensureApproved({
            toolId: request.toolId,
            riskLevel: 'careful',
            summary: `switch assistant mode from ${request.session.mode} to ${value}`,
            scope: 'protected',
            kind: 'other',
            mutates: false,
            preview: rationale || undefined,
          }, deadline)
        : null
      if (denial) return denial
      request.session.switchMode(value, new Date())
      return { toolId: request.toolId, ok: true, content: `Assistant mode switched to ${value}.` }
    }

    if (action === 'set-permission-mode') {
      if (!isPermissionMode(value)) {
        return toolFailure(request.toolId, 'set-permission-mode requires manual, workspace, auto, or plan.')
      }
      const current = this.runtimeControl.getPermissionMode()
      const increasesCapability = permissionRank(value) > permissionRank(current)
      const denial = increasesCapability
        ? await this.ensureApproved({
            toolId: request.toolId,
            riskLevel: 'dangerous',
            summary: `increase tool permission mode from ${current} to ${value}`,
            scope: 'protected',
            kind: 'other',
            mutates: false,
            preview: rationale || undefined,
          }, deadline)
        : null
      if (denial) return denial
      await this.runtimeControl.setPermissionMode(value)
      return { toolId: request.toolId, ok: true, content: `Permission mode switched to ${value}.` }
    }

    if (action === 'set-language') {
      if (!SUPPORTED_APP_LOCALES.includes(value as AppLocale)) {
        return toolFailure(request.toolId, 'set-language requires zh-CN or en.')
      }
      await this.runtimeControl.setLocale(value as AppLocale)
      return { toolId: request.toolId, ok: true, content: `Language saved as ${value}; fully applies after restart.` }
    }

    if (action === 'set-animation') {
      if (!isAnimationLevel(value)) {
        return toolFailure(request.toolId, 'set-animation requires off, minimal, or full.')
      }
      await this.runtimeControl.setAnimationLevel(value)
      return { toolId: request.toolId, ok: true, content: `Animation level saved as ${value}.` }
    }

    if (action === 'set-runtime-budget') {
      const parsedBudget = parseRuntimeBudgetPatch(input.budget)
      if (!parsedBudget.ok) return toolFailure(request.toolId, parsedBudget.message)
      const current = this.runtimeControl.getRuntimeBudget?.() ?? this.runtimeBudget.get()
      const proposed = normalizeRuntimeBudget({ ...current, ...parsedBudget.patch })
      const denial = await this.ensureApproved({
        toolId: request.toolId,
        riskLevel: 'careful',
        summary: 'apply AI-proposed execution budget for this CLI session',
        scope: 'protected',
        kind: 'orchestration',
        mutates: false,
        preview: [rationale || 'The assistant requested more suitable limits for the current task.', '', formatRuntimeBudget(proposed)].join('\n'),
      }, deadline)
      if (denial) return denial
      const updated = this.runtimeControl.setRuntimeBudget?.(parsedBudget.patch)
        ?? this.runtimeBudget.update(parsedBudget.patch)
      return {
        toolId: request.toolId,
        ok: true,
        content: `Session execution budget updated:\n${formatRuntimeBudget(updated)}`,
      }
    }

    if (action === 'switch-model') {
      const provider = typeof input.provider === 'string' ? input.provider.trim() : ''
      const model = typeof input.model === 'string' ? input.model.trim() : undefined
      if (!provider) return toolFailure(request.toolId, 'switch-model requires a configured provider.')
      const denial = await this.ensureApproved({
        toolId: request.toolId,
        riskLevel: 'careful',
        summary: `switch model provider to ${provider}${model ? ` (${model})` : ''}`,
        scope: 'protected',
        kind: 'other',
        mutates: false,
        preview: rationale || undefined,
      }, deadline)
      if (denial) return denial
      const switched = this.runtimeControl.switchModel(provider, model)
      return switched
        ? { toolId: request.toolId, ok: true, content: `Model switched to ${switched.provider}/${switched.model}.` }
        : toolFailure(request.toolId, `Configured provider or model was not found: ${provider}${model ? `/${model}` : ''}.`)
    }

    return toolFailure(request.toolId, `Unsupported runtime-control action: ${action || '(missing)'}.`)
  }

  /**
   * 需要审批时等待用户决定。
   * 被拒绝时返回失败结果而不是抛异常 —— 模型能读到拒绝原因并改用别的方案，整轮对话不中断。
   *
   * 等人期间停表：真人在面板上斟酌的时间不该算作「工具跑了多久」，
   * 否则想久一点，一个已经批准的写入反而以超时收场。
   */
  private async ensureApproved(
    intent: ToolActionIntent,
    deadline?: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult | null> {
    const mode = this.resolvePermissionMode()
    const authorization = resolveToolAuthorization(intent, mode)
    if (authorization === 'allow') {
      return null
    }

    if (authorization === 'deny') {
      return toolFailure(
        intent.toolId,
        `Permission mode "${mode}" blocks this operation: ${intent.summary}.`,
      )
    }

    deadline?.pause()
    let decision: ToolApprovalDecision
    try {
      decision = await this.approval.requestApproval(intent)
    } finally {
      deadline?.resume()
    }

    if (isApprovedDecision(decision)) {
      return null
    }

    return toolFailure(
      intent.toolId,
      `The user denied this operation: ${intent.summary}. Do not retry it; explain the situation or propose a different approach.`,
    )
  }
}

function toRelativePath(rootPath: string, resolvedPath: string): string {
  return relative(rootPath, resolvedPath) || '.'
}

function parseRuntimeBudgetPatch(value: unknown):
  | { ok: true; patch: RuntimeBudgetPatch }
  | { ok: false; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'set-runtime-budget requires a non-empty budget object.' }
  }
  const patch: RuntimeBudgetPatch = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey as keyof RuntimeBudget
    if (!(key in RUNTIME_BUDGET_LIMITS)) {
      return { ok: false, message: `Unknown runtime budget field: ${rawKey}.` }
    }
    const [min, max] = RUNTIME_BUDGET_LIMITS[key]
    if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < min || rawValue > max) {
      return { ok: false, message: `${rawKey} must be an integer from ${min} to ${max}.` }
    }
    patch[key] = rawValue
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'set-runtime-budget requires at least one budget field.' }
  }
  return { ok: true, patch }
}

function classifyWorkspaceTarget(targetPath: string): 'workspace' | 'protected' {
  const normalized = targetPath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  return normalized === '.git' ||
    normalized.startsWith('.git/') ||
    normalized === '.adnify' ||
    normalized.startsWith('.adnify/') ||
    normalized === '.env' ||
    normalized.startsWith('.env.') ||
    normalized.endsWith('.pem') ||
    normalized.endsWith('.key')
    ? 'protected'
    : 'workspace'
}

function classifyShellIntentKind(summary: string): 'verification' | 'git' | 'install' | 'other' {
  const normalized = summary.toLowerCase()
  if (/^(?:bun test|bun run (?:build|typecheck|test|lint|check)|npm (?:test|run (?:build|test|lint|typecheck))|pnpm (?:test|run (?:build|test|lint|typecheck))|yarn (?:test|build|lint|typecheck)|(?:bunx|npx )?(?:tsc|eslint|vitest|jest))\b/.test(normalized)) {
    return 'verification'
  }
  if (/^(?:npm|pnpm|yarn) (?:install|ci|i|add)\b|^(?:npx|bunx|bun x)\b/.test(normalized)) {
    return 'install'
  }
  if (/^git\b/.test(normalized)) return 'git'
  return 'other'
}

function isPermissionMode(value: string): value is RuntimePermissionMode {
  return value === 'manual' || value === 'workspace' || value === 'auto' || value === 'plan'
}

function permissionRank(mode: RuntimePermissionMode): number {
  switch (mode) {
    case 'plan': return 0
    case 'manual': return 1
    case 'workspace': return 2
    case 'auto': return 3
  }
}

function isAnimationLevel(value: string): value is AnimationLevel {
  return value === 'off' || value === 'minimal' || value === 'full'
}

/**
 * 把写后诊断格式化为附加到工具结果的一段文本。
 *
 * 无诊断时返回 null（对干净的写入保持沉默，省 token）。有诊断时先给错误、
 * 再给警告，并明确要求模型当轮处理 —— 这样模型无需再单独跑一遍 typecheck
 * 就能看到自己刚引入的问题。
 */
function formatDiagnostics(diagnostics: CodeDiagnostic[]): string | null {
  if (diagnostics.length === 0) {
    return null
  }

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} error(s)`)
  if (warnings > 0) parts.push(`${warnings} warning(s)`)

  const lines = diagnostics.map(
    (d) => `  L${d.line}:${d.column} ${d.severity} TS${d.code}: ${d.message.split('\n')[0]}`,
  )

  return [
    `⚠ TypeScript reported ${parts.join(' and ')} in ${diagnostics[0].file} after this edit:`,
    ...lines,
    'Fix these before continuing, or explain why they are expected.',
  ].join('\n')
}

/**
 * 为待批准的写入构造 diff 预览。
 *
 * 这里算的是「还没落盘的改动」—— git diff 此刻看不到任何东西，
 * 所以必须自己把新旧内容对比出来。
 *
 * 返回完整 diff，不在这一层截断：终端有多高只有 presentation 知道，
 * 在基础设施层写死行数，换个窗口大小就是错的。折叠交给审批面板做。
 *
 * 任何失败都退化为「没有预览」，绝不因为预览算不出来就挡住写入。
 */
async function buildFileOpsPreview(
  parsed: FileOpsRequest,
  targetPath: string,
): Promise<string | undefined> {
  const { action, prompt, resolvedPath } = parsed

  if (!MUTATING_FILE_OPS.has(action)) {
    return undefined
  }

  try {
    const currentContent = await readFile(resolvedPath, 'utf8').catch(() => null)

    let nextContent: string | null = null

    if (action === 'write') {
      nextContent = typeof prompt.content === 'string' ? prompt.content : null
    } else {
      const oldText = typeof prompt.oldText === 'string' ? prompt.oldText : null
      const newText = typeof prompt.newText === 'string' ? prompt.newText : null

      if (currentContent !== null && oldText && newText !== null) {
        nextContent =
          prompt.replaceAll === true
            ? currentContent.split(oldText).join(newText)
            : replaceFirst(currentContent, oldText, newText)
      }
    }

    if (nextContent === null) {
      return undefined
    }

    // 新建文件时没有「原内容」，与空串比较即可得到全量新增。
    const ops = computeLineDiff(currentContent ?? '', nextContent)
    const stats = computeDiffStats(ops)

    if (stats.additions === 0 && stats.deletions === 0) {
      return 'No effective change.'
    }

    const body = formatDiffAsText(ops, targetPath)

    return [body, `+${stats.additions} -${stats.deletions}`].join('\n')
  } catch {
    return undefined
  }
}
