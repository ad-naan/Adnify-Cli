import { useCallback, useEffect, useState } from 'react'

/** Shared keyboard selection state for every bottom-dock choice surface. */
export function useChoiceSelection(
  itemCount: number,
  activeKey: string | null,
  initialIndex = 0,
) {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)

  useEffect(() => {
    if (activeKey !== null) {
      setSelectedIndex(Math.max(0, Math.min(initialIndex, Math.max(0, itemCount - 1))))
    }
  }, [activeKey, initialIndex, itemCount])

  const move = useCallback((direction: 'previous' | 'next') => {
    if (itemCount <= 0) return
    setSelectedIndex((current) => direction === 'previous'
      ? (current - 1 + itemCount) % itemCount
      : (current + 1) % itemCount)
  }, [itemCount])

  const select = useCallback((index: number) => {
    setSelectedIndex(Math.max(0, Math.min(index, Math.max(0, itemCount - 1))))
  }, [itemCount])

  return { selectedIndex, move, select }
}
