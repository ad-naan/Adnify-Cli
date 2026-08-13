import { useStdout, type Key } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BootstrapSnapshot } from '../../../application/dto/BootstrapSnapshot'
import type { SessionListItem } from '../../../application/dto/SessionListItem'
import type { AdnifyCliRuntime } from '../../../application/dto/AdnifyCliRuntime'
import { MemoryStore } from '../../../infrastructure/storage/MemoryStore'
import type { ConversationSession } from '../../../domain/session/aggregates/ConversationSession'
import { ConversationMessage } from '../../../domain/session/entities/ConversationMessage'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { CommandSuggestionItem } from '../components/CommandSuggestionList'
import type { ChoiceTabItem } from '../components/ChoiceTabs'
import { useConfigInit } from './useConfigInit'
import { useToolApproval } from './useToolApproval'
import { useUserInteraction } from './useUserInteraction'
import { usePermissionPicker } from './usePermissionPicker'
import { useAssistantModePicker } from './useAssistantModePicker'

export interface UseCliControllerParams {
  runtime: AdnifyCliRuntime
  cwd: string
  onExit: () => void
}

/**
 * 审批预览能占的行数。
 *
 * 审批面板本身要占掉边框、摘要、按键说明等固定行，剩下的才留给 diff。
 * 矮终端下宁可只显示几行 + 「另有 N 行未显示」，也不能把输入框顶出屏幕。
 */
function approvalPreviewRows(terminalRows: number): number {
  return Math.max(1, terminalRows - APPROVAL_RESERVED_ROWS)
}

/** 审批面板中不属于预览的固定开销：面板 chrome + 会话区最小高度。 */
const APPROVAL_RESERVED_ROWS = 16

export interface CliControllerState {
  bootstrap: BootstrapSnapshot | null
  session: ConversationSession | null
  inputValue: string
  inputCursor: number
  statusLine: string
  streamingText: string
  streamingMessages: ConversationMessage[]
  activeMode: AssistantMode
  activeTasks: ActiveTaskItem[]
  isBooting: boolean
  isBusy: boolean
  configInitPrompt: string
  toolApprovalPrompt: string
  userInteractionPrompt: string
  commandSuggestions: CommandSuggestionItem[]
  selectedSuggestionIndex: number
  isSuggestionOpen: boolean
  choiceItems: ChoiceTabItem[]
  selectedChoiceIndex: number
  recentSessions: SessionListItem[]
  handleInput: (input: string, key: Key) => void
  handlePaste: (text: string) => void
  clearInput: () => void
}

export interface ActiveTaskItem {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

const COMMAND_DESCRIPTION_KEYS: Record<string, string> = {
  ':help': 'command.desc.help',
  ':mode chat': 'command.desc.mode.chat',
  ':mode agent': 'command.desc.mode.agent',
  ':mode plan': 'command.desc.mode.plan',
  ':workspace': 'command.desc.workspace',
  ':status': 'command.desc.status',
  ':tools': 'command.desc.tools',
  ':doctor': 'command.desc.doctor',
  ':diff': 'command.desc.diff',
  ':review': 'command.desc.review',
  ':model [provider] [model]': 'command.desc.model',
  ':config': 'command.desc.config',
  ':config init': 'command.desc.configInit',
  ':config set provider [value] [model]': 'command.desc.config',
  ':config set model [value]': 'command.desc.config',
  ':config set api-key [value]': 'command.desc.config',
  ':config set base-url [value]': 'command.desc.config',
  ':config clear api-key': 'command.desc.config',
  ':language [zh-CN|en]': 'command.desc.language',
  ':animation [off|minimal|full]': 'command.desc.animation',
  ':permissions [manual|workspace|auto|plan]': 'command.desc.permissions',
  ':runtime [show|reset]': 'command.desc.runtime',
  ':runtime set [key] [integer]': 'command.desc.runtime',
  ':session': 'command.desc.session',
  ':sessions': 'command.desc.sessions',
  ':resume [index|id]': 'command.desc.resume',
  ':memory [content]': 'command.desc.memory',
  ':memory list': 'command.desc.memory',
  ':memory clear': 'command.desc.memory',
  ':checkpoint [message]': 'command.desc.checkpoint',
  ':undo': 'command.desc.undo',
  ':restore [id|index]': 'command.desc.restore',
  ':skill [name|list]': 'command.desc.skill',
  ':mcp': 'command.desc.mcp',
  ':context': 'command.desc.context',
  ':storage': 'command.desc.storage',
  ':storage set [path]': 'command.desc.storage',
  ':storage reset': 'command.desc.storage',
  ':clear': 'command.desc.clear',
  ':exit': 'command.desc.exit',
}

const MAX_INPUT_HISTORY = 50

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.name === 'AbortError' ||
    error.message === 'user-abort' ||
    error.message === 'Request aborted'
  )
}

