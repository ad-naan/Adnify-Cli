import type { Key } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdnifyCliRuntime } from '../../../application/dto/AdnifyCliRuntime'
import type { BootstrapSnapshot } from '../../../application/dto/BootstrapSnapshot'
import type { SessionListItem } from '../../../application/dto/SessionListItem'
import type { PendingToolApproval } from '../../../application/ports/AssistantResponderPort'
import type { ConversationSession } from '../../../domain/session/aggregates/ConversationSession'
import { ConversationMessage } from '../../../domain/session/entities/ConversationMessage'
import type { CommandSuggestionItem } from '../components/CommandSuggestionList'
import { useConfigInit } from './useConfigInit'

export interface UseCliControllerParams {
  runtime: AdnifyCliRuntime
  cwd: string
  onExit: () => void
}

export interface CliControllerState {
  bootstrap: BootstrapSnapshot | null
  session: ConversationSession | null
  inputValue: string
  statusLine: string
  streamingText: string
  streamingMessages: ConversationMessage[]
  isBooting: boolean
  isBusy: boolean
  configInitPrompt: string
  approvalPrompt: string
  commandSuggestions: CommandSuggestionItem[]
  selectedSuggestionIndex: number
  isSuggestionOpen: boolean
  recentSessions: SessionListItem[]
  handleInput: (input: string, key: Key) => void
}

