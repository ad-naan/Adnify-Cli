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
  return (
    <Box flexWrap="wrap" gap={1} marginY={1}>
      {props.items.map((item, index) => {
        const selected = index === props.selectedIndex
        return (
          <Box
            key={item.id}
            borderStyle="round"
            borderColor={selected ? adnifyTheme.brand : adnifyTheme.borderMuted}
            paddingX={1}
          >
            <Text color={selected ? adnifyTheme.brandSoft : adnifyTheme.textSecondary} bold={selected}>
              {selected ? '› ' : '  '}{item.label}
              {item.description ? ` · ${item.description}` : ''}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
})
