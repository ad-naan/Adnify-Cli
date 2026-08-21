/**
 * Theme palette.
 *
 * The app ships two palettes — a dark one for dark terminals and a light one for
 * light terminals — sharing the same key set. `adnifyTheme` is the *active* palette:
 * a single mutable object that every component reads at render time. `applyTheme`
 * swaps its contents in place (same object reference) so a re-render repaints the
 * whole tree in the new palette without threading a theme through 18 components.
 */
export interface Theme {
  // Surfaces
  surface: string
  surfaceSoft: string
  surfaceActive: string
  backgroundHint: string

  // Borders
  border: string
  borderMuted: string
  borderActive: string
  borderWarm: string

  // Text
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDim: string

  // Brand palette
  brand: string
  brandSoft: string
  brandStrong: string
  brandDim: string

  // Semantic
  info: string
  warm: string
  success: string
  danger: string
  user: string
  accent: string
  accentSoft: string

  // Mascot
  mascotFur: string
  mascotFurSoft: string
  mascotMuzzle: string
  mascotWater: string

  // Spinner colors for animated states
  spinner1: string
  spinner2: string
  spinner3: string
}

export type ThemeMode = 'light' | 'dark'

/** Tuned for dark terminal backgrounds. */
export const DARK_THEME: Theme = {
  surface: '#101a1d',
  surfaceSoft: '#17262a',
  surfaceActive: '#20363a',
  backgroundHint: '#1b2c30',

  border: '#385158',
  borderMuted: '#293e44',
  borderActive: '#55d6be',
  borderWarm: '#d6a76f',

  textPrimary: '#edf7f5',
  textSecondary: '#c3d8d4',
  textMuted: '#88a7a4',
  textDim: '#627f7d',

  brand: '#55d6be',
  brandSoft: '#8ce8d6',
  brandStrong: '#2eb69d',
  brandDim: '#247e70',

  info: '#79b8ff',
  warm: '#dfb477',
  success: '#8bd49c',
  danger: '#ef8f8f',
  user: '#9bc4ff',
  accent: '#c7a0e8',
  accentSoft: '#dec2f2',

  mascotFur: '#c58a55',
  mascotFurSoft: '#e1ad76',
  mascotMuzzle: '#f1d2a8',
  mascotWater: '#55d6be',

  spinner1: '#6ec5b4',
  spinner2: '#7facff',
  spinner3: '#c490e4',
}

/** Tuned for light terminal backgrounds — darker foregrounds for contrast on white. */
export const LIGHT_THEME: Theme = {
  surface: '#f4faf8',
  surfaceSoft: '#e7f2ef',
  surfaceActive: '#d6ebe6',
  backgroundHint: '#dfefeb',

  border: '#b6ccc7',
  borderMuted: '#cddedb',
  borderActive: '#0f9e88',
  borderWarm: '#b5843f',

  textPrimary: '#0e2320',
  textSecondary: '#2b4642',
  textMuted: '#4f6b67',
  textDim: '#6d8884',

  brand: '#0f9e88',
  brandSoft: '#0c8571',
  brandStrong: '#0a7361',
  brandDim: '#14b39a',

  info: '#1b6fd6',
  warm: '#9a6c1f',
  success: '#1f9d4d',
  danger: '#c62f2f',
  user: '#2563c9',
  accent: '#7d3fb8',
  accentSoft: '#9a5fd0',

  mascotFur: '#a56d38',
  mascotFurSoft: '#c58a55',
  mascotMuzzle: '#c9a274',
  mascotWater: '#0f9e88',

  spinner1: '#0c8571',
  spinner2: '#2563c9',
  spinner3: '#7d3fb8',
}

/**
 * The active palette. Mutable-in-place so every `import { adnifyTheme }` consumer
 * reflects the resolved palette after {@link applyTheme} runs at startup (or on a
 * `:theme` switch), without any of them needing to re-import or subscribe.
 */
export const adnifyTheme: Theme = { ...DARK_THEME }

export type ThemeColor = Theme[keyof Theme]

/** Swap the active palette in place. Callers should trigger a re-render afterwards. */
export function applyTheme(mode: ThemeMode): void {
  Object.assign(adnifyTheme, mode === 'light' ? LIGHT_THEME : DARK_THEME)
}

/** Spinner frame sequences for smooth animated states. */
export const SPINNER_FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const,
  pulse: ['●', '◑', '◐', '○', '◐', '◑'] as const,
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'] as const,
  bounce: ['⠁', '⠂', '⠄', '⠂'] as const,
} as const
