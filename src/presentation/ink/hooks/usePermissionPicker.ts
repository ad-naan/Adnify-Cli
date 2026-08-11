import { useMemo, useState } from 'react'
import type { PermissionMode } from '../../../application/dto/UiPreferences'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { ToolApprovalController } from '../../../application/ports/ToolApprovalPort'
import type { ChoiceTabItem } from '../components/ChoiceTabs'
import { useChoiceSelection } from './useChoiceSelection'

const MODES: PermissionMode[] = ['manual', 'workspace', 'auto', 'plan']

export function usePermissionPicker(i18n: AppI18n, controller: ToolApprovalController) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const initialIndex = Math.max(0, MODES.indexOf(controller.getMode()))
  const choice = useChoiceSelection(MODES.length, activeKey, initialIndex)
  const items = useMemo<ChoiceTabItem[]>(() => MODES.map((mode) => ({
    id: mode,
    label: i18n.t(`permissions.mode.${mode}`),
    description: i18n.t(`permissions.mode.${mode}.description`),
  })), [i18n])

  return {
    isActive: activeKey !== null,
    promptText: activeKey ? i18n.t('permissions.selectTitle') : '',
    choiceItems: items,
    selectedChoiceIndex: choice.selectedIndex,
    selectedMode: MODES[choice.selectedIndex] ?? 'workspace',
    open: () => setActiveKey(`permissions-${Date.now()}`),
    close: () => setActiveKey(null),
    moveSelection: choice.move,
  }
}
