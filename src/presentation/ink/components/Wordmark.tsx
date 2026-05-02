import { Box, Text } from 'ink'
import { memo } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { adnifyTheme } from '../theme'
import { MascotGlyph } from './MascotGlyph'

export interface WordmarkProps {
  appName: string
  author?: string
  tagline: string
  busy?: boolean
  animateMascot?: boolean
  i18n: AppI18n
}

export const Wordmark = memo(function Wordmark(props: WordmarkProps) {
  return (
    <Box gap={1} alignItems="flex-start">
      <MascotGlyph active={Boolean(props.busy && props.animateMascot)} />
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={adnifyTheme.brandSoft} bold>
            {props.appName}
          </Text>
          {props.author ? (
            <Text color={adnifyTheme.textDim}>
              {props.i18n.t('common.by')} {props.author}
            </Text>
          ) : null}
        </Box>
        <Text color={adnifyTheme.textSecondary}>{props.tagline}</Text>
      </Box>
    </Box>
  )
})
