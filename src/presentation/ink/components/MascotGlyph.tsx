import { Box, Text } from 'ink'
import { memo } from 'react'
import { adnifyTheme } from '../theme'
import { useAnimatedFrames } from '../hooks/useAnimatedFrames'

export interface MascotGlyphProps {
  active?: boolean
  large?: boolean
  animated?: boolean
}

/**
 * 终端吉祥物采用固定尺寸字形拼装。
 * 纯静态渲染，仅通过 active 状态改变"眼神"和颜色。
 * 当 animated 且 active 时，visor 区域有微妙的旋转动效。
 */
export const MascotGlyph = memo(function MascotGlyph(props: MascotGlyphProps) {
  const isBusy = props.active ?? false

  // Subtle busy-eye animation: cycles between "〰" and "≈"
  const eye = useAnimatedFrames(['〰', '≈'] as const, {
    active: Boolean(isBusy && props.animated),
    intervalMs: 300,
  })

  const busyEyes = props.animated ? `${eye}   ${eye}` : '〰   〰'

  const face = (
    <Box flexDirection="column" flexShrink={0} alignItems="center">
      <Text>
        <Text color={adnifyTheme.mascotShell}> ▗</Text>
        <Text
          color={isBusy ? adnifyTheme.brandStrong : adnifyTheme.textPrimary}
          backgroundColor={adnifyTheme.mascotVisor}
        >
          {isBusy ? busyEyes : '•   •'}
        </Text>
        <Text color={adnifyTheme.mascotShell}>▖ </Text>
      </Text>
      <Text>
        <Text color={adnifyTheme.mascotShell}>▐ </Text>
        <Text
          color={isBusy ? adnifyTheme.brand : adnifyTheme.mascotCore}
          backgroundColor={adnifyTheme.surfaceSoft}
        >
          ▅▅▅▅▅
        </Text>
        <Text color={adnifyTheme.mascotShell}> ▌</Text>
      </Text>
      <Text color={adnifyTheme.mascotShell}>  ▝▘ ▝▘  </Text>
    </Box>
  )

  if (props.large) {
    return (
      <Box padding={1} borderStyle="round" borderColor={adnifyTheme.borderMuted} marginBottom={1}>
        {face}
      </Box>
    )
  }

  return face
})
