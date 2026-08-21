import type { UiPreferences, AnimationLevel, PermissionMode } from '../../application/dto/UiPreferences'
import { normalizeThemeAppearance, resolveThemeMode } from './resolveThemeMode'

function resolveAnimationLevel(input?: string | null): AnimationLevel {
  const normalized = input?.trim().toLowerCase()

  switch (normalized) {
    case 'off':
    case 'none':
    case '0':
      return 'off'
    case 'full':
    case 'high':
    case '2':
      return 'full'
    case 'minimal':
    case 'low':
    case '1':
      return 'minimal'
    default:
      return 'full'
  }
}

function resolvePermissionMode(input?: string | null): PermissionMode {
  switch (input?.trim().toLowerCase()) {
    case 'manual':
    case 'workspace':
    case 'auto':
    case 'plan':
      return input.trim().toLowerCase() as PermissionMode
    default:
      return 'workspace'
  }
}

export function resolveUiPreferences(
  env: Record<string, string | undefined> = process.env,
  persistedAnimationLevel?: string | null,
  persistedPermissionMode?: string | null,
  persistedThemeAppearance?: string | null,
): UiPreferences {
  return {
    animationLevel: resolveAnimationLevel(env.ADNIFY_ANIMATION_LEVEL ?? persistedAnimationLevel),
    permissionMode: resolvePermissionMode(env.ADNIFY_PERMISSION_MODE ?? persistedPermissionMode),
    themeAppearance: normalizeThemeAppearance(env.ADNIFY_THEME ?? persistedThemeAppearance),
    theme: resolveThemeMode(env, persistedThemeAppearance),
  }
}
