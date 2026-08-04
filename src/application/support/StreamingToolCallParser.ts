import { ADNIFY_TOOL_CALL_TAG, parseToolCallMarkup, type ToolCallMarkup } from './ToolCallMarkup'

// ── Types ─────────────────────────────────────────────────────────

export interface StreamingParseResult {
  /** Safe text that can be emitted immediately to the UI */
  text: string
  /** Set to true when the opening tag of a tool call has been detected */
  toolCallStarted: boolean
}

export interface StreamingFlushResult {
  /** Remaining text to emit (only if not a valid tool call) */
  text: string
  /** A successfully parsed tool call, if the buffer contained one */
  toolCall: ToolCallMarkup | null
}

// ── Constants ─────────────────────────────────────────────────────

/**
 * The opening tag prefix that signals a potential tool call.
 * Must match the beginning of: `<adnify_tool_call name="...">`
 */
const OPENING_TAG = `<${ADNIFY_TOOL_CALL_TAG}`

// ── Parser ────────────────────────────────────────────────────────

/**
 * Streaming tool-call markup parser.
 *
 * Wraps a real-time text stream from the LLM and separates it into:
 * - **Safe text** that can be rendered immediately
 * - **Tool call markup** that is detected early and suppressed from text
 *
 * Algorithm:
 * 1. When an incoming delta contains `<`, we hold back a suffix buffer
 *    that could be a prefix of `<adnify_tool_call`.
 * 2. On each push, we check whether the held buffer is still a valid
 *    prefix of the opening tag. If not, it's flushed as text.
 * 3. Once the opening tag is fully matched, we enter "tool call mode"
 *    and buffer everything until the closing tag `</adnify_tool_call>`.
 * 4. On flush (stream end), we attempt to parse the full markup. If it
 *    fails, the buffer is emitted as plain text.
 *
 * This gives the UX:
 * - Normal prose streams in real time
 * - Tool call markup is detected within ~20 chars of the first `<`
 * - No tool-call XML ever leaks to the UI as visible text
 */
export class StreamingToolCallParser {
  /** Accumulated buffer that hasn't been classified yet */
  private buffer = ''
  /** True once we're inside a tool call block (after opening tag) */
  private inToolCall = false
  /** Everything inside the tool call block (between opening and closing tags) */
  private toolCallBuffer = ''

  /**
   * Push a text delta from the LLM stream.
   *
   * Returns:
   * - `text`: characters that are safe to display right now
   * - `toolCallStarted`: becomes true the moment a tool call opening tag is detected
   */
  push(delta: string): StreamingParseResult {
    if (this.inToolCall) {
      this.toolCallBuffer += delta
      return { text: '', toolCallStarted: true }
    }

    this.buffer += delta

    // Check if buffer contains the opening tag
    const tagIndex = this.buffer.indexOf(OPENING_TAG)
    if (tagIndex !== -1) {
      // Everything before the tag is safe text
      const safeText = this.buffer.slice(0, tagIndex)
      this.toolCallBuffer = this.buffer.slice(tagIndex)
      this.buffer = ''
      this.inToolCall = true
      return { text: safeText, toolCallStarted: true }
    }

    // No opening tag found yet. But the buffer might end with a partial
    // prefix of OPENING_TAG (e.g., "<adn" so far). We need to hold back
    // the longest suffix that is a prefix of OPENING_TAG.
    const holdBack = this.longestOverlappingSuffix()

    if (holdBack === 0) {
      // No overlap — entire buffer is safe
      const text = this.buffer
      this.buffer = ''
      return { text, toolCallStarted: false }
    }

    // Hold back the potentially-starting tag, emit the rest
    const safeText = this.buffer.slice(0, this.buffer.length - holdBack)
    this.buffer = this.buffer.slice(this.buffer.length - holdBack)
    return { text: safeText, toolCallStarted: false }
  }

  /**
   * Flush the parser at stream end.
   *
   * If we were in tool-call mode, attempt to parse the full markup.
   * If parsing succeeds, return the tool call. If it fails (incomplete or
   * malformed), return the raw buffer as text so nothing is lost.
   *
   * If we were NOT in tool-call mode, flush the held buffer as text.
   */
  flush(): StreamingFlushResult {
    if (this.inToolCall) {
      const toolCall = parseToolCallMarkup(this.toolCallBuffer)
      if (toolCall) {
        return { text: '', toolCall }
      }
      // Malformed tool call — emit as text so the user sees what happened
      return { text: this.toolCallBuffer, toolCall: null }
    }

    const text = this.buffer
    this.buffer = ''
    return { text, toolCall: null }
  }

  /** Reset the parser to its initial state (for reuse). */
  reset(): void {
    this.buffer = ''
    this.inToolCall = false
    this.toolCallBuffer = ''
  }

  /**
   * Compute the length of the longest suffix of `this.buffer` that is
   * also a prefix of OPENING_TAG.
   *
   * Example: buffer = "Hello <adn"
   * OPENING_TAG = "<adnify_tool_call"
   * Suffix "<adn" matches prefix "<adn" → returns 4.
   *
   * This tells us how many characters to hold back.
   */
  private longestOverlappingSuffix(): number {
    const maxLen = Math.min(this.buffer.length, OPENING_TAG.length)

    for (let len = maxLen; len >= 1; len--) {
      const suffix = this.buffer.slice(this.buffer.length - len)
      if (OPENING_TAG.startsWith(suffix)) {
        // Make sure suffix starts with '<' or the hold is pointless
        // (we only care about potential tag starts)
        if (suffix.includes('<')) {
          return len
        }
      }
    }

    return 0
  }
}
