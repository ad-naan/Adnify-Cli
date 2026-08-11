import type { UiPreferences, AnimationLevel } from '../../application/dto/UiPreferences'

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

export function resolveUiPreferences(
  env: Record<string, string | undefined> = process.env,
  persistedAnimationLevel?: string | null,
): UiPreferences {
  return {
    animationLevel: resolveAnimationLevel(env.ADNIFY_ANIMATION_LEVEL ?? persistedAnimationLevel),
  }
}
