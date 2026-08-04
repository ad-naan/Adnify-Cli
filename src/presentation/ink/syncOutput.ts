/**
 * Terminal Synchronized Output (DEC mode 2026).
 *
 * Wraps stdout writes so that Ink's full-screen rewrites are bracketed with
 * the begin/end synchronized-update escape sequences. The terminal buffers
 * the entire frame internally and paints it atomically, eliminating flicker
 * and jitter.
 *
 * Reference: https://github.com/vadimdemedes/ink/discussions/715
 */

const SYNC_BEGIN = '\x1b[?2026h'
const SYNC_END = '\x1b[?2026l'

/** Ink's clearScreen escape — full-screen rewrite signature. */
const CLEAR_TERMINAL = '\x1b[2J\x1b[3J\x1b[H'

function isTmux(): boolean {
  return Boolean(process.env.TMUX)
}

function wrapWithTmuxPassthrough(sequence: string): string {
  // In tmux, each literal ESC inside the passthrough must be doubled.
  return `\x1bPtmux;\x1b${sequence.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`
}

/**
 * Patches `stdout.write` to batch full-screen rewrites under synchronized output.
 * Call this BEFORE `render()` so the proxy is in place when Ink starts painting.
 */
export function installSynchronizedOutput(stdout: NodeJS.WriteStream): void {
  const originalWrite = stdout.write.bind(stdout) as (
    chunk: string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => boolean

  const tmux = isTmux()
  const beginSeq = tmux ? wrapWithTmuxPassthrough(SYNC_BEGIN) : SYNC_BEGIN
  const endSeq = tmux ? wrapWithTmuxPassthrough(SYNC_END) : SYNC_END

  stdout.write = ((
    chunk: unknown,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    const text = typeof chunk === 'string' ? chunk : String(chunk)

    if (typeof encodingOrCb === 'function') {
      cb = encodingOrCb as (err?: Error | null) => void
      encodingOrCb = undefined
    }

    if (text.includes(CLEAR_TERMINAL)) {
      const wrapped = beginSeq + text + endSeq
      if (cb) return originalWrite(wrapped, cb)
      return originalWrite(wrapped)
    }

    if (cb) return originalWrite(text, cb)
    return originalWrite(text)
  }) as typeof stdout.write
}
