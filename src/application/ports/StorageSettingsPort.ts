import type {
  StorageSettingsSnapshot,
  StorageSettingsUpdateResult,
} from '../dto/StorageSettingsSnapshot'
import type { AnimationLevel } from '../dto/UiPreferences'
import type { AppLocale } from '../i18n/AppI18n'

export interface StorageSettingsPort {
  inspect(): Promise<StorageSettingsSnapshot>
  setDataDirectory(path: string): Promise<StorageSettingsUpdateResult>
  resetDataDirectory(): Promise<StorageSettingsUpdateResult>
  setLocale?(locale: AppLocale): Promise<void>
  setAnimationLevel?(level: AnimationLevel): Promise<void>
}