const COMMAND_DESCRIPTION_KEYS: Record<string, string> = {
  ':help': 'command.desc.help',
  ':mode chat': 'command.desc.mode.chat',
  ':mode agent': 'command.desc.mode.agent',
  ':mode plan': 'command.desc.mode.plan',
  ':workspace': 'command.desc.workspace',
  ':tools': 'command.desc.tools',
  ':doctor': 'command.desc.doctor',
  ':diff': 'command.desc.diff',
  ':review': 'command.desc.review',
  ':model [provider] [model]': 'command.desc.model',
  ':config': 'command.desc.config',
  ':config init': 'command.desc.configInit',
  ':config set provider [value]': 'command.desc.config',
  ':config set model [value]': 'command.desc.config',
  ':config set api-key [value]': 'command.desc.config',
  ':config set base-url [value]': 'command.desc.config',
  ':config clear api-key': 'command.desc.config',
  ':session': 'command.desc.session',
  ':sessions': 'command.desc.sessions',
  ':resume [index|id]': 'command.desc.resume',
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

export function useCliController(params: UseCliControllerParams): CliControllerState {
  const { i18n } = params.runtime
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot | null>(null)
  const [session, setSession] = useState<ConversationSession | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [statusLine, setStatusLine] = useState(i18n.t('status.initializing'))
  const [streamingText, setStreamingText] = useState('')
  const [streamingMessages, setStreamingMessages] = useState<ConversationMessage[]>([])
  const [isBooting, setIsBooting] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null)
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
  const configInit = useConfigInit(i18n)

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
    if (!bootstrap || pendingApproval) {
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
  }, [bootstrap, i18n, inputValue, pendingApproval])

  const isSuggestionOpen =
    commandSuggestions.length > 0 &&
    !configInit.isActive &&
    !pendingApproval &&
    !isSuggestionDismissed

  const approvalPrompt = useMemo(() => {
    if (!pendingApproval) {
      return ''
    }

    return [
      `${pendingApproval.toolName} (${pendingApproval.toolId})`,
      pendingApproval.reason,
      `input: ${pendingApproval.input}`,
      i18n.t('input.hintApproval'),
    ].join('\n')
  }, [i18n, pendingApproval])

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

    setInputValue(`${next.command} `)
    setSelectedSuggestionIndex(0)
    setIsSuggestionDismissed(false)
    setHistoryIndex(null)
    draftInputRef.current = ''
    return true
  }, [commandSuggestions, selectedSuggestionIndex])

  const appendStreamingTranscript = useCallback((content: string) => {
    setStreamingMessages((previous) => [
      ...previous,
      new ConversationMessage({
        id: `stream-${Date.now()}-${previous.length + 1}`,
        role: 'system',
        content,
        createdAt: new Date(),
      }),
    ])
  }, [])

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
        return true
      }

      if (direction === 'older') {
        const nextIndex = Math.max(0, historyIndex - 1)
        setHistoryIndex(nextIndex)
        setInputValue(inputHistory[nextIndex] ?? '')
        return true
      }

      if (historyIndex >= inputHistory.length - 1) {
        exitHistoryNavigation(true)
        return true
      }

      const nextIndex = historyIndex + 1
      setHistoryIndex(nextIndex)
      setInputValue(inputHistory[nextIndex] ?? '')
      return true
    },
    [exitHistoryNavigation, historyIndex, inputHistory, inputValue],
  )

  const handleSubmit = useCallback(async () => {
    if (!session || !bootstrap || busyRef.current) {
      return
    }

    let nextInput = inputValue.trim()

    if (nextInput.startsWith('/')) {
      nextInput = `:${nextInput.slice(1)}`
    }

    if (pendingApproval) {
      const decision = nextInput.toLowerCase()
      if (decision !== 'y' && decision !== 'yes' && decision !== 'n' && decision !== 'no') {
        setStatusLine(i18n.t('status.approvalChoiceRequired'))
        return
      }

      busyRef.current = true
      setIsBusy(true)
      setInputValue('')
      const abortController = new AbortController()
      activeAbortControllerRef.current = abortController
      resetStreamingState()

      try {
        const result = await params.runtime.useCases.submitPrompt.executeApprovalDecision(
          {
            sessionId: session.id,
            approved: decision === 'y' || decision === 'yes',
            abortSignal: abortController.signal,
          },
          {
            onChunk: (delta) => {
              queueStreamingChunk(delta)
            },
            onDone: () => {
              flushStreamingBuffer()
            },
            onTranscript: appendStreamingTranscript,
            onApproval: (nextApproval) => {
              setPendingApproval(nextApproval)
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
        setPendingApproval(result.pendingApproval ?? null)
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
      } finally {
        activeAbortControllerRef.current = null
        busyRef.current = false
        setIsBusy(false)
      }

      return
    }

    if (configInit.isActive) {
      busyRef.current = true
      setIsBusy(true)
      setInputValue('')

      try {
        const result = await configInit.handleInput(nextInput)
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

      return
    }

    if (!nextInput) {
      return
    }

    commitInputHistory(nextInput)
    busyRef.current = true
    setIsBusy(true)
    setInputValue('')
    setSelectedSuggestionIndex(0)
    setIsSuggestionDismissed(false)
    setPendingApproval(null)
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

      const result = await params.runtime.useCases.submitPrompt.executeStreaming(
        { sessionId: session.id, prompt: nextInput, abortSignal: abortController.signal },
        {
          onChunk: (delta) => {
            queueStreamingChunk(delta)
          },
          onDone: () => {
            flushStreamingBuffer()
          },
          onTranscript: appendStreamingTranscript,
          onApproval: (nextApproval) => {
            setPendingApproval(nextApproval)
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
      setPendingApproval(result.pendingApproval ?? null)
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
    } finally {
      activeAbortControllerRef.current = null
      busyRef.current = false
      setIsBusy(false)
    }
  }, [
    appendStreamingTranscript,
    bootstrap,
    commitInputHistory,
    configInit,
    flushStreamingBuffer,
    i18n,
    inputValue,
    params,
    pendingApproval,
    queueStreamingChunk,
    refreshRecentSessions,
    resetStreamingState,
    session,
  ])

  const handleInput = useCallback((input: string, key: Key) => {
    if (key.ctrl && input === 'c') {
      params.onExit()
      return
    }

    if (key.escape) {
      if (busyRef.current) {
        if (activeAbortControllerRef.current) {
          activeAbortControllerRef.current.abort(new Error('user-abort'))
          setStatusLine(i18n.t('status.executionAborting'))
        }
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
        setSelectedSuggestionIndex(0)
      }
      return
    }

    if (!isSuggestionOpen && !configInit.isActive && !pendingApproval && key.upArrow && !inputValue) {
      if (navigateHistory('older')) {
        return
      }
    }

    if (
      !isSuggestionOpen &&
      !configInit.isActive &&
      !pendingApproval &&
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

    if (key.backspace || key.delete) {
      if (historyIndex !== null) {
        setHistoryIndex(null)
        draftInputRef.current = ''
      }
      setIsSuggestionDismissed(false)
      setInputValue((previous) => previous.slice(0, -1))
      setSelectedSuggestionIndex(0)
      return
    }

    if (!key.ctrl && !key.meta) {
      if (historyIndex !== null) {
        setHistoryIndex(null)
        draftInputRef.current = ''
      }
      setIsSuggestionDismissed(false)
      setInputValue((previous) => previous + input)
      setSelectedSuggestionIndex(0)
    }
  }, [
    applySelectedSuggestion,
    commandSuggestions.length,
    configInit,
    exitHistoryNavigation,
    handleSubmit,
    historyIndex,
    i18n,
    inputValue,
    isSuggestionOpen,
    navigateHistory,
    params,
    pendingApproval,
  ])

  return {
    bootstrap,
    session,
    inputValue,
    statusLine,
    streamingText,
    streamingMessages,
    isBooting,
    isBusy,
    configInitPrompt: configInit.isActive
      ? configInit.promptText +
        (configInit.errorText
          ? `\n${i18n.t('conversation.configError', { message: configInit.errorText })}`
          : '')
      : '',
    approvalPrompt,
    commandSuggestions,
    selectedSuggestionIndex,
    isSuggestionOpen,
    recentSessions,
    handleInput,
  }
}
