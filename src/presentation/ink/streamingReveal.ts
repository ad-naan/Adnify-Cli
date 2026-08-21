/**
 * Smooth streaming reveal, ported from oh-my-pi's paced typewriter.
 *
 * The network delivers assistant text in bursts of wildly varying size. Rendering
 * each burst as it lands looks chunky. Instead we keep a growing `target` and reveal
 * it toward the viewer at a steady per-frame cadence, so text flows in smoothly no
 * matter how the bytes actually arrived.
 */

/** ~30 fps. Matches oh-my-pi's STREAMING_REVEAL_FRAME_MS. */
export const REVEAL_FRAME_MS = Math.round(1000 / 30)
/** Reveal at least this many code points per frame, so short text still animates. */
export const REVEAL_MIN_STEP = 3
/** Drain any backlog over roughly this many frames, so bursts catch up quickly. */
export const REVEAL_CATCHUP_FRAMES = 8

/**
 * How many units to advance the reveal cursor this frame given the unrevealed
 * backlog. A floor keeps short messages animating; the proportional term lets a
 * large backlog (a big burst, or resuming after a stall) catch up within a handful
 * of frames rather than crawling.
 */
export function nextRevealStep(backlog: number): number {
  return Math.max(REVEAL_MIN_STEP, Math.ceil(Math.max(0, backlog) / REVEAL_CATCHUP_FRAMES))
}

/** Total number of code points in `text` (surrogate-pair aware, unlike `.length`). */
export function codePointLength(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/**
 * The first `count` code points of `text`. Slicing on code-point boundaries avoids
 * tearing a surrogate pair (emoji) in half mid-reveal, which would flash a � glyph.
 */
export function revealPrefix(text: string, count: number): string {
  if (count <= 0) return ''
  let taken = 0
  let end = 0
  for (const char of text) {
    if (taken >= count) break
    end += char.length
    taken += 1
  }
  return end >= text.length ? text : text.slice(0, end)
}
