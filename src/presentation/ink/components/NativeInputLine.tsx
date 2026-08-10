import { Box, Text, useCursor, useWindowSize } from 'ink'
import { adnifyTheme } from '../theme'
import { resolveInputWindow } from '../terminalText'

export interface NativeInputLineProps {
  value: string
  cursor: number
  placeholder: string
  active: boolean
}

/**
 * Inline cursor editor.
 *
 * The cursor is rendered in the text flow, so flex relayouts cannot leave it at a stale
 * terminal coordinate. The actual terminal cursor stays hidden; the highlighted cell is
 * always the controller's logical editing position.
 */
export function NativeInputLine(props: NativeInputLineProps) {
  const { columns } = useWindowSize()
  const { setCursorPosition } = useCursor()
  const inputWindow = resolveInputWindow(props.value, props.cursor, Math.max(8, columns - 8))
  setCursorPosition(undefined)

  return (
    <Box flexGrow={1} minWidth={1} aria-role="textbox">
      {props.value ? (
        <Text wrap="truncate-end">
          <Text color={adnifyTheme.textPrimary}>{inputWindow.beforeCursor}</Text>
          <Text
            color={props.active ? adnifyTheme.surface : adnifyTheme.textMuted}
            backgroundColor={props.active ? adnifyTheme.brandSoft : undefined}
          >
            {inputWindow.cursorCharacter}
          </Text>
          <Text color={adnifyTheme.textPrimary}>{inputWindow.afterCursor}</Text>
        </Text>
      ) : (
        <Text wrap="truncate-end">
          <Text
            color={props.active ? adnifyTheme.surface : adnifyTheme.textMuted}
            backgroundColor={props.active ? adnifyTheme.brandSoft : undefined}
          >
            {' '}
          </Text>
          <Text color={adnifyTheme.textDim}> {props.placeholder}</Text>
        </Text>
      )}
    </Box>
  )
}
