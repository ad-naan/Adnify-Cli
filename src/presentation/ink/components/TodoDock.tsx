import { Box, Text } from 'ink'
import { memo } from 'react'
import type { TodoItem } from '../hooks/useCliController'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { adnifyTheme } from '../theme'

function todoGlyph(status: TodoItem['status']): { glyph: string; color: string } {
  switch (status) {
    case 'completed':
      return { glyph: '✓', color: adnifyTheme.success }
    case 'in_progress':
      return { glyph: '◉', color: adnifyTheme.brandSoft }
    default:
      return { glyph: '○', color: adnifyTheme.textDim }
  }
}

/** Live checklist surface. todo-write overwrites the whole list, so rows never accumulate. */
export const TodoDock = memo(function TodoDock(props: { todos: TodoItem[]; busy?: boolean; i18n: AppI18n }) {
  if (props.todos.length === 0) return null

  const completed = props.todos.filter((todo) => todo.status === 'completed').length
  const remaining = props.todos.length - completed
  // When the turn is idle but work is still outstanding, nudge the user so the list isn't forgotten.
  const showReminder = !props.busy && remaining > 0
  return (
    <Box width="100%" flexDirection="column" paddingX={1} marginBottom={1}>
      <Box gap={1}>
        <Text color={adnifyTheme.brandSoft} bold>{props.i18n.t('todoDock.title')}</Text>
        <Text color={adnifyTheme.textDim}>{completed}/{props.todos.length}</Text>
      </Box>
      {props.todos.map((todo, index) => {
        const appearance = todoGlyph(todo.status)
        return (
          <Box key={index} gap={1} paddingLeft={1}>
            <Text color={appearance.color}>{appearance.glyph}</Text>
            <Text
              color={todo.status === 'completed' ? adnifyTheme.textDim : adnifyTheme.textSecondary}
              strikethrough={todo.status === 'completed'}
              bold={todo.status === 'in_progress'}
              wrap="truncate-end"
            >
              {todo.content}
            </Text>
          </Box>
        )
      })}
      {showReminder ? (
        <Box gap={1} paddingLeft={1}>
          <Text color={adnifyTheme.warm}>⚠</Text>
          <Text color={adnifyTheme.warm} wrap="truncate-end">
            {props.i18n.t('todoDock.reminder', { count: remaining })}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
})
