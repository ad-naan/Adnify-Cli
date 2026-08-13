import type { AnimationLevel, PermissionMode } from '../dto/UiPreferences'
import type { AppLocale } from '../i18n/AppI18n'
import type { RuntimeBudget, RuntimeBudgetPatch } from './RuntimeBudgetPort'

export interface RuntimeControlPort {
  inspect(): string
  getPermissionMode(): PermissionMode
  setPermissionMode(mode: PermissionMode): Promise<void>
  setAnimationLevel(level: AnimationLevel): Promise<void>
  setLocale(locale: AppLocale): Promise<void>
  switchModel(provider: string, model?: string): { provider: string; model: string } | null
  getRuntimeBudget?(): Readonly<RuntimeBudget>
  setRuntimeBudget?(patch: RuntimeBudgetPatch): Readonly<RuntimeBudget>
}
