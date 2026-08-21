import type { ThemeMode } from '../../application/dto/UiPreferences'

/**
 * Derive a stable, contrast-safe accent color for a session.
 *
 * Each session gets its own signature hue so the eye can tell sessions apart at a
 * glance. The hue is a deterministic hash of the session id; the lightness/saturation
 * band is chosen per theme mode so the color stays legible against the terminal
 * background (brighter on dark, deeper on light).
 */
export function sessionAccentColor(sessionId: string, mode: ThemeMode): string {
  const hue = hashHue(sessionId)
  // Deeper + less saturated reads better on a light background; brighter on dark.
  const { saturation, lightness } = mode === 'light' ? { saturation: 62, lightness: 40 } : { saturation: 68, lightness: 63 }
  return hslToHex(hue, saturation, lightness)
}

/** djb2 hash folded onto the 0–359 hue wheel. Stable across runs. */
function hashHue(input: string): number {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % 360
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const huePrime = hue / 60
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1))
  const match = l - chroma / 2

  let r = 0
  let g = 0
  let b = 0
  if (huePrime >= 0 && huePrime < 1) [r, g, b] = [chroma, secondary, 0]
  else if (huePrime < 2) [r, g, b] = [secondary, chroma, 0]
  else if (huePrime < 3) [r, g, b] = [0, chroma, secondary]
  else if (huePrime < 4) [r, g, b] = [0, secondary, chroma]
  else if (huePrime < 5) [r, g, b] = [secondary, 0, chroma]
  else [r, g, b] = [chroma, 0, secondary]

  const toHex = (channel: number): string =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
