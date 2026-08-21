export type AnimationLevel = 'off' | 'minimal' | 'full'
export type PermissionMode = 'manual' | 'workspace' | 'auto' | 'plan'

/** The persisted appearance preference. `system` auto-detects from the terminal. */
export type ThemeAppearance = 'light' | 'dark' | 'system'
/** A concrete resolved palette. */
export type ThemeMode = 'light' | 'dark'

export interface UiPreferences {
  animationLevel: AnimationLevel
  permissionMode: PermissionMode
  /** Persisted preference (`system` = follow the terminal). */
  themeAppearance: ThemeAppearance
  /** Concrete palette resolved from {@link themeAppearance} + terminal detection. */
  theme: ThemeMode
}
