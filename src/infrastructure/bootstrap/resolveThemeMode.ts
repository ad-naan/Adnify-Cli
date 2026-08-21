import type { ThemeAppearance, ThemeMode } from '../../application/dto/UiPreferences'

/**
 * Resolve a light/dark preference into the concrete palette to use.
 *
 * `system` (the default) reads the terminal's own background via the widely-supported
 * `COLORFGBG` environment variable. Its last field is the ANSI background color index:
 * 0–6 and 8 are dark backgrounds, 7 and 9–15 are light. When the terminal does not
 * report `COLORFGBG` we cannot tell, so we fall back to dark — the historical default.
 *
 * `light` / `dark` force a palette regardless of the terminal.
 */
export function normalizeThemeAppearance(input?: string | null): ThemeAppearance {
  switch (input?.trim().toLowerCase()) {
    case 'light':
      return 'light'
    case 'dark':
      return 'dark'
    case 'system':
    case 'auto':
      return 'system'
    default:
      return 'system'
  }
}

/** Classify a `COLORFGBG` value's background field. Returns null when undetectable. */
export function detectTerminalTheme(
  env: Record<string, string | undefined> = process.env,
): ThemeMode | null {
  const raw = env.COLORFGBG?.trim()
  if (!raw) return null

  // Format is "fg;bg" or "fg;default;bg". The background is the last segment.
  const parts = raw.split(';')
  const background = parts[parts.length - 1]?.trim()
  if (background === undefined || background === '') return null

  const index = Number.parseInt(background, 10)
  if (!Number.isFinite(index)) return null

  // ANSI palette: 7 (light gray) and 9–15 (bright) are light backgrounds; 0–6 and 8 are dark.
  return index === 7 || index >= 9 ? 'light' : 'dark'
}

/**
 * Resolve the palette to apply at startup. Explicit env / persisted `light`|`dark`
 * always win; `system` (or unset) auto-detects from the terminal and defaults to dark.
 */
export function resolveThemeMode(
  env: Record<string, string | undefined> = process.env,
  persistedAppearance?: string | null,
): ThemeMode {
  const appearance = normalizeThemeAppearance(env.ADNIFY_THEME ?? persistedAppearance)
  if (appearance === 'light' || appearance === 'dark') return appearance
  return detectTerminalTheme(env) ?? 'dark'
}
