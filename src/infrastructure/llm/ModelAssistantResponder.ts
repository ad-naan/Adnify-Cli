import type { AssistantPromptSet } from '../../application/dto/AssistantPromptSet'
import type { AppI18n } from '../../application/i18n/AppI18n'
import type {
  AssistantApprovalCommand,
  AssistantReply,
  AssistantResponderCommand,
  AssistantResponderPort,
  AssistantStreamChunk,
} from '../../application/ports/AssistantResponderPort'
import type { CliConfigPort } from '../../application/ports/CliConfigPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelGatewayPort, ModelMessage } from '../../application/ports/ModelGatewayPort'
import type { ToolExecutionResult, ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
import type { ContextCompactionPort } from '../../application/ports/ContextCompactionPort'
import type { CodeIndexerPort, RepoMapBuilderPort } from '../../application/ports/CodeIndexerPort'
import type { SkillService } from '../skills/SkillService'
import {
  createCliCommandOutputContent,
  createCliNoticeContent,
} from '../../application/support/CliTranscriptMarkup'
import { parseToolCallMarkup } from '../../application/support/ToolCallMarkup'
import { StreamingToolCallParser } from '../../application/support/StreamingToolCallParser'
import { toModelToolDefinitions } from '../tooling/toolInputSchemas'
import { ToolProgressChannel } from './ToolProgressChannel'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { HookPort } from '../../application/ports/HookPort'
import { loadProjectInstructions } from '../prompt/loadProjectInstructions'
import { classifyShellCommand } from '../tooling/classifyShellCommand'

type WorkflowPhase = 'plan' | 'execute'

export class ModelAssistantResponder implements AssistantResponderPort {
  private readonly maxAgentTurns = 20

  /**
   * 该 gateway 是否真的走通了原生 function calling。
   * null 表示还没观察到 —— 此时按最保守的方式处理：仍然注入 XML 协议散文。
   * 一旦确认原生可用就不再注入，避免模型在两套协议之间摇摆。
   * gateway 换了（updateGateway）就要重新观察。
   */
  private nativeToolsSupported: boolean | null = null

  constructor(
    private gateway: ModelGatewayPort,
    private config: ModelConfig,
    private readonly cliConfig: CliConfigPort,
    private readonly toolExecutor: ToolExecutorPort,
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
    private readonly skillService?: SkillService,
    private readonly compactor?: ContextCompactionPort,
    private readonly repoMapBuilder?: RepoMapBuilderPort,
    private readonly codeIndexer?: CodeIndexerPort,
    private readonly hooks?: HookPort,
  ) {}

  updateGateway(gateway: ModelGatewayPort, config: ModelConfig): void {
    this.gateway = gateway
    this.config = config
    // 换了 provider/endpoint，原生工具的结论不再适用。
    this.nativeToolsSupported = null
  }

  /**
   * Approval decisions are handled by the tool executor layer,
   * not by the responder. This method exists to satisfy the interface
   * but is a no-op — the PendingToolApprovalAdapter resolves directly.
   */
  async *streamApprovalDecision(
    _command: AssistantApprovalCommand,
  ): AsyncIterable<AssistantStreamChunk> {
    yield { kind: 'text', delta: '', done: true }
  }

  async generateReply(command: AssistantResponderCommand): Promise<AssistantReply> {
    const chunks: string[] = []
    for await (const chunk of this.streamReply(command)) {
      chunks.push(chunk.delta)
    }

    return { content: chunks.join('') }
  }

  async *streamReply(command: AssistantResponderCommand): AsyncIterable<AssistantStreamChunk> {
    const messages = await this.buildMessages(command)

    this.logger.debug('Sending request to model gateway', {
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length,
      mode: command.session.mode,
    })

    try {
      let activeMessages = [...messages]
      const canRunVerification = command.toolCatalog.some((tool) => tool.id === 'shell-runner')
      let verificationRequired = false
      let verificationNudgeSent = false
      let workflowPhase: WorkflowPhase = command.session.mode === 'plan' ? 'plan' : 'execute'

      for (let turn = 0; turn < this.maxAgentTurns; turn += 1) {
        // Auto-compaction: if context is approaching the token limit, compress
        if (this.compactor && this.compactor.needsCompaction(activeMessages, this.config.maxTokens)) {
          const result = await this.compactor.compact(
            activeMessages,
            this.config.maxTokens,
            command.abortSignal,
          )
          activeMessages = result.messages

          yield {
            kind: 'transcript',
            delta: '',
            transcript: createCliNoticeContent(
              [
                this.i18n.locale === 'en'
                  ? `Context compressed: ${result.compactedCount} messages summarized (${result.tokensBefore} → ${result.tokensAfter} tokens).`
                  : `上下文已压缩：摘要了 ${result.compactedCount} 条消息（${result.tokensBefore} → ${result.tokensAfter} tokens）。`,
              ].join('\n'),
              {
                title: this.i18n.locale === 'en' ? 'Context Compacted' : '上下文已压缩',
                tone: 'info',
              },
            ),
            done: false,
          }
        }
        // Hook: beforeModelRequest (a before* hook returning false aborts)
        if (this.hooks) {
          const proceed = await this.hooks.emit({
            event: 'beforeModelRequest',
            sessionId: command.session.id,
            modelName: this.config.model,
            messageCount: activeMessages.length,
            timestamp: Date.now(),
          })
          if (!proceed) {
            yield { kind: 'text', delta: '', done: true }
            return
          }
        }

        // 两条工具通道：
        //  1. 原生 function calling —— chunk.toolCall 直接给出结构化调用；
        //  2. 文本回退 —— provider 不支持 tools 时，模型输出 XML，由 StreamingToolCallParser 抠出来。
        // 文本解析器无条件喂入：它同时负责把 XML 从可见正文里挡掉。原生模式下模型不会
        // 输出那个标签，解析器就是个透传。
        const streamParser = new StreamingToolCallParser()
        let accumulated = ''
        let nativeToolCall: { toolCallId: string; name: string; input: string } | null = null

        for await (const chunk of this.gateway.streamChat({
          messages: activeMessages,
          model: this.config.model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          abortSignal: command.abortSignal,
          tools: toModelToolDefinitions(command.toolCatalog),
        })) {
          if (chunk.usedNativeTools !== undefined) {
            this.nativeToolsSupported = chunk.usedNativeTools
          }

          if (chunk.toolCall && !nativeToolCall) {
            // 一轮只执行一个工具调用 —— 与审批流程和回填顺序保持一致。
            nativeToolCall = {
              toolCallId: chunk.toolCall.toolCallId,
              name: chunk.toolCall.toolName,
              input: chunk.toolCall.input,
            }
          }

          accumulated += chunk.delta
          const parsed = streamParser.push(chunk.delta)
          if (parsed.text) {
            yield { kind: 'text', delta: parsed.text, done: false }
          }
        }

        const flushResult = streamParser.flush()
        if (flushResult.text) {
          yield { kind: 'text', delta: flushResult.text, done: false }
        }

        const responseText = accumulated.trim()

        // Hook: afterModelResponse
        if (this.hooks) {
          await this.hooks.emit({
            event: 'afterModelResponse',
            sessionId: command.session.id,
            modelName: this.config.model,
            messageCount: activeMessages.length,
            timestamp: Date.now(),
          })
        }

        // 原生调用优先。回退路径里 parseToolCallMarkup 兜住 streamParser 没识别的形态
        // （例如模型在标签前后多说了话，导致解析器没进入 tool-call 模式）。
        const toolCall =
          nativeToolCall ?? flushResult.toolCall ?? parseToolCallMarkup(responseText)

        if (!toolCall && verificationRequired && !verificationNudgeSent) {
          verificationNudgeSent = true
          activeMessages = [
            ...activeMessages,
            { role: 'assistant', content: responseText },
            {
              role: 'user',
              content: [
                'You successfully modified workspace files but have not attempted verification yet.',
                'Before giving the final answer, use shell-runner to run the narrowest relevant test, typecheck, lint, or build command.',
                'If verification cannot run or fails, report that evidence explicitly in the final answer.',
              ].join('\n'),
            },
          ]
          yield {
            kind: 'transcript',
            delta: '',
            transcript: createCliNoticeContent(
              this.i18n.locale === 'en'
                ? 'Files changed. Running a verification pass before finishing.'
                : '文件已修改，结束前正在执行验证检查。',
              {
                title: this.i18n.locale === 'en' ? 'Verification required' : '需要验证',
                tone: 'info',
              },
            ),
            done: false,
          }
          continue
        }

        if (!toolCall) {
          yield { kind: 'text', delta: '', done: true }
          return
        }

        if (toolCall.name === 'workflow-phase') {
          const transition = resolveWorkflowTransition(toolCall.input, command.session.mode, workflowPhase)
          if (transition.ok) workflowPhase = transition.phase

          yield {
            kind: 'transcript',
            delta: '',
            workflowPhase: transition.ok ? transition.phase : undefined,
            transcript: createCliNoticeContent(transition.message, {
              title: transition.ok
                ? this.i18n.locale === 'en'
                  ? `Workflow · ${transition.phase}`
                  : `工作阶段 · ${transition.phase === 'plan' ? '规划' : '执行'}`
                : this.i18n.locale === 'en'
                  ? 'Workflow phase rejected'
                  : '工作阶段切换被拒绝',
              tone: transition.ok ? 'info' : 'warning',
            }),
            done: false,
          }

          activeMessages = appendToolResultMessages(
            activeMessages,
            nativeToolCall,
            responseText,
            toolCall,
            {
              toolId: toolCall.name,
              ok: transition.ok,
              content: transition.message,
            },
          )
          continue
        }

        yield {
          kind: 'transcript',
          delta: '',
          transcript: createCliNoticeContent(
            [
              this.i18n.locale === 'en'
                ? `Executing assistant tool request (turn ${turn + 1}/${this.maxAgentTurns}).`
                : `正在执行助手工具请求（第 ${turn + 1}/${this.maxAgentTurns} 轮）。`,
              `tool: ${toolCall.name}`,
              `input: ${this.truncateForTranscript(toolCall.input, 400)}`,
            ].join('\n'),
            {
              title: `${this.i18n.t('transcript.tools')} · ${toolCall.name}`,
              tone: 'info',
            },
          ),
          done: false,
        }

        // Hook: beforeToolExecute
        if (this.hooks) {
          const proceed = await this.hooks.emit({
            event: 'beforeToolExecute',
            sessionId: command.session.id,
            toolName: toolCall.name,
            toolInput: toolCall.input,
            timestamp: Date.now(),
          })
          if (!proceed) {
            yield {
              kind: 'transcript',
              delta: '',
              transcript: createCliNoticeContent(
                this.i18n.locale === 'en'
                  ? 'Tool execution blocked by a hook handler.'
                  : '工具执行被 hook 拦截。',
                {
                  title: `${this.i18n.t('transcript.tools')} · ${toolCall.name}`,
                  tone: 'warning',
                },
              ),
              done: false,
            }
            break
          }
        }

        const toolStartTime = Date.now()

        // 长工具（子代理批次）在执行途中会推进度。回调里没法 yield，
        // 所以先进 channel，再由 drain 转成 transcript 事件推上屏。
        let toolResult: ToolExecutionResult
        if ((workflowPhase === 'plan' || command.session.mode === 'plan') && isExecutionToolCall(toolCall.name, toolCall.input)) {
          toolResult = {
            toolId: toolCall.name,
            ok: false,
            content: [
              'The current workflow phase is read-only planning.',
              command.session.mode === 'plan'
                ? 'The user explicitly selected plan mode, so execution cannot be enabled automatically.'
                : 'Finish the actionable plan, then call workflow-phase with phase="execute" before modifying files or running execution commands.',
            ].join(' '),
          }
        } else {
          const channel = new ToolProgressChannel((onProgress) =>
            this.toolExecutor.execute({
              toolId: toolCall.name,
              input: toolCall.input,
              workspace: command.workspace,
              sessionId: command.session.id,
              session: command.session,
              abortSignal: command.abortSignal,
              onProgress,
            }),
          )

          for await (const progress of channel.drain()) {
            yield {
              kind: 'transcript',
              delta: '',
              transcript: createCliNoticeContent(progress.message, {
                title: `${this.i18n.t('transcript.tools')} · ${progress.toolId}`,
                tone: progress.ok === false ? 'warning' : 'info',
              }),
              done: false,
            }
          }

          toolResult = await channel.result
        }

        if (toolResult.ok && isMutatingFileCall(toolCall.name, toolCall.input) && canRunVerification) {
          verificationRequired = true
          verificationNudgeSent = false
        } else if (verificationRequired && isVerificationCall(toolCall.name, toolCall.input)) {
          // An attempted check closes the mandatory loop even when it fails; the model receives
          // the failure and must explain it instead of repeatedly requesting the same approval.
          verificationRequired = false
        }

        const toolElapsedMs = Date.now() - toolStartTime

        this.logger.info('Executed assistant tool call', {
          toolId: toolResult.toolId,
          ok: toolResult.ok,
          mode: command.session.mode,
          elapsedMs: toolElapsedMs,
        })

        // Hook: afterToolExecute
        if (this.hooks) {
          await this.hooks.emit({
            event: 'afterToolExecute',
            sessionId: command.session.id,
            toolName: toolResult.toolId,
            toolInput: toolCall.input,
            toolOutput: toolResult.content,
            toolSuccess: toolResult.ok,
            timestamp: Date.now(),
          })
        }

        const elapsedLabel =
          toolElapsedMs >= 1000
            ? `${(toolElapsedMs / 1000).toFixed(1)}s`
            : `${toolElapsedMs}ms`

        yield {
          kind: 'transcript',
          delta: '',
          transcript: createCliCommandOutputContent(
            [
              toolResult.ok
                ? this.i18n.locale === 'en'
                  ? 'Tool completed successfully.'
                  : '工具执行成功完成。'
                : this.i18n.locale === 'en'
                  ? 'Tool execution failed.'
                  : '工具执行失败。',
              `elapsed: ${elapsedLabel}`,
              '',
              this.truncateForTranscript(toolResult.content, 1600),
            ].join('\n'),
            {
              title: `${this.i18n.t('transcript.tools')} · ${toolResult.toolId}`,
              tone: toolResult.ok ? 'success' : 'danger',
            },
          ),
          done: false,
        }

        // 原生 function calling 必须保留 toolCallId，并使用标准 tool role 回填。
        // 文本协议仍保持 user 文本回填，以兼容那些连 tool-role 消息也不接受的 endpoint。
        activeMessages = nativeToolCall
          ? [
              ...activeMessages,
              {
                role: 'assistant',
                content: responseText,
                toolCalls: [{
                  toolCallId: nativeToolCall.toolCallId,
                  toolName: nativeToolCall.name,
                  input: nativeToolCall.input,
                }],
              },
              {
                role: 'tool',
                content: toolResult.content,
                toolCallId: nativeToolCall.toolCallId,
                toolName: nativeToolCall.name,
                ok: toolResult.ok,
              },
            ]
          : [
              ...activeMessages,
              { role: 'assistant', content: responseText },
              {
                role: 'user',
                content: [
                  `Tool result for ${toolResult.toolId}:`,
                  toolResult.ok ? 'status: ok' : 'status: failed',
                  toolResult.content,
                  '',
                  'Continue the task. If another tool is required, request one tool call only.',
                ].join('\n'),
              },
            ]
      }

      yield {
        kind: 'text',
        delta:
          this.i18n.locale === 'en'
            ? 'I reached the current tool-execution turn limit. Please refine the request or continue.'
            : '已达到当前工具执行轮次上限，请继续细化需求或再次发起执行。',
        done: true,
      }
    } catch (error) {
      this.logger.error('Model gateway error', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }



  private async buildMessages(command: AssistantResponderCommand): Promise<ModelMessage[]> {
    const skillListing = this.skillService
      ? await this.skillService.buildListingBlock(command.session.mode)
      : ''

    // Build repo map from code index (if available)
    const repoMapBlock = await this.buildRepoMapBlock(command)
    const projectInstructions = await loadProjectInstructions(command.workspace.rootPath)

    const systemPrompt = this.buildSystemPrompt(
      command.session,
      command.workspace,
      command.toolCatalog,
      this.cliConfig.getAssistantPromptSet(),
      command.memoryBlock,
      skillListing,
      repoMapBlock,
      projectInstructions,
      // 还没确认原生可用时也注入 —— 第一轮宁可多给一段散文，也不能让工具完全不可用。
      this.nativeToolsSupported !== true,
    )

    const messages: ModelMessage[] = [{ role: 'system', content: systemPrompt }]

    for (const message of command.session.getMessages()) {
      if (message.role === 'system') {
        continue
      }

      messages.push({ role: message.role, content: message.content })
    }

    if (!messages.some((message) => message.role === 'user' && message.content === command.prompt)) {
      messages.push({ role: 'user', content: command.prompt })
    }

    return messages
  }

  private buildSystemPrompt(
    session: ConversationSession,
    workspace: WorkspaceContext,
    toolCatalog: AssistantResponderCommand['toolCatalog'],
    promptSet: AssistantPromptSet,
    memoryBlock?: string,
    skillListing?: string,
    repoMapBlock?: string,
    projectInstructions?: string,
    includeTextToolProtocol = true,
  ): string {
    const modePrompt = promptSet.modes[session.mode]
    const toolBlock =
      (toolCatalog as Array<{ name: string; category: string; riskLevel: string; description: string }>)
        .map((tool) => `- ${tool.name} [${tool.category}] (${tool.riskLevel}): ${tool.description}`)
        .join('\n') || this.i18n.t('modelPrompt.noTools')

    const workspaceBlock = [
      this.i18n.t('modelPrompt.currentMode', { mode: session.mode }),
      this.i18n.t('modelPrompt.workspaceRoot', { value: workspace.rootPath }),
      this.i18n.t('modelPrompt.packageManager', { value: workspace.packageManager }),
      this.i18n.t('modelPrompt.gitRepository', {
        value: this.i18n.t(workspace.isGitRepository ? 'common.yes' : 'common.no'),
      }),
      this.i18n.t('modelPrompt.topLevelEntries', {
        value: workspace.topLevelEntries.join(', ') || this.i18n.t('workspace.none'),
      }),
    ].join('\n')

    const promptParts: string[] = [
      promptSet.core.trim(),
      '',
      this.i18n.t('modelPrompt.respondIn', {
        language: this.i18n.t('modelPrompt.language.self'),
      }),
      '',
    ]

    if (memoryBlock) {
      promptParts.push(memoryBlock, '')
    }

    if (skillListing) {
      promptParts.push(skillListing, '')
    }

    if (repoMapBlock) {
      promptParts.push(repoMapBlock, '')
    }

    if (projectInstructions) {
      promptParts.push(
        '## Project Instructions',
        'Follow these repository-owned rules unless they conflict with higher-priority system or user instructions.',
        projectInstructions,
        '',
      )
    }

    promptParts.push(
      '## Mode Instructions',
      modePrompt.trim(),
      '',
      '## Runtime Workspace Context',
      workspaceBlock,
      '',
      '## Available Tool Definitions',
      toolBlock,
      '',
    )

    // 原生 function calling 已经把参数契约交给模型了（见 toolInputSchemas.ts）。
    // 这时再注入一遍 XML 协议只会让模型在两种调用方式之间摇摆，反而更容易出错。
    if (includeTextToolProtocol) {
      promptParts.push(
        '## Tool Calling Protocol',
        `When you need a tool, respond with exactly one ${'<adnify_tool_call name="tool-id">...</adnify_tool_call>'} block and nothing else.`,
        'The inner content must be valid JSON.',
        'For file-ops, use JSON like {"action":"read","path":"src/main.tsx"}, {"action":"list","path":"src"}, {"action":"write","path":"src/example.ts","content":"...","allowWrite":true}, or {"action":"update","path":"src/example.ts","oldText":"before","newText":"after","allowWrite":true}.',
        'For search-index, use JSON like {"query":"useState","limit":10}.',
        'For glob-search, use JSON like {"pattern":"src/**/*.ts"} or {"patterns":["*.test.ts","*.spec.ts"]}.',
        'For shell-runner, use JSON like {"argv":["rg","query","src"]}.',
        'For web-search, use JSON like {"query":"React 19 features","limit":5}.',
        'For web-fetch, use JSON like {"url":"https://docs.example.com/api"}.',
        'For workspace-read, use JSON like {} or {"focus":"package.json"}.',
        'For ask-user, provide 1-3 questions with 2-3 labeled options each. The terminal renders them as keyboard choice tabs.',
        'For workflow-phase, use {"phase":"plan|execute","rationale":"short reason"}.',
        'For runtime-control, choose one supported action and explain the reason. Never handle API keys through this tool.',
        '',
      )
    }

    promptParts.push(
      '## Shell Command Whitelist',
      'Safe (no approval): rg, grep, find, cat, head, tail, wc, sort, uniq, git status/diff/log/show/branch/rev-parse/remote/tag/ls-files/blame/shortlog/describe.',
      'Careful (approval required): bun test/run/x, npm/pnpm/yarn run <script>/install/ci, npx tsc/eslint/prettier/vitest/jest, tsc.',
      'Git mutations (approval required): git add/commit/stash/checkout/reset/restore.',
      'Anything else is rejected outright.',
      '',
      '## Agent Discipline',
      '- Use tools proactively: read the code before editing, search before guessing, verify after changes.',
      '- You can chain up to 20 tool calls in a single task turn — use them generously.',
      '- Risky actions pause for user approval: file-ops write/update/patch, verification commands, git mutations. If denied, do not retry — explain and propose alternatives.',
      '- After the tool result is returned, continue the task normally.',
      '- Prefer search-index for text search, glob-search for file discovery, file-ops for reading/editing, shell-runner for running checks.',
      '- Use web-search to find current documentation or solutions, then web-fetch to read specific pages.',
      '- Use ask-user only when a missing choice materially changes the result; do not ask for facts you can discover with tools.',
      '- In agent mode, judge task complexity yourself. For multi-file, architectural, migration, or high-uncertainty work, call workflow-phase(plan), investigate and form an actionable plan, then call workflow-phase(execute) and implement. Skip the planning phase for simple, well-scoped changes.',
      '- While the workflow phase is plan, the host blocks mutations and execution commands. Explicit session plan mode can never be promoted automatically.',
      '- Use runtime-control when changing modes or settings would help the task. The host decides whether the change is automatic, asks the user, or is denied.',
      '- Available executable tools: workspace-read, search-index, glob-search, file-ops, shell-runner, web-search, web-fetch, ask-user, workflow-phase, runtime-control.',
    )

    return promptParts.join('\n')
  }
 
  /**
   * 构建 repo map 文本块。从代码索引提取符号表，计算 PageRank，按 token 预算裁剪。
   */
  private async buildRepoMapBlock(command: AssistantResponderCommand): Promise<string> {
    if (!this.repoMapBuilder || !this.codeIndexer) {
      return ''
    }

    try {
      // Extract chat context: find file paths mentioned in conversation
      const chatFilePaths = this.extractChatFilePaths(command.session.getMessages())
      chatFilePaths.push(command.prompt)

      // Budget: allocate ~15% of max tokens to repo map
      const repoMapBudget = Math.floor(this.config.maxTokens * 0.15)

      const indices = await this.codeIndexer.indexWorkspace(command.workspace.rootPath)
      const repoMap = this.repoMapBuilder.buildFromIndex(indices, chatFilePaths, repoMapBudget)

      if (repoMap.files.length === 0) {
        return ''
      }

      const treeString = this.repoMapBuilder.toTreeString(repoMap)

      return [
        '## Repository Map',
        'The following is a ranked map of the codebase. Files are ordered by importance (PageRank).',
        'Use this to locate code without reading files first.',
        '```',
        treeString,
        '```',
      ].join('\n')
    } catch (error) {
      this.logger.warn('Failed to build repo map', {
        error: error instanceof Error ? error.message : String(error),
      })
      return ''
    }
  }

  /**
   * 从对话历史中提取看起来像文件路径的字符串。
   */
  private extractChatFilePaths(messages: ReadonlyArray<{ content: string }>): string[] {
    const paths: string[] = []
    const pathRegex = /([\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|rb|php|cs|c|cpp|h|hpp))/g

    for (const message of messages) {
      const matches = message.content.matchAll(pathRegex)
      for (const match of matches) {
        paths.push(match[1])
      }
    }

    return paths
  }

  /**
   * 面向模型的转录压缩：控制上下文占用，与终端高度无关，所以按字符算。
   * 标注省略量，让模型知道自己看到的不是全部。
   */
  private truncateForTranscript(content: string, maxLength: number): string {
    const normalized = content.trim()
    if (normalized.length <= maxLength) {
      return normalized
    }

    const omitted = normalized.length - maxLength

    return `${normalized.slice(0, maxLength)}\n\n[truncated: ${omitted} of ${normalized.length} characters omitted]`
  }
}

function isMutatingFileCall(toolName: string, input: string): boolean {
  if (toolName !== 'file-ops') return false
  try {
    const action = (JSON.parse(input) as { action?: unknown }).action
    return action === 'write' || action === 'update' || action === 'patch'
  } catch {
    return false
  }
}

function isVerificationCall(toolName: string, input: string): boolean {
  if (toolName !== 'shell-runner') return false
  try {
    const argv = (JSON.parse(input) as { argv?: unknown }).argv
    if (!Array.isArray(argv) || !argv.every((part) => typeof part === 'string')) return false
    const command = argv.join(' ').toLowerCase()
    return /(?:^|\s)(?:test|typecheck|lint|build|check)(?:\s|$)|\b(?:tsc|eslint|vitest|jest)\b/.test(command)
  } catch {
    return false
  }
}

function resolveWorkflowTransition(
  input: string,
  sessionMode: 'chat' | 'agent' | 'plan',
  currentPhase: WorkflowPhase,
): { ok: true; phase: WorkflowPhase; message: string } | { ok: false; message: string } {
  let parsed: { phase?: unknown; rationale?: unknown }
  try {
    parsed = JSON.parse(input) as { phase?: unknown; rationale?: unknown }
  } catch {
    return { ok: false, message: 'workflow-phase input must be valid JSON.' }
  }

  if (parsed.phase !== 'plan' && parsed.phase !== 'execute') {
    return { ok: false, message: 'workflow-phase requires phase="plan" or phase="execute".' }
  }

  const rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim()
    ? parsed.rationale.trim()
    : 'No rationale supplied.'

  if (parsed.phase === 'execute' && sessionMode === 'plan') {
    return {
      ok: false,
      message: 'The user explicitly selected session plan mode. AI cannot promote it to execution; ask the user to switch modes.',
    }
  }

  if (parsed.phase === currentPhase) {
    return { ok: true, phase: currentPhase, message: `Workflow already in ${currentPhase} phase. ${rationale}` }
  }

  return {
    ok: true,
    phase: parsed.phase,
    message: parsed.phase === 'plan'
      ? `Entered read-only planning phase. ${rationale}`
      : `Planning complete; resumed execution under the user's existing permission policy. ${rationale}`,
  }
}

function isExecutionToolCall(toolName: string, input: string): boolean {
  if (isMutatingFileCall(toolName, input) || toolName.startsWith('mcp__')) return true

  if (toolName === 'shell-runner') {
    try {
      const argv = (JSON.parse(input) as { argv?: unknown }).argv
      if (!Array.isArray(argv) || !argv.every((part) => typeof part === 'string')) return true
      const classification = classifyShellCommand(argv)
      return !classification.ok || classification.riskLevel !== 'safe'
    } catch {
      return true
    }
  }

  if (toolName === 'task') {
    try {
      const tasks = (JSON.parse(input) as { tasks?: unknown }).tasks
      return Array.isArray(tasks) && tasks.some((task) => (
        typeof task === 'object' && task !== null && (task as { role?: unknown }).role === 'implement'
      ))
    } catch {
      return true
    }
  }

  return false
}

function appendToolResultMessages(
  messages: ModelMessage[],
  nativeToolCall: { toolCallId: string; name: string; input: string } | null,
  responseText: string,
  toolCall: { name: string; input: string },
  result: ToolExecutionResult,
): ModelMessage[] {
  if (nativeToolCall) {
    return [
      ...messages,
      {
        role: 'assistant',
        content: responseText,
        toolCalls: [{
          toolCallId: nativeToolCall.toolCallId,
          toolName: nativeToolCall.name,
          input: nativeToolCall.input,
        }],
      },
      {
        role: 'tool',
        content: result.content,
        toolCallId: nativeToolCall.toolCallId,
        toolName: nativeToolCall.name,
        ok: result.ok,
      },
    ]
  }

  return [
    ...messages,
    { role: 'assistant', content: responseText },
    {
      role: 'user',
      content: [
        `Tool result for ${result.toolId}:`,
        result.ok ? 'status: ok' : 'status: failed',
        result.content,
        '',
        'Continue the task. If another tool is required, request one tool call only.',
      ].join('\n'),
    },
  ]
}
