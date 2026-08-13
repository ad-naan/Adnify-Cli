import type {
  StorageSettingsSnapshot,
  StorageSettingsUpdateResult,
} from '../dto/StorageSettingsSnapshot'
import type { AnimationLevel, PermissionMode } from '../dto/UiPreferences'
import type { AppLocale } from '../i18n/AppI18n'
import type { RuntimeBudgetPatch } from './RuntimeBudgetPort'

export interface StorageSettingsPort {
  inspect(): Promise<StorageSettingsSnapshot>
  setDataDirectory(path: string): Promise<StorageSettingsUpdateResult>
  resetDataDirectory(): Promise<StorageSettingsUpdateResult>
  setLocale?(locale: AppLocale): Promise<void>
  setAnimationLevel?(level: AnimationLevel): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  setRuntimeBudget?(budget: RuntimeBudgetPatch): Promise<void>
}
