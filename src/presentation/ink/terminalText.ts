const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/** Removes terminal control sequences before measuring rendered content. */
export function stripTerminalAnsi(content: string): string {
  return content.replace(ANSI_ESCAPE_PATTERN, '')
}

export function terminalCharacterWidth(character: string): number {
  if (character === '\t') return 2

  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return 0
  if (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return 0
  }

  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  ) {
    return 2
  }

  return 1
}

export function terminalTextWidth(content: string): number {
  return Array.from(stripTerminalAnsi(content)).reduce(
    (width, character) => width + terminalCharacterWidth(character),
    0,
  )
}

export interface InputWindow {
  text: string
  cursorColumn: number
  beforeCursor: string
  cursorCharacter: string
  afterCursor: string
}

/** Keeps a one-line editor window centered around the logical cursor. */
export function resolveInputWindow(value: string, cursor: number, width: number): InputWindow {
  const characters = Array.from(value.replace(/[\r\n]+/g, ' '))
  const safeCursor = Math.max(0, Math.min(cursor, characters.length))
  const safeWidth = Math.max(4, width)
  let start = 0

  while (terminalTextWidth(characters.slice(start, safeCursor).join('')) > safeWidth - 2) {
    start += 1
  }

  const leading = start > 0 ? '…' : ''
  let end = start
  let renderedWidth = terminalTextWidth(leading)
  while (end < characters.length) {
    const characterWidth = terminalCharacterWidth(characters[end] ?? '')
    if (renderedWidth + characterWidth > safeWidth - 1) break
    renderedWidth += characterWidth
    end += 1
  }

  const trailing = end < characters.length ? '…' : ''
  const visible = characters.slice(start, end).join('')
  const beforeCursor = `${leading}${characters.slice(start, safeCursor).join('')}`
  const cursorCharacter = safeCursor < end ? characters[safeCursor] ?? ' ' : ' '
  const afterCursor = `${characters.slice(Math.min(safeCursor + 1, end), end).join('')}${trailing}`
  return {
    text: `${leading}${visible}${trailing}`,
    cursorColumn: terminalTextWidth(beforeCursor),
    beforeCursor,
    cursorCharacter,
    afterCursor,
  }
}
