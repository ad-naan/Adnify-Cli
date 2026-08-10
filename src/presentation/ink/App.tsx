import { Box, Newline, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdnifyCliRuntime } from '../../application/dto/AdnifyCliRuntime'
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

/**
 * 审批面板里除提示文本之外固定占掉的行数。
 *
 * 数出来的：Panel 边框 2 + 标签行 1 + PromptBlock 上边距 1 + 它自己的边框 2
 * + 输入行含上边距 2 + 底部按键说明 1 = 9。
 */
const APPROVAL_CHROME_ROWS = 9

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

  const bootstrap = controller.bootstrap
  const session = controller.session
  const workspace = bootstrap?.workspace
  const profile = bootstrap?.profile
  const modelConfig = bootstrap?.modelConfig
  const modelLabel = modelConfig ? `${modelConfig.provider} / ${modelConfig.model}` : ''
  const workspaceName = workspace
    ? workspace.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? workspace.rootPath
    : i18n.t('app.boot.workspaceName')
  // 渲染完整历史而不是最近 24 条 —— 视口只切显示窗口，
  // 早先的消息留在数组里才翻得回去；截断在这一层就等于永久丢失。
  const messages = useMemo(
    () => [...(session?.getMessages() ?? []), ...controller.streamingMessages],
    [controller.streamingMessages, session],
  )
  const showEmptyState =
    Boolean(session) &&
    messages.length === 0 &&
    !controller.streamingText
  const [isTranscriptView, setIsTranscriptView] = useState(false)
  useEffect(() => {
    // 审批与配置向导必须始终可见，不能被全屏记录模式盖住。
    if (controller.toolApprovalPrompt || controller.configInitPrompt) {
      setIsTranscriptView(false)
    }
  }, [controller.configInitPrompt, controller.toolApprovalPrompt])
  const terminalRows = stdout?.rows ?? 30
  const viewportChromeRows = 1
  const headerRows = showEmptyState ? 0 : 5
  // 审批面板的高度按实际文本行数算，而不是猜一个常数 ——
  // 预览会折叠到多少行由 useToolApproval 决定，这里写死就会和它对不上，
  // 结果要么把会话区多挤掉几行，要么让面板自己被裁掉。
  const approvalRows = controller.toolApprovalPrompt
    ? controller.toolApprovalPrompt.split('\n').length + APPROVAL_CHROME_ROWS
    : 0
  const inputRows = controller.configInitPrompt
    ? 14
    : approvalRows > 0
      ? approvalRows
      : controller.isSuggestionOpen
        ? 12
        : controller.isBusy
          ? 7
          : 8
  const statusRows = 2
  const layoutGapRows = showEmptyState ? 1 : 2
  const safetyRows = 2
  // 会话区吃掉终端剩下的全部高度。
  // 这里曾经有个 Math.min(12, …) 的硬上限，导致 50 行的终端也只给会话区 12 行；
  // 既然现在可以滚动，多出来的高度是实打实能用的，不再设上限。
  const conversationViewportRows = isTranscriptView
    ? Math.max(4, terminalRows - 2)
    : Math.max(
        4,
        terminalRows -
          headerRows -
          inputRows -
          statusRows -
          layoutGapRows -
          viewportChromeRows -
          safetyRows,
      )
  const [totalViewportRows, setTotalViewportRows] = useState(0)
  // 按正文高度算滚动上限：顶部那行提示条不显示内容，
  // 用整个视口高度算的话最早一行会永远翻不到。
  const scroll = useViewportScroll(
    totalViewportRows,
    conversationBodyRows(conversationViewportRows),
  )

  // 滚动键先于其它输入处理：PgUp/PgDn 在会话区之外没有别的用途，
  // 而且审批面板活跃时也应该能翻上去看清究竟要批准什么。
  const handleInput = useCallback(
    (input: string, key: Parameters<typeof controller.handleInput>[1]) => {
      if (
        key.ctrl &&
        input === 'o' &&
        !controller.toolApprovalPrompt &&
        !controller.configInitPrompt
      ) {
        setIsTranscriptView((current) => !current)
        return
      }

      if (key.pageUp) {
        // 翻一屏时留一行重叠，避免跨屏的那一行被跳过去。
        scroll.scrollUp(Math.max(1, conversationViewportRows - 1))
        return
      }

      if (key.pageDown) {
        scroll.scrollDown(Math.max(1, conversationViewportRows - 1))
        return
      }

      // 翻上去之后 Esc 先用来回到底部 —— 但执行中和审批中不行，
      // 那两种状态下 Esc 是「中止 / 拒绝」，抢走它会让用户没法叫停。
      if (
        key.escape &&
        scroll.isScrolled &&
        !controller.isBusy &&
        !controller.toolApprovalPrompt
      ) {
        scroll.scrollToBottom()
        return
      }

      if (
        isTranscriptView &&
        (key.escape || input.toLowerCase() === 'q') &&
        !controller.isBusy &&
        !controller.toolApprovalPrompt
      ) {
        setIsTranscriptView(false)
        return
      }

      controller.handleInput(input, key)
    },
    [
      conversationViewportRows,
      controller.handleInput,
      controller.configInitPrompt,
      controller.isBusy,
      controller.toolApprovalPrompt,
      isTranscriptView,
      scroll,
    ],
  )

  useInput(handleInput)

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
                  color={adnifyTheme.brandSoft}
                  idleFrame="·  "
                  variant="dots"
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
      {isTranscriptView ? (
        <>
          <ConversationViewport
            messages={messages}
            streamingText={controller.streamingText}
            viewportRows={conversationViewportRows}
            scrollOffset={scroll.offset}
            onTotalRowsChange={setTotalViewportRows}
            animateStreamingIndicator={enableFullAnimation}
            expandedDetails
            i18n={i18n}
          />
          <Box width="100%" justifyContent="space-between" paddingX={1}>
            <Text color={adnifyTheme.brandSoft} bold>
              {i18n.t('conversation.transcriptTitle')}
            </Text>
            <Text color={adnifyTheme.textDim}>{i18n.t('conversation.transcriptHint')}</Text>
          </Box>
        </>
      ) : showEmptyState ? (
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
          animateBrand={enableFullAnimation}
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
              scrollOffset={scroll.offset}
              onTotalRowsChange={setTotalViewportRows}
              animateStreamingIndicator={enableFullAnimation}
              i18n={i18n}
            />
          </Box>
        </>
      )}

      {!isTranscriptView ? (
        <>
          <Box width="100%" marginTop={1}>
            <InputDock
              value={controller.inputValue}
              busy={controller.isBusy}
              animateBusyIndicator={enableFullAnimation}
              mode={controller.session.mode}
              modelLabel={modelLabel}
              configInitPrompt={controller.configInitPrompt}
              toolApprovalPrompt={controller.toolApprovalPrompt}
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
        </>
      ) : null}
    </Box>
  )
}
