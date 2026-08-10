import { Box, Text } from 'ink'
import { memo } from 'react'
import { adnifyTheme } from '../theme'
import { useAnimatedFrames } from '../hooks/useAnimatedFrames'

export interface MascotGlyphProps {
  active?: boolean
  large?: boolean
  animated?: boolean
}

/** 原创水獭字形：圆耳、浅色口鼻、胸前小爪与水面尾波共同构成识别特征。 */
export const MascotGlyph = memo(function MascotGlyph(props: MascotGlyphProps) {
  const isBusy = props.active ?? false
  const eyes = useAnimatedFrames(['•  •', '─  ─', '•  •', '•  •'] as const, {
    active: Boolean(isBusy && props.animated),
    intervalMs: 240,
  })
  const wake = useAnimatedFrames(['≈', '≋', '~', '≋'] as const, {
    active: Boolean(isBusy && props.animated),
    intervalMs: 160,
  })

  if (!props.large) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          <Text color={adnifyTheme.mascotWater}>{wake}</Text>
          <Text color={adnifyTheme.mascotFurSoft}>╭</Text>
          <Text color={adnifyTheme.mascotFur}>•ᴥ•</Text>
          <Text color={adnifyTheme.mascotFurSoft}>╮</Text>
          <Text color={adnifyTheme.mascotWater}>{wake}</Text>
        </Text>
        <Text color={adnifyTheme.mascotWater}> ≈╰┬╯≈ </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexShrink={0} alignItems="center">
      <Text>
        <Text color={adnifyTheme.mascotFurSoft}>  ╭─╮   ╭─╮  </Text>
      </Text>
      <Text>
        <Text color={adnifyTheme.mascotFur}> ╭╯ </Text>
        <Text color={isBusy ? adnifyTheme.brandSoft : adnifyTheme.textPrimary}>{eyes}</Text>
        <Text color={adnifyTheme.mascotFur}> ╰╮ </Text>
      </Text>
      <Text>
        <Text color={adnifyTheme.mascotWater}>{wake}</Text>
        <Text color={adnifyTheme.mascotFur}>┫   </Text>
        <Text color={adnifyTheme.mascotMuzzle}>ᴥ</Text>
        <Text color={adnifyTheme.mascotFur}>   ┣</Text>
        <Text color={adnifyTheme.mascotWater}>{wake}</Text>
      </Text>
      <Text color={adnifyTheme.mascotFur}>╰╮  ╰┬╯  ╭╯</Text>
      <Text>
        <Text color={adnifyTheme.mascotWater}>{wake.repeat(2)}</Text>
        <Text color={adnifyTheme.mascotFurSoft}>╰───────╯</Text>
        <Text color={adnifyTheme.mascotWater}>{wake.repeat(2)}</Text>
      </Text>
    </Box>
  )
})
