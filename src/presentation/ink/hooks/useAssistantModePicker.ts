import { useMemo, useState } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { AssistantMode } from '../../../domain/assistant/value-objects/AssistantMode'
import type { ChoiceTabItem } from '../components/ChoiceTabs'
import { useChoiceSelection } from './useChoiceSelection'

const MODES: AssistantMode[] = ['chat', 'agent', 'plan']

export function useAssistantModePicker(i18n: AppI18n, currentMode: AssistantMode) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const initialIndex = Math.max(0, MODES.indexOf(currentMode))
  const choice = useChoiceSelection(MODES.length, activeKey, initialIndex)
  const items = useMemo<ChoiceTabItem[]>(() => MODES.map((mode) => ({
    id: mode,
    label: i18n.t(`assistantMode.${mode}`),
    description: i18n.t(`assistantMode.${mode}.description`),
  })), [i18n])

  return {
    isActive: activeKey !== null,
    promptText: activeKey ? i18n.t('assistantMode.selectTitle') : '',
    choiceItems: items,
    selectedChoiceIndex: choice.selectedIndex,
    selectedMode: MODES[choice.selectedIndex] ?? 'agent',
    open: () => setActiveKey(`assistant-mode-${Date.now()}`),
    close: () => setActiveKey(null),
    moveSelection: choice.move,
  }
}
