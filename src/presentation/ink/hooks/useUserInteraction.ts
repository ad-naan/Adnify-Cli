import { useEffect, useMemo, useState } from 'react'
import type { UserChoiceSnapshot, UserInteractionController } from '../../../application/ports/UserInteractionPort'
import type { ChoiceTabItem } from '../components/ChoiceTabs'
import { useChoiceSelection } from './useChoiceSelection'

export function useUserInteraction(controller: UserInteractionController | null) {
  const [snapshot, setSnapshot] = useState<UserChoiceSnapshot | null>(null)
  const choice = useChoiceSelection(
    snapshot?.question.options.length ?? 0,
    snapshot ? `${snapshot.question.id}:${snapshot.questionIndex}` : null,
  )

  useEffect(() => {
    controller?.setObserver(setSnapshot)
  }, [controller])

  const choiceItems = useMemo<ChoiceTabItem[]>(() =>
    snapshot?.question.options.map((option, index) => ({
      id: `${snapshot.question.id}-${index}`,
      label: option.label,
      description: option.description,
    })) ?? [], [snapshot])

  return {
    isActive: snapshot !== null,
    promptText: snapshot
      ? `${snapshot.question.header} · ${snapshot.questionIndex + 1}/${snapshot.questionCount}\n${snapshot.question.question}`
      : '',
    choiceItems,
    selectedChoiceIndex: choice.selectedIndex,
    moveSelection: choice.move,
    confirmSelection: () => controller?.selectOption(choice.selectedIndex) ?? false,
    cancel: () => controller?.cancelPending(),
  }
}
