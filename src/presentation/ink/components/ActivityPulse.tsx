import { Text } from 'ink'
import { memo } from 'react'
import { useAnimatedFrames } from '../hooks/useAnimatedFrames'
import { adnifyTheme, SPINNER_FRAMES } from '../theme'

export interface ActivityPulseProps {
  active?: boolean
  animated?: boolean
  color?: string
  idleFrame?: string
  /** Animation style: 'dots' (braille spinner) or 'pulse' (circle) */
  variant?: 'dots' | 'pulse'
}

/**
 * 小体积状态脉冲。
 * 默认使用静态占位，只有显式开启动画时才做帧切换，避免运行态抖动。
 * Ink 7's useEffectEvent optimization ensures the interval callback
 * doesn't trigger parent re-renders.
 */
export const ActivityPulse = memo(function ActivityPulse(props: ActivityPulseProps) {
  const frames = props.variant === 'pulse' ? SPINNER_FRAMES.pulse : SPINNER_FRAMES.dots
  const frame = useAnimatedFrames(frames, {
    active: Boolean(props.active && props.animated),
    intervalMs: props.variant === 'pulse' ? 200 : 80,
  })

  return (
    <Text color={props.color ?? adnifyTheme.brandSoft} bold>
      {props.active && props.animated ? frame : props.idleFrame ?? '• '}
    </Text>
  )
})
