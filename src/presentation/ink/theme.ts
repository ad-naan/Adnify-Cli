export const adnifyTheme = {
  // Surfaces
  surface: '#101a1d',
  surfaceSoft: '#17262a',
  surfaceActive: '#20363a',
  backgroundHint: '#1b2c30',

  // Borders
  border: '#385158',
  borderMuted: '#293e44',
  borderActive: '#55d6be',
  borderWarm: '#d6a76f',

  // Text
  textPrimary: '#edf7f5',
  textSecondary: '#c3d8d4',
  textMuted: '#88a7a4',
  textDim: '#627f7d',

  // Brand palette
  brand: '#55d6be',
  brandSoft: '#8ce8d6',
  brandStrong: '#2eb69d',
  brandDim: '#247e70',

  // Semantic
  info: '#79b8ff',
  warm: '#dfb477',
  success: '#8bd49c',
  danger: '#ef8f8f',
  user: '#9bc4ff',
  accent: '#c7a0e8',
  accentSoft: '#dec2f2',

  // Mascot
  mascotFur: '#c58a55',
  mascotFurSoft: '#e1ad76',
  mascotMuzzle: '#f1d2a8',
  mascotWater: '#55d6be',

  // Spinner colors for animated states
  spinner1: '#6ec5b4',
  spinner2: '#7facff',
  spinner3: '#c490e4',
} as const

export type ThemeColor = (typeof adnifyTheme)[keyof typeof adnifyTheme]

/** Spinner frame sequences for smooth animated states. */
export const SPINNER_FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const,
  pulse: ['●', '◑', '◐', '○', '◐', '◑'] as const,
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'] as const,
  bounce: ['⠁', '⠂', '⠄', '⠂'] as const,
} as const
