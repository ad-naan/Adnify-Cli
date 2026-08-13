import { Box, Text } from 'ink'
import { memo } from 'react'
import { adnifyTheme } from '../theme'

export interface ChoiceTabItem {
  id: string
  label: string
  description?: string
}

export const ChoiceTabs = memo(function ChoiceTabs(props: {
  items: ChoiceTabItem[]
  selectedIndex: number
}) {
  const visibleCount = 5
  const safeIndex = Math.max(0, Math.min(props.selectedIndex, props.items.length - 1))
  const maxStart = Math.max(0, props.items.length - visibleCount)
  const start = Math.max(0, Math.min(maxStart, safeIndex - Math.floor(visibleCount / 2)))
  const visibleItems = props.items.slice(start, start + visibleCount)

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      {start > 0 ? <Text color={adnifyTheme.textDim}>↑ {start}</Text> : null}
      {visibleItems.map((item, visibleIndex) => {
        const index = start + visibleIndex
        const selected = index === safeIndex
        return (
          <Box
            key={item.id}
            gap={1}
          >
            <Text color={selected ? adnifyTheme.brandSoft : adnifyTheme.textDim}>
              {selected ? '●' : '○'}
            </Text>
            <Text
              color={selected ? adnifyTheme.textPrimary : adnifyTheme.textSecondary}
              bold={selected}
              wrap="truncate-end"
            >
              {item.label}{item.description ? `  ${item.description}` : ''}
            </Text>
          </Box>
        )
      })}
      {start + visibleItems.length < props.items.length ? (
        <Text color={adnifyTheme.textDim}>↓ {props.items.length - start - visibleItems.length}</Text>
      ) : null}
    </Box>
  )
})
