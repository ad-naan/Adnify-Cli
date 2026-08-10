import { Box, Text, useStdout } from 'ink'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { memo } from 'react'
import { adnifyTheme } from '../theme'

export interface StatusDockProps {
  statusLine: string
  isBusy: boolean
  isConfigured: boolean
  i18n: AppI18n
}

export const StatusDock = memo(function StatusDock(props: StatusDockProps) {
  const { stdout } = useStdout()
  const showControlHint = (stdout?.columns ?? 100) >= 92
  const readinessLabel = props.isConfigured
    ? props.i18n.t('status.configured')
    : props.i18n.t('status.setupRequired')
  const readinessColor = props.isConfigured ? adnifyTheme.success : adnifyTheme.warm

  return (
    <Box width="100%" marginTop={1} justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        <Text color={props.isBusy ? adnifyTheme.brand : readinessColor} bold>
          {props.isBusy ? '●' : '◇'}
        </Text>
        <Text color={adnifyTheme.textMuted}>{props.statusLine}</Text>
      </Box>
      <Box gap={2}>
        {showControlHint ? (
          <Text color={adnifyTheme.textDim}>{props.i18n.t('status.hintControls')}</Text>
        ) : null}
        <Text color={readinessColor}>
          {props.i18n.t('status.system')} {readinessLabel}
        </Text>
      </Box>
    </Box>
  )
})
