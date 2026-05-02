import { Box, Newline, Text, useApp, useInput, useStdout } from 'ink'
import { useMemo } from 'react'
import type { AdnifyCliRuntime } from '../../application/dto/AdnifyCliRuntime'
import { adnifyTheme } from './theme'
import { ActivityPulse } from './components/ActivityPulse'
import { ConversationViewport } from './components/ConversationViewport'
import { EmptyState } from './components/EmptyState'
import { HeaderBar } from './components/HeaderBar'
import { InputDock } from './components/InputDock'
import { Panel } from './components/Panel'
import { StatusDock } from './components/StatusDock'
import { useCliController } from './hooks/useCliController'

export interface AppProps {
  runtime: AdnifyCliRuntime
  cwd: string
}

export function App(props: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const controller = useCliController({
    runtime: props.runtime,
    cwd: props.cwd,
    onExit: exit,
  })
  const { i18n } = props.runtime
  const animationLevel = props.runtime.ui.animationLevel
  const enableFullAnimation = animationLevel === 'full'

  useInput(controller.handleInput)

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
    () => [...(session?.getRecentMessages(24) ?? []), ...controller.streamingMessages],
    [controller.streamingMessages, session],
  )
  const showEmptyState =
    Boolean(session) &&
    messages.length === 0 &&
    !controller.streamingText
  const terminalRows = stdout?.rows ?? 30
  const viewportChromeRows = 4
  const headerRows = showEmptyState ? 0 : 7
  const inputRows = controller.configInitPrompt
    ? 14
    : controller.approvalPrompt
      ? 13
    : controller.isSuggestionOpen
      ? 12
      : controller.isBusy
        ? 7
        : 8
  const statusRows = controller.isBusy ? 0 : 2
  const layoutGapRows = showEmptyState ? 1 : 2
  const safetyRows = 2
  const conversationViewportRows = Math.max(
    4,
    Math.min(
      12,
      terminalRows -
        headerRows -
        inputRows -
        statusRows -
        layoutGapRows -
        viewportChromeRows -
        safetyRows,
    ),
  )

  if (controller.isBooting) {
    return (
      <Box width="100%" flexDirection="column" paddingX={1}>
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
          <Panel
            title={i18n.t('app.boot.panelTitle')}
            subtitle={i18n.t('app.boot.panelSubtitle')}
            accent="brand"
          >
            <Box flexDirection="column" marginTop={1}>
              <Box gap={1}>
                <ActivityPulse
                  active
                  animated={enableFullAnimation}
                  color={adnifyTheme.brandStrong}
                  idleFrame=".  "
                />
                <Text color={adnifyTheme.brand}>{i18n.t('app.boot.heading')}</Text>
              </Box>
              <Text color={adnifyTheme.textMuted}>{i18n.t('app.boot.description')}</Text>
            </Box>
          </Panel>
        </Box>
      </Box>
    )
  }

  if (!controller.bootstrap || !controller.session) {
    return (
      <Box width="100%" flexDirection="column" paddingX={1}>
        <Text color={adnifyTheme.danger}>{i18n.t('app.boot.failed')}</Text>
        <Newline />
        <Text color={adnifyTheme.textPrimary}>{controller.statusLine}</Text>
      </Box>
    )
  }

  const readyBootstrap = controller.bootstrap
  const readySession = controller.session
  const readyWorkspace = readyBootstrap.workspace
  const readyProfile = readyBootstrap.profile
  const readyModelConfig = readyBootstrap.modelConfig

  return (
    <Box width="100%" flexDirection="column" paddingX={1}>
      {showEmptyState ? (
        <EmptyState
          assistantName={readyProfile.name}
          author={readyProfile.author}
          tagline={i18n.t('assistant.tagline')}
          description={i18n.t('assistant.description')}
          workspaceName={workspaceName}
          packageManager={readyWorkspace.packageManager}
          isGitRepository={readyWorkspace.isGitRepository}
          mode={readySession.mode}
          modelLabel={modelLabel}
          busy={controller.isBusy}
          commands={readyBootstrap.localCommands}
          currentSessionId={readySession.id}
          recentSessions={controller.recentSessions}
          i18n={i18n}
        />
      ) : (
        <>
          <HeaderBar
            appName={readyProfile.name}
            author={readyProfile.author}
            tagline={i18n.t('assistant.tagline')}
            workspaceName={workspaceName}
            packageManager={readyWorkspace.packageManager}
            isGitRepository={readyWorkspace.isGitRepository}
            mode={readySession.mode}
            modelLabel={modelLabel}
            busy={controller.isBusy}
            animateBrand={false}
            i18n={i18n}
          />

          <Box width="100%" marginTop={1} flexDirection="column">
            <ConversationViewport
              messages={messages}
              streamingText={controller.streamingText}
              viewportRows={conversationViewportRows}
              animateStreamingIndicator={enableFullAnimation}
              i18n={i18n}
            />
          </Box>
        </>
      )}

      <Box width="100%" marginTop={1}>
        <InputDock
          value={controller.inputValue}
          busy={controller.isBusy}
          animateBusyIndicator={enableFullAnimation}
          mode={controller.session.mode}
          modelLabel={modelLabel}
          configInitPrompt={controller.configInitPrompt}
          approvalPrompt={controller.approvalPrompt}
          commandSuggestions={controller.commandSuggestions}
          selectedSuggestionIndex={controller.selectedSuggestionIndex}
          isSuggestionOpen={controller.isSuggestionOpen}
          i18n={i18n}
        />
      </Box>

      <StatusDock
        statusLine={controller.statusLine}
        isBusy={controller.isBusy}
        isConfigured={Boolean(readyModelConfig.apiKey)}
        i18n={i18n}
      />
    </Box>
  )
}
