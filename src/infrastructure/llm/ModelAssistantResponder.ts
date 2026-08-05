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
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
import type { ContextCompactionPort } from '../../application/ports/ContextCompactionPort'
import type { CodeIndexerPort, RepoMapBuilderPort } from '../../application/ports/CodeIndexerPort'
import type { SkillService } from '../skills/SkillService'
import {
  createCliCommandOutputContent,
  createCliNoticeContent,
} from '../../application/support/CliTranscriptMarkup'
import { parseToolCallMarkup } from '../../application/support/ToolCallMarkup'
import { StreamingToolCallParser } from '../../application/support/StreamingToolCallParser'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { HookPort } from '../../application/ports/HookPort'

export class ModelAssistantResponder implements AssistantResponderPort {
  private readonly maxAgentTurns = 20

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

        // Stream text in real-time with streaming tool-call detection.
        // The parser holds back partial tag prefixes and suppresses tool-call XML
        // from being emitted as visible text. Normal prose streams immediately.
        const streamParser = new StreamingToolCallParser()
        let accumulated = ''

        for await (const chunk of this.gateway.streamChat({
          messages: activeMessages,
          model: this.config.model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          abortSignal: command.abortSignal,
        })) {
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

        const toolCall = flushResult.toolCall ?? parseToolCallMarkup(responseText)

        if (!toolCall) {
          yield { kind: 'text', delta: '', done: true }
          return
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

        const toolResult = await this.toolExecutor.execute({
          toolId: toolCall.name,
          input: toolCall.input,
          workspace: command.workspace,
        })

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

        activeMessages = [
          ...activeMessages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: [
              `Tool result for ${toolResult.toolId}:`,
              toolResult.ok ? 'status: ok' : 'status: failed',
              toolResult.content,
              '',
              'Continue the task. If another tool is required, emit one tool call only.',
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

    const systemPrompt = this.buildSystemPrompt(
      command.session,
      command.workspace,
      command.toolCatalog,
      this.cliConfig.getAssistantPromptSet(),
      command.memoryBlock,
      skillListing,
      repoMapBlock,
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
      '',
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
      '- Available executable tools: workspace-read, search-index, glob-search, file-ops, shell-runner, web-search, web-fetch.',
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

  private truncateForTranscript(content: string, maxLength: number): string {
    const normalized = content.trim()
    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength)}\n\n[truncated]`
  }
}
