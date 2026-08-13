import { Box, Text } from 'ink'
import { memo } from 'react'
import type { ActiveTaskItem } from '../hooks/useCliController'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import { adnifyTheme } from '../theme'

function taskGlyph(status: ActiveTaskItem['status']): { glyph: string; color: string } {
  switch (status) {
    case 'completed':
      return { glyph: '✓', color: adnifyTheme.success }
    case 'failed':
    case 'cancelled':
      return { glyph: '✗', color: adnifyTheme.danger }
    case 'running':
      return { glyph: '◉', color: adnifyTheme.brandSoft }
    default:
      return { glyph: '○', color: adnifyTheme.textDim }
  }
}

/** One stable task surface. Progress updates replace rows instead of flooding the chat. */
export const TaskDock = memo(function TaskDock(props: { tasks: ActiveTaskItem[]; i18n: AppI18n }) {
  if (props.tasks.length === 0) return null

  const completed = props.tasks.filter((task) => task.status === 'completed').length
  return (
    <Box width="100%" flexDirection="column" paddingX={1} marginBottom={1}>
      <Box gap={1}>
        <Text color={adnifyTheme.brandSoft} bold>{props.i18n.t('taskDock.title')}</Text>
        <Text color={adnifyTheme.textDim}>{completed}/{props.tasks.length}</Text>
      </Box>
      {props.tasks.map((task) => {
        const appearance = taskGlyph(task.status)
        return (
          <Box key={task.id} gap={1} paddingLeft={1}>
            <Text color={appearance.color}>{appearance.glyph}</Text>
            <Text
              color={task.status === 'completed' ? adnifyTheme.textDim : adnifyTheme.textSecondary}
              strikethrough={task.status === 'completed'}
              wrap="truncate-end"
            >
              {task.title}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
})
