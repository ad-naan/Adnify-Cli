import {
  Box,
  Newline,
  Text,
  useApp,
  useBoxMetrics,
  useInput,
  usePaste,
  useWindowSize,
  type DOMElement,
} from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdnifyCliRuntime } from '../../application/dto/AdnifyCliRuntime'
import { estimateTokens } from '../../domain/session/value-objects/CompactionResult'
import { adnifyTheme } from './theme'
import { ActivityPulse } from './components/ActivityPulse'
import { ConversationViewport, conversationBodyRows } from './components/ConversationViewport'
import { EmptyState } from './components/EmptyState'
import { HeaderBar } from './components/HeaderBar'
import { InputDock } from './components/InputDock'
import { Panel } from './components/Panel'
import { StatusDock } from './components/StatusDock'
import { useCliController } from './hooks/useCliController'
import { useViewportScroll } from './hooks/useViewportScroll'

export interface AppProps {
  runtime: AdnifyCliRuntime
  cwd: string
}

export function App(props: AppProps) {
  const { exit } = useApp()
  const { rows } = useWindowSize()
  const conversationRegionRef = useRef<DOMElement | null>(null)
  const conversationMetrics = useBoxMetrics(conversationRegionRef)
  const controller = useCliController({ runtime: props.runtime, cwd: props.cwd, onExit: exit })
  const { i18n } = props.runtime
  const enableFullAnimation = props.runtime.ui.animationLevel === 'full'

  const bootstrap = controller.bootstrap
  const session = controller.session
  const workspace = bootstrap?.workspace
  const profile = bootstrap?.profile
  const modelConfig = bootstrap?.modelConfig
  const modelLabel = modelConfig ? `${modelConfig.provider} / ${modelConfig.model}` : ''
  const workspaceName = workspace
    ? workspace.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? workspace.rootPath
    : i18n.t('app.boot.workspaceName')
  const messages = useMemo(
    () => [...(session?.getMessages() ?? []), ...controller.streamingMessages],
    [controller.streamingMessages, session],
  )
  const showEmptyState = Boolean(session) && messages.length === 0 && !controller.streamingText
  const [isTranscriptView, setIsTranscriptView] = useState(false)
  const [totalViewportRows, setTotalViewportRows] = useState(0)

  useEffect(() => {
    if (controller.toolApprovalPrompt || controller.userInteractionPrompt || controller.configInitPrompt) setIsTranscriptView(false)
  }, [controller.configInitPrompt, controller.toolApprovalPrompt, controller.userInteractionPrompt])

  // Ink 7 measures the actual flex child after every layout pass. No guessed header/input row counts.
  const conversationViewportRows = conversationMetrics.hasMeasured
    ? Math.max(1, conversationMetrics.height - (isTranscriptView ? 1 : 0))
    : Math.max(4, rows - 8)
  const scroll = useViewportScroll(
    totalViewportRows,
    conversationBodyRows(conversationViewportRows),
  )

  const handleInput = useCallback(
    (input: string, key: Parameters<typeof controller.handleInput>[1]) => {
      if (key.ctrl && input === 'o' && !controller.toolApprovalPrompt && !controller.configInitPrompt) {
        setIsTranscriptView((current) => !current)
        return
      }

      if (key.pageUp || (key.ctrl && input === 'u')) {
        scroll.scrollUp(Math.max(1, key.pageUp ? conversationViewportRows - 1 : Math.floor(conversationViewportRows / 2)))
        return
      }

      if (key.pageDown || (key.ctrl && input === 'd')) {
        scroll.scrollDown(Math.max(1, key.pageDown ? conversationViewportRows - 1 : Math.floor(conversationViewportRows / 2)))
        return
      }

      if (key.ctrl && input === 'g') {
        scroll.scrollToBottom()
        return
      }

      if (key.escape && scroll.isScrolled && !controller.isBusy && !controller.toolApprovalPrompt) {
        scroll.scrollToBottom()
        return
      }

      if (isTranscriptView && (key.escape || input.toLowerCase() === 'q') && !controller.isBusy) {
        setIsTranscriptView(false)
        return
      }

      controller.handleInput(input, key)
    },
    [
      controller.configInitPrompt,
      controller.handleInput,
      controller.isBusy,
      controller.toolApprovalPrompt,
      conversationViewportRows,
      isTranscriptView,
      scroll,
    ],
  )

  useInput(handleInput)
  usePaste(controller.handlePaste, { isActive: !isTranscriptView })

  if (controller.isBooting) {
    return (
      <Box width="100%" height={rows} flexDirection="column" paddingX={1}>
        <HeaderBar
          appName="Adnify-Cli"
          author="adnaan"
          tagline={i18n.t('assistant.tagline')}
          workspaceName={i18n.t('app.boot.workspaceName')}
          packageManager="bun"
          mode="agent"
          modelLabel={i18n.t('app.boot.modelLabel')}
          busy
          animateBrand={enableFullAnimation}
          i18n={i18n}
        />
        <Box width="100%" marginTop={1}>
          <Panel title={i18n.t('app.boot.panelTitle')} subtitle={i18n.t('app.boot.panelSubtitle')} accent="brand">
            <Box gap={1}>
              <ActivityPulse active animated={enableFullAnimation} color={adnifyTheme.brandSoft} idleFrame="·  " variant="dots" />
              <Text color={adnifyTheme.brand}>{i18n.t('app.boot.heading')}</Text>
            </Box>
          </Panel>
        </Box>
      </Box>
    )
  }

  if (!bootstrap || !session) {
    return (
      <Box width="100%" flexDirection="column" paddingX={1}>
        <Text color={adnifyTheme.danger}>{i18n.t('app.boot.failed')}</Text>
        <Newline />
        <Text color={adnifyTheme.textPrimary}>{controller.statusLine}</Text>
      </Box>
    )
  }

  const approxTokens = estimateTokens([
    ...messages,
    ...(controller.streamingText ? [{ content: controller.streamingText }] : []),
  ])
  const contextPercent = Math.min(999, Math.round((approxTokens / Math.max(1, modelConfig!.maxTokens)) * 100))

  return (
    <Box width="100%" height={rows} flexDirection="column" paddingX={1} overflow="hidden">
      {isTranscriptView ? (
        <Box ref={conversationRegionRef} width="100%" flexGrow={1} minHeight={2} overflow="hidden">
          <ConversationViewport
            messages={messages}
            streamingText={controller.streamingText}
            busy={controller.isBusy}
            viewportRows={conversationViewportRows}
            scrollOffset={scroll.offset}
            onTotalRowsChange={setTotalViewportRows}
            animateStreamingIndicator={enableFullAnimation}
            expandedDetails
            showChrome
            i18n={i18n}
          />
        </Box>
      ) : showEmptyState ? (
        <Box width="100%" flexGrow={1} minHeight={3} overflow="hidden">
          <EmptyState
            assistantName={profile!.name}
            author={profile!.author}
            tagline={i18n.t('assistant.tagline')}
            description={i18n.t('assistant.description')}
            workspaceName={workspaceName}
            packageManager={workspace!.packageManager}
            isGitRepository={workspace!.isGitRepository}
            mode={session.mode}
            modelLabel={modelLabel}
            busy={controller.isBusy}
            animateBrand={enableFullAnimation}
            commands={bootstrap.localCommands}
            currentSessionId={session.id}
            recentSessions={controller.recentSessions}
            i18n={i18n}
          />
        </Box>
      ) : (
        <>
          <HeaderBar
            appName={profile!.name}
            author={profile!.author}
            tagline={i18n.t('assistant.tagline')}
            workspaceName={workspaceName}
            packageManager={workspace!.packageManager}
            isGitRepository={workspace!.isGitRepository}
            mode={session.mode}
            modelLabel={modelLabel}
            busy={controller.isBusy}
            animateBrand={enableFullAnimation}
            i18n={i18n}
          />
          <Box ref={conversationRegionRef} width="100%" flexGrow={1} minHeight={2} overflow="hidden">
            <ConversationViewport
              messages={messages}
              streamingText={controller.streamingText}
              busy={controller.isBusy}
              viewportRows={conversationViewportRows}
              scrollOffset={scroll.offset}
              onTotalRowsChange={setTotalViewportRows}
              animateStreamingIndicator={enableFullAnimation}
              i18n={i18n}
            />
          </Box>
        </>
      )}

      {!isTranscriptView ? (
        <Box width="100%" flexDirection="column" flexShrink={0}>
          <InputDock
            value={controller.inputValue}
            cursor={controller.inputCursor}
            busy={controller.isBusy}
            animateBusyIndicator={enableFullAnimation}
            mode={session.mode}
            modelLabel={modelLabel}
            configInitPrompt={controller.configInitPrompt}
            toolApprovalPrompt={controller.toolApprovalPrompt}
            userInteractionPrompt={controller.userInteractionPrompt}
            commandSuggestions={controller.commandSuggestions}
            selectedSuggestionIndex={controller.selectedSuggestionIndex}
            isSuggestionOpen={controller.isSuggestionOpen}
            choiceItems={controller.choiceItems}
            selectedChoiceIndex={controller.selectedChoiceIndex}
            i18n={i18n}
          />
          <StatusDock
            statusLine={controller.statusLine}
            isBusy={controller.isBusy}
            isConfigured={Boolean(modelConfig!.apiKey)}
            workspaceName={workspaceName}
            isGitRepository={workspace!.isGitRepository}
            mode={session.mode}
            modelLabel={modelConfig!.model}
            contextPercent={contextPercent}
            approxTokens={approxTokens}
            i18n={i18n}
          />
        </Box>
      ) : (
        <Box width="100%" justifyContent="space-between" paddingX={1}>
          <Text color={adnifyTheme.brandSoft} bold>{i18n.t('conversation.transcriptTitle')}</Text>
          <Text color={adnifyTheme.textDim}>PgUp/PgDn · Ctrl+U/D · Ctrl+G · Q</Text>
        </Box>
      )}
    </Box>
  )
}
