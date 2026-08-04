export const adnifyTheme = {
  // Surfaces
  surface: '#1b222c',
  surfaceSoft: '#252e3b',
  surfaceActive: '#2f3a4a',
  backgroundHint: '#2b313d',

  // Borders
  border: '#4a5568',
  borderMuted: '#3d4658',
  borderActive: '#6ec5b4',
  borderWarm: '#d4a052',

  // Text
  textPrimary: '#f2f6fc',
  textSecondary: '#ced7e6',
  textMuted: '#9fadc4',
  textDim: '#77839a',

  // Brand palette
  brand: '#6ec5b4',
  brandSoft: '#8fdcc9',
  brandStrong: '#4dab95',
  brandDim: '#3a8475',

  // Semantic
  info: '#7facff',
  warm: '#ddb068',
  success: '#8ccb8c',
  danger: '#e58b8b',
  user: '#8eb4ff',
  accent: '#c490e4',
  accentSoft: '#d9b3ec',

  // Mascot
  mascotShell: '#8fdcc9',
  mascotVisor: '#1e2a35',
  mascotCore: '#5cae9a',

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
