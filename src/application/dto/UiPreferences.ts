export type AnimationLevel = 'off' | 'minimal' | 'full'
export type PermissionMode = 'manual' | 'workspace' | 'auto' | 'plan'

export interface UiPreferences {
  animationLevel: AnimationLevel
  permissionMode: PermissionMode
}