/**
 * Ink 展示层状态桥。
 * 这里负责把用户输入翻译成用例调用，不直接承载领域规则。
 */
export function useCliController(params: UseCliControllerParams): CliControllerState {
  const { i18n } = params.runtime
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot | null>(null)
  const [session, setSession] = useState<ConversationSession | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [inputCursor, setInputCursor] = useState(0)
  const [statusLine, setStatusLine] = useState(i18n.t('status.initializing'))
  const [streamingText, setStreamingText] = useState('')
  const [streamingMessages, setStreamingMessages] = useState<ConversationMessage[]>([])
  const [workflowMode, setWorkflowMode] = useState<AssistantMode | null>(null)
  const [activeTasks, setActiveTasks] = useState<ActiveTaskItem[]>([])
  const [isBooting, setIsBooting] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const [recentSessions, setRecentSessions] = useState<SessionListItem[]>([])
  const [isSuggestionDismissed, setIsSuggestionDismissed] = useState(false)
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)

  const busyRef = useRef(false)
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const bootKeyRef = useRef<string | null>(null)
  const draftInputRef = useRef('')
  const streamingBufferRef = useRef('')
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoryStoreRef = useRef<MemoryStore | null>(null)
  const { stdout } = useStdout()
  const configInit = useConfigInit(i18n)
  // 预览高度直接由终端高度推出，不经过 App 的 inputRows ——
  // inputRows 本身是从审批文本行数算出来的，若再反过来决定预览高度就成了循环。
  const toolApproval = useToolApproval(
    params.runtime.toolApproval,
    i18n,
    approvalPreviewRows(stdout?.rows ?? 30),
  )
  const userInteraction = useUserInteraction(params.runtime.userInteraction)
  const permissionPicker = usePermissionPicker(i18n, params.runtime.toolApproval)
  const assistantModePicker = useAssistantModePicker(i18n, session?.mode ?? 'agent')

  const flushStreamingBuffer = useCallback(() => {
    if (streamingFlushTimerRef.current) {
      clearTimeout(streamingFlushTimerRef.current)
      streamingFlushTimerRef.current = null
    }

    if (!streamingBufferRef.current) {
      return
    }

    const nextChunk = streamingBufferRef.current
    streamingBufferRef.current = ''
    setStreamingText((previous) => previous + nextChunk)
  }, [])

  const queueStreamingChunk = useCallback((delta: string) => {
    streamingBufferRef.current += delta

    if (streamingFlushTimerRef.current) {
      return
    }

    streamingFlushTimerRef.current = setTimeout(() => {
      streamingFlushTimerRef.current = null
      if (!streamingBufferRef.current) {
        return
      }

      const nextChunk = streamingBufferRef.current
      streamingBufferRef.current = ''
      setStreamingText((previous) => previous + nextChunk)
    }, 32)
  }, [])

  const resetStreamingState = useCallback(() => {
    if (streamingFlushTimerRef.current) {
      clearTimeout(streamingFlushTimerRef.current)
      streamingFlushTimerRef.current = null
    }

    streamingBufferRef.current = ''
    setStreamingText('')
    setStreamingMessages([])
  }, [])

  const commitStreamingSegment = useCallback((content: string) => {
    if (streamingFlushTimerRef.current) {
      clearTimeout(streamingFlushTimerRef.current)
      streamingFlushTimerRef.current = null
    }

    streamingBufferRef.current = ''
    setStreamingText('')
    setStreamingMessages((previous) => [
      ...previous,
      new ConversationMessage({
        id: `stream-assistant-${Date.now()}-${previous.length + 1}`,
        role: 'assistant',
        content,
        createdAt: new Date(),
      }),
    ])
  }, [])

  useEffect(() => {
    return () => {
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current)
      }
    }
  }, [])

  const refreshRecentSessions = useCallback(
    async (workspacePath: string) => {
      const sessions = await params.runtime.useCases.listSessions.execute({
        workspacePath,
        limit: 5,
      })
      setRecentSessions(sessions)
    },
    [params.runtime.useCases.listSessions],
  )

  useEffect(() => {
    const bootKey = params.cwd
    if (bootKeyRef.current === bootKey) {
      return
    }

    bootKeyRef.current = bootKey

    let mounted = true

    const run = async () => {
      try {
        const bootSnapshot = await params.runtime.useCases.bootstrapCli.execute({
          cwd: params.cwd,
        })

        const startupSession = await params.runtime.useCases.resolveStartupSession.execute({
          workspacePath: bootSnapshot.workspace.rootPath,
          mode: bootSnapshot.profile.defaultMode,
        })

        if (!mounted) {
          return
        }

        setBootstrap(bootSnapshot)
        setSession(startupSession.session)

        // Create workspace-scoped memory store
        const bootStorage = bootSnapshot.storage
        memoryStoreRef.current = new MemoryStore(bootStorage, bootSnapshot.workspace.rootPath)

        await refreshRecentSessions(bootSnapshot.workspace.rootPath)

        if (!bootSnapshot.modelConfig.apiKey) {
          setStatusLine(
            startupSession.restored
              ? i18n.t('status.sessionRestoredSetupRequired', {
                  id: startupSession.session.id.slice(0, 8),
                })
              : i18n.t('status.notConfigured'),
          )
        } else {
          setStatusLine(
            startupSession.restored
              ? i18n.t('status.sessionRestored', {
                  id: startupSession.session.id.slice(0, 8),
                })
              : i18n.t('status.runtimeReady'),
          )
        }
      } catch (error) {
        if (!mounted) {
          return
        }

        const message = error instanceof Error ? error.message : 'Unknown error'
        setStatusLine(`${i18n.t('app.boot.failed')}: ${message}`)
      } finally {
        if (mounted) {
          setIsBooting(false)
        }
      }
    }

    void run()

    return () => {
      mounted = false
    }
  }, [configInit.start, i18n, params.cwd, params.runtime, refreshRecentSessions])

  const commandSuggestions = useMemo<CommandSuggestionItem[]>(() => {
    if (!bootstrap) {
      return []
    }

    const trimmed = inputValue.trimStart()
    const isCommandTrigger = trimmed.startsWith(':') || trimmed.startsWith('/')

    if (!isCommandTrigger) {
      return []
    }

    const normalized = trimmed.startsWith('/') ? `:${trimmed.slice(1)}` : trimmed
    const keyword = normalized.toLowerCase()

    return bootstrap.localCommands
      .map((command) => ({
        command,
        description:
          i18n.maybeT(COMMAND_DESCRIPTION_KEYS[command] ?? '') ?? i18n.t('command.desc.default'),
      }))
      .filter((item) => item.command.toLowerCase().startsWith(keyword))
  }, [bootstrap, i18n, inputValue])

  const isSuggestionOpen =
    commandSuggestions.length > 0 &&
    !configInit.isActive &&
    !assistantModePicker.isActive &&
    !permissionPicker.isActive &&
    !userInteraction.isActive &&
    !toolApproval.isActive &&
    !isSuggestionDismissed

  useEffect(() => {
    if (selectedSuggestionIndex >= commandSuggestions.length) {
      setSelectedSuggestionIndex(0)
    }
  }, [commandSuggestions.length, selectedSuggestionIndex])

  const applySelectedSuggestion = useCallback(() => {
    const next = commandSuggestions[selectedSuggestionIndex]
    if (!next) {
      return false
    }

    const nextValue = `${next.command} `
    setInputValue(nextValue)
    setInputCursor(Array.from(nextValue).length)
    setSelectedSuggestionIndex(0)
    setIsSuggestionDismissed(false)
    setHistoryIndex(null)
    draftInputRef.current = ''
    return true
  }, [commandSuggestions, selectedSuggestionIndex])

  const commitInputHistory = useCallback((value: string) => {
    const normalized = value.trim()
    if (!normalized) {
      return
    }

    setInputHistory((previous) => {
      if (previous[previous.length - 1] === normalized) {
        return previous
      }

      const next = [...previous, normalized]
      return next.length > MAX_INPUT_HISTORY ? next.slice(next.length - MAX_INPUT_HISTORY) : next
    })
  }, [])

  const exitHistoryNavigation = useCallback((restoreDraft: boolean) => {
    setHistoryIndex(null)
    if (restoreDraft) {
      setInputValue(draftInputRef.current)
      setInputCursor(Array.from(draftInputRef.current).length)
    }
    draftInputRef.current = ''
  }, [])

  const navigateHistory = useCallback(
    (direction: 'older' | 'newer') => {
      if (inputHistory.length === 0) {
        return false
      }

      if (historyIndex === null) {
        if (direction === 'newer') {
          return false
        }

        draftInputRef.current = inputValue
        const nextIndex = inputHistory.length - 1
        setHistoryIndex(nextIndex)
        setInputValue(inputHistory[nextIndex] ?? '')
        setInputCursor(Array.from(inputHistory[nextIndex] ?? '').length)
        return true
      }

      if (direction === 'older') {
        const nextIndex = Math.max(0, historyIndex - 1)
        setHistoryIndex(nextIndex)
        setInputValue(inputHistory[nextIndex] ?? '')
        setInputCursor(Array.from(inputHistory[nextIndex] ?? '').length)
        return true
      }

      if (historyIndex >= inputHistory.length - 1) {
        exitHistoryNavigation(true)
        return true
      }

      const nextIndex = historyIndex + 1
      setHistoryIndex(nextIndex)
      setInputValue(inputHistory[nextIndex] ?? '')
      setInputCursor(Array.from(inputHistory[nextIndex] ?? '').length)
      return true
    },
    [exitHistoryNavigation, historyIndex, inputHistory, inputValue],
  )

  const runConfigInput = useCallback(async (value: string, useSelection = false) => {
    busyRef.current = true
    setIsBusy(true)
    setInputValue('')
    setInputCursor(0)

    try {
      const result = useSelection
        ? await configInit.confirmSelection()
        : await configInit.handleInput(value)
      if (result) {
        setBootstrap((previous) => (previous ? { ...previous, modelConfig: result.config } : previous))
        setStatusLine(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatusLine(i18n.t('status.configFailed', { message }))
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }, [configInit, i18n])

  const handleSubmit = useCallback(async () => {
    if (!session || !bootstrap || busyRef.current) {
      return
    }

    let nextInput = inputValue.trim()

    if (nextInput.startsWith('/')) {
      nextInput = `:${nextInput.slice(1)}`
    }

    if (configInit.isActive) {
      await runConfigInput(nextInput)
      return
    }

    if (!nextInput) {
      return
    }

    if (nextInput === ':permissions' || nextInput === ':permission') {
      commitInputHistory(nextInput)
      setInputValue('')
      setInputCursor(0)
      permissionPicker.open()
      setStatusLine(i18n.t('status.selectPermissionMode'))
      return
    }

    commitInputHistory(nextInput)
    busyRef.current = true
    setIsBusy(true)
    setInputValue('')
    setInputCursor(0)
    setSelectedSuggestionIndex(0)
    setIsSuggestionDismissed(false)
    setHistoryIndex(null)
    draftInputRef.current = ''
    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController

    try {
      if (nextInput === ':config init') {
        configInit.start()
        setStatusLine(i18n.t('status.enteringConfigInit'))
        return
      }

      if (nextInput.startsWith(':')) {
        const result = await params.runtime.useCases.applyCliCommand.execute({
          sessionId: session.id,
          commandLine: nextInput,
          bootstrap,
          memoryStore: memoryStoreRef.current ?? undefined,
          skillStore: params.runtime.skillStore ?? undefined,
          mcpServerList: params.runtime.mcpServerList ?? undefined,
          checkpointStore: params.runtime.checkpoints ?? undefined,
          permissionController: params.runtime.toolApproval,
          configUpdater: {
            applyModelConfig: (nextConfig) => {
              const activeConfig = params.runtime.applyModelConfig(nextConfig)
              setBootstrap((previous) =>
                previous ? { ...previous, modelConfig: activeConfig } : previous,
              )
              return activeConfig
            },
          },
          modelSwitcher: {
            switchModel: (providerName, modelName) => {
              const newConfig = params.runtime.switchModel(providerName, modelName)
              if (newConfig) {
                setBootstrap((previous) => (previous ? { ...previous, modelConfig: newConfig } : previous))
              }
              return newConfig ? { model: newConfig.model, baseUrl: newConfig.baseUrl } : null
            },
          },
        })

        setSession(result.session)
        setStatusLine(result.statusLine)
        await refreshRecentSessions(bootstrap.workspace.rootPath)

        if (result.shouldExit) {
          params.onExit()
        }
        return
      }

      resetStreamingState()
      setWorkflowMode(session.mode)
      setActiveTasks([])

      // Render the submitted message before any repository read or API request begins.
      // The use case replaces this temporary clone with the persisted message and stable id.
      const optimisticSession = session.clone()
      optimisticSession.addUserMessage(`pending-user-${Date.now()}`, new Date(), nextInput)
      setSession(optimisticSession)

      const memoryBlock = memoryStoreRef.current
        ? await memoryStoreRef.current.toPromptBlock()
        : undefined

      const result = await params.runtime.useCases.submitPrompt.executeStreaming(
        { sessionId: session.id, prompt: nextInput, abortSignal: abortController.signal, memoryBlock: memoryBlock || undefined },
        {
          onUserMessage: (acceptedSession) => {
            setSession(acceptedSession)
          },
          onChunk: (delta) => {
            queueStreamingChunk(delta)
          },
          onDone: () => {
            flushStreamingBuffer()
          },
          onAssistantSegment: commitStreamingSegment,
          onTranscript: (content) => {
            setStreamingMessages((previous) => [
              ...previous,
              new ConversationMessage({
                id: `stream-${Date.now()}-${previous.length + 1}`,
                role: 'system',
                content,
                createdAt: new Date(),
              }),
            ])
          },
          onWorkflowPhase: (phase) => {
            setWorkflowMode(phase === 'plan' ? 'plan' : session.mode === 'chat' ? 'chat' : 'agent')
            setStatusLine(i18n.t(`status.workflowPhase.${phase}`))
          },
          onAssistantMode: (mode) => {
            setWorkflowMode(mode)
          },
          onTaskProgress: (progress) => {
            if (progress.status === 'clear') {
              setActiveTasks([])
              return
            }

            const nextTask: ActiveTaskItem = {
              id: progress.id,
              title: progress.title,
              status: progress.status,
            }
            setActiveTasks((previous) => {
              const existingIndex = previous.findIndex((task) => task.id === progress.id)
              if (existingIndex < 0) return [...previous, nextTask]
              return previous.map((task, index) => index === existingIndex ? nextTask : task)
            })
          },
          onRetry: (retry) => {
            setStatusLine(i18n.t('status.modelRetrying', {
              attempt: retry.attempt,
              max: retry.maxRetries,
              delay: retry.delayMs,
            }))
          },
          onError: (error) => {
            flushStreamingBuffer()
            setStatusLine(
              isAbortLikeError(error)
                ? i18n.t('status.executionAborted')
                : i18n.t('status.responseFailed', { message: error.message }),
            )
          },
        },
      )

      setSession(result.session)
      resetStreamingState()
      setWorkflowMode(result.session.mode)
      setActiveTasks([])
      setStatusLine(result.statusLine)
      await refreshRecentSessions(bootstrap.workspace.rootPath)
    } catch (error) {
      if (isAbortLikeError(error)) {
        setStatusLine(i18n.t('status.executionAborted'))
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setStatusLine(i18n.t('status.executionFailed', { message }))
      }
      resetStreamingState()
      setWorkflowMode(session.mode)
      setActiveTasks([])
    } finally {
      activeAbortControllerRef.current = null
      busyRef.current = false
      setIsBusy(false)
    }
  }, [
    bootstrap,
    commandSuggestions,
    configInit,
    flushStreamingBuffer,
    i18n,
    inputValue,
    isSuggestionOpen,
    params,
    permissionPicker,
    queueStreamingChunk,
    resetStreamingState,
    runConfigInput,
    selectedSuggestionIndex,
    session,
  ])

  const applyPermissionSelection = useCallback(async () => {
    if (!session || !bootstrap) return
    const mode = permissionPicker.selectedMode
    permissionPicker.close()
    busyRef.current = true
    setIsBusy(true)
    try {
      const result = await params.runtime.useCases.applyCliCommand.execute({
        sessionId: session.id,
        commandLine: `:permissions ${mode}`,
        bootstrap,
        permissionController: params.runtime.toolApproval,
      })
      setSession(result.session)
      setStatusLine(result.statusLine)
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }, [bootstrap, params.runtime, permissionPicker, session])

  const applyAssistantModeSelection = useCallback(async () => {
    if (!session || !bootstrap) return
    const mode = assistantModePicker.selectedMode
    assistantModePicker.close()
    busyRef.current = true
    setIsBusy(true)
    try {
      const result = await params.runtime.useCases.applyCliCommand.execute({
        sessionId: session.id,
        commandLine: `:mode ${mode}`,
        bootstrap,
      })
      setSession(result.session)
      setStatusLine(result.statusLine)
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }, [assistantModePicker, bootstrap, params.runtime.useCases.applyCliCommand, session])

  const handleInput = useCallback((input: string, key: Key) => {
    if (key.ctrl && input === 'c') {
      params.onExit()
      return
    }

    if (key.shift && key.tab && !busyRef.current) {
      if (!toolApproval.isActive && !userInteraction.isActive && !configInit.isActive && !permissionPicker.isActive) {
        assistantModePicker.open()
        setStatusLine(i18n.t('status.selectAssistantMode'))
      }
      return
    }

    if (key.escape) {
      if (busyRef.current) {
        if (activeAbortControllerRef.current) {
          activeAbortControllerRef.current.abort(new Error('user-abort'))
          setStatusLine(i18n.t('status.executionAborting'))
        }
        // 有在途审批时必须一并拒绝，否则工具那边的 promise 永不 resolve、isBusy 卡死。
        toolApproval.denyAll()
        return
      }

      if (assistantModePicker.isActive) {
        assistantModePicker.close()
        setStatusLine(i18n.t('status.assistantModeSelectionCancelled'))
        return
      }

      if (permissionPicker.isActive) {
        permissionPicker.close()
        setStatusLine(i18n.t('status.permissionSelectionCancelled'))
        return
      }

      if (configInit.isActive && !inputValue) {
        configInit.stop()
        setStatusLine(i18n.t('status.configInitCancelled'))
        return
      }

      if (isSuggestionOpen) {
        setIsSuggestionDismissed(true)
        setSelectedSuggestionIndex(0)
        return
      }

      if (historyIndex !== null) {
        exitHistoryNavigation(true)
        return
      }

      if (inputValue) {
        setInputValue('')
        setInputCursor(0)
        setSelectedSuggestionIndex(0)
      }
      return
    }

    // 审批面板把输入栏替换成选项卡；不再要求用户记 y/n/a。
    if (toolApproval.isActive) {
      if (key.leftArrow || key.upArrow) {
        toolApproval.moveSelection('previous')
      } else if (key.rightArrow || key.downArrow) {
        toolApproval.moveSelection('next')
      } else if (key.return) {
        const statusMessage = toolApproval.confirmSelection()
        if (statusMessage) {
          setStreamingMessages((previous) => [
            ...previous,
            new ConversationMessage({
              id: `approval-${Date.now()}`,
              role: 'system',
              content: statusMessage,
              createdAt: new Date(),
            }),
          ])
        }
      }

      return
    }

    if (userInteraction.isActive) {
      if (key.leftArrow || key.upArrow) {
        userInteraction.moveSelection('previous')
      } else if (key.rightArrow || key.downArrow) {
        userInteraction.moveSelection('next')
      } else if (key.return) {
        userInteraction.confirmSelection()
      }
      return
    }

    if (permissionPicker.isActive) {
      if (key.leftArrow || key.upArrow) {
        permissionPicker.moveSelection('previous')
      } else if (key.rightArrow || key.downArrow) {
        permissionPicker.moveSelection('next')
      } else if (key.return) {
        void applyPermissionSelection()
      }
      return
    }

    if (assistantModePicker.isActive) {
      if (key.leftArrow || key.upArrow) {
        assistantModePicker.moveSelection('previous')
      } else if (key.rightArrow || key.downArrow) {
        assistantModePicker.moveSelection('next')
      } else if (key.return) {
        void applyAssistantModeSelection()
      }
      return
    }

    if (configInit.isActive && configInit.isSelectionStep) {
      if (key.leftArrow || key.upArrow) {
        configInit.moveSelection('up')
      } else if (key.rightArrow || key.downArrow) {
        configInit.moveSelection('down')
      } else if (key.return) {
        void runConfigInput('', true)
      }
      return
    }

    if (!isSuggestionOpen && !configInit.isActive && key.upArrow && !inputValue) {
      if (navigateHistory('older')) {
        return
      }
    }

    if (
      !isSuggestionOpen &&
      !configInit.isActive &&
      key.downArrow &&
      (!inputValue || historyIndex !== null)
    ) {
      if (navigateHistory('newer')) {
        return
      }
    }

    if (isSuggestionOpen && key.upArrow) {
      setSelectedSuggestionIndex((previous) =>
        previous === 0 ? commandSuggestions.length - 1 : previous - 1,
      )
      return
    }

    if (isSuggestionOpen && key.downArrow) {
      setSelectedSuggestionIndex((previous) =>
        previous >= commandSuggestions.length - 1 ? 0 : previous + 1,
      )
      return
    }

    if (isSuggestionOpen && key.tab) {
      if (applySelectedSuggestion()) {
        return
      }
    }

    if (isSuggestionOpen && key.return) {
      if (applySelectedSuggestion()) {
        return
      }
    }

    if (key.return) {
      void handleSubmit()
      return
    }

    const inputCharacters = Array.from(inputValue)

    if (key.leftArrow) {
      setInputCursor((previous) => Math.max(0, previous - 1))
      return
    }

    if (key.rightArrow) {
      setInputCursor((previous) => Math.min(inputCharacters.length, previous + 1))
      return
    }

    if (key.home) {
      setInputCursor(0)
      return
    }

    if (key.end) {
      setInputCursor(inputCharacters.length)
      return
    }

    if (key.backspace || key.delete) {
      if (historyIndex !== null) {
        setHistoryIndex(null)
        draftInputRef.current = ''
      }
      setIsSuggestionDismissed(false)
      if (key.backspace && inputCursor > 0) {
        inputCharacters.splice(inputCursor - 1, 1)
        setInputValue(inputCharacters.join(''))
        setInputCursor(inputCursor - 1)
      } else if (key.delete && inputCursor < inputCharacters.length) {
        inputCharacters.splice(inputCursor, 1)
        setInputValue(inputCharacters.join(''))
      }
      setSelectedSuggestionIndex(0)
      return
    }

    // Ink 7: key.meta is no longer set for plain Escape — only for actual Alt/Meta combos.
    // We already handle Escape above, so no changes needed here.

    if (!key.ctrl && !key.meta) {
      if (historyIndex !== null) {
        setHistoryIndex(null)
        draftInputRef.current = ''
      }
      setIsSuggestionDismissed(false)
      const insertedCharacters = Array.from(input)
      inputCharacters.splice(inputCursor, 0, ...insertedCharacters)
      setInputValue(inputCharacters.join(''))
      setInputCursor(inputCursor + insertedCharacters.length)
      setSelectedSuggestionIndex(0)
    }
  }, [
    applyAssistantModeSelection,
    applySelectedSuggestion,
    applyPermissionSelection,
    commandSuggestions.length,
    configInit,
    handleSubmit,
    historyIndex,
    i18n,
    inputValue,
    inputCursor,
    isSuggestionOpen,
    navigateHistory,
    params,
    assistantModePicker,
    permissionPicker,
    exitHistoryNavigation,
    toolApproval,
    userInteraction,
    session,
  ])

  const handlePaste = useCallback((text: string) => {
    if (busyRef.current || toolApproval.isActive || userInteraction.isActive || assistantModePicker.isActive || !text) {
      return
    }

    const inputCharacters = Array.from(inputValue)
    const insertedCharacters = Array.from(text.replace(/\r\n/g, '\n'))
    inputCharacters.splice(inputCursor, 0, ...insertedCharacters)
    setInputValue(inputCharacters.join(''))
    setInputCursor(inputCursor + insertedCharacters.length)
    setHistoryIndex(null)
    setIsSuggestionDismissed(false)
  }, [assistantModePicker.isActive, inputCursor, inputValue, toolApproval.isActive, userInteraction.isActive])

  const clearInput = useCallback(() => {
    setInputValue('')
    setInputCursor(0)
    setHistoryIndex(null)
    setIsSuggestionDismissed(false)
  }, [])

  return {
    bootstrap,
    session,
    inputValue,
    inputCursor,
    statusLine,
    streamingText,
    streamingMessages,
    activeMode: workflowMode ?? session?.mode ?? 'agent',
    activeTasks,
    isBooting,
    isBusy,
    configInitPrompt: assistantModePicker.isActive
      ? assistantModePicker.promptText
      : permissionPicker.isActive
        ? permissionPicker.promptText
      : configInit.isActive
        ? configInit.promptText +
          (configInit.errorText
            ? `\n${i18n.t('conversation.configError', { message: configInit.errorText })}`
            : '')
        : '',
    toolApprovalPrompt: toolApproval.isActive
      ? toolApproval.promptText +
        (toolApproval.errorText
          ? `\n${i18n.t('conversation.configError', { message: toolApproval.errorText })}`
          : '')
      : '',
    userInteractionPrompt: userInteraction.promptText,
    commandSuggestions,
    selectedSuggestionIndex,
    isSuggestionOpen,
    choiceItems: toolApproval.isActive
      ? toolApproval.choiceItems
      : userInteraction.isActive
        ? userInteraction.choiceItems
        : assistantModePicker.isActive
          ? assistantModePicker.choiceItems
          : permissionPicker.isActive
            ? permissionPicker.choiceItems
            : configInit.choiceItems,
    selectedChoiceIndex: toolApproval.isActive
      ? toolApproval.selectedChoiceIndex
      : userInteraction.isActive
        ? userInteraction.selectedChoiceIndex
        : assistantModePicker.isActive
          ? assistantModePicker.selectedChoiceIndex
          : permissionPicker.isActive
            ? permissionPicker.selectedChoiceIndex
            : configInit.selectedChoiceIndex,
    recentSessions,
    handleInput,
    handlePaste,
    clearInput,
  }
}
