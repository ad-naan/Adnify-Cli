import { Box, Text } from 'ink'
import { memo } from 'react'
import type { SessionListItem } from '../../../application/dto/SessionListItem'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { adnifyTheme } from '../theme'

export interface RecentSessionsListProps {
  sessions: SessionListItem[]
  currentSessionId: string
  i18n: AppI18n
  layout?: 'stack' | 'inline'
  limit?: number
}

function resolveModeColor(mode: SessionListItem['mode']): string {
  switch (mode) {
    case 'agent':
      return adnifyTheme.brandStrong
    case 'plan':
      return adnifyTheme.warm
    default:
      return adnifyTheme.success
  }
}

function StackedItem(props: { session: SessionListItem; isCurrent: boolean }) {
  const shortId = props.session.id.slice(0, 8)
  const relativeTime = formatRelativeSessionTime(props.session.updatedAt)

  return (
    <Box justifyContent="space-between" gap={1}>
      <Box gap={1} flexGrow={1}>
        <Text color={props.isCurrent ? adnifyTheme.brandStrong : adnifyTheme.textDim}>
          {props.isCurrent ? '>' : '-'}
        </Text>
        <Text color={adnifyTheme.textDim}>{shortId}</Text>
        <Text
          color={props.isCurrent ? adnifyTheme.brand : adnifyTheme.textSecondary}
          wrap="truncate-end"
        >
          {props.session.title}
        </Text>
      </Box>
      <Box gap={1} flexShrink={0}>
        <Text color={adnifyTheme.textDim}>{relativeTime}</Text>
        <Text color={resolveModeColor(props.session.mode)}>{props.session.mode}</Text>
        <Text color={adnifyTheme.textDim}>{props.session.messageCount}m</Text>
      </Box>
    </Box>
  )
}

function InlineItem(props: { session: SessionListItem; isCurrent: boolean }) {
  const shortId = props.session.id.slice(0, 8)
  const relativeTime = formatRelativeSessionTime(props.session.updatedAt)

  return (
    <Text backgroundColor={props.isCurrent ? adnifyTheme.backgroundHint : undefined}>
      <Text color={props.isCurrent ? adnifyTheme.brandStrong : adnifyTheme.textDim}>
        {props.isCurrent ? '>' : '-'}
      </Text>
      <Text color={adnifyTheme.textDim}> {shortId} </Text>
      <Text color={props.isCurrent ? adnifyTheme.brand : adnifyTheme.textSecondary}>
        {props.session.title}
      </Text>
      <Text color={adnifyTheme.textDim}> </Text>
      <Text color={resolveModeColor(props.session.mode)}>{props.session.mode}</Text>
      <Text color={adnifyTheme.textDim}> {relativeTime}</Text>
    </Text>
  )
}

function formatRelativeSessionTime(updatedAt: string): string {
  const time = new Date(updatedAt).getTime()
  if (!Number.isFinite(time)) {
    return ''
  }

  const diffMs = Date.now() - time
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000))

  if (diffMinutes < 1) {
    return 'now'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

export const RecentSessionsList = memo(function RecentSessionsList(props: RecentSessionsListProps) {
  const layout = props.layout ?? 'stack'
  const sessions = props.sessions.slice(0, props.limit ?? (layout === 'inline' ? 3 : 3))

  if (sessions.length === 0) {
    return null
  }

  if (layout === 'inline') {
    return (
      <Box width="100%" marginTop={1} gap={2}>
        <Text color={adnifyTheme.textDim}>{props.i18n.t('empty.recentSessions')}</Text>
        {sessions.map((session) => (
          <InlineItem
            key={session.id}
            session={session}
            isCurrent={session.id === props.currentSessionId}
          />
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={adnifyTheme.textDim}>{props.i18n.t('empty.recentSessions')}</Text>
      {sessions.map((session) => (
        <StackedItem
          key={session.id}
          session={session}
          isCurrent={session.id === props.currentSessionId}
        />
      ))}
    </Box>
  )
})
