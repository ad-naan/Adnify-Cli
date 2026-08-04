import { Text } from 'ink'
import { memo } from 'react'
import { adnifyTheme } from '../theme'

export interface InputCursorProps {
  visible?: boolean
  busy?: boolean
}

/**
 * Blinking cursor indicator.
 * Uses ANSI bold + inverse for a subtle highlight effect.
 */
export const InputCursor = memo(function InputCursor(props: InputCursorProps) {
  const color = props.busy ? adnifyTheme.brandSoft : adnifyTheme.brand
  return (
    <Text color={color} bold={props.busy}>
      {props.visible ? '\u2588' : ' '}
    </Text>
  )
})
