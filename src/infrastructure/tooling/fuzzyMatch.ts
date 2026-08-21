/**
 * 容错匹配：当 file-ops update/patch 的 oldText 精确匹配 0 命中时的回退定位。
 *
 * 编码 agent 最高频的失败模式就是 oldText 与文件仅有「无语义差异」——尾随空格、
 * CRLF、缩进宽度对不上——导致精确匹配失败后反复重试烧 token。这里在**不牺牲
 * 唯一性保护**的前提下容忍这些差异:找到唯一的容错命中才应用,命中多处则判为
 * 歧义、拒绝猜测。
 *
 * 返回的是原始内容中的**字符区间**,替换时对原文切片,因此文件里真实的空白被保留。
 */
export type TolerantStrategy = 'trailing-whitespace' | 'indentation'

export interface TolerantMatch {
  /** 原始内容中的起始字符偏移 */
  start: number
  /** 原始内容中的结束字符偏移(不含) */
  end: number
}

export interface TolerantMatchResult {
  matches: TolerantMatch[]
  /** 命中所用策略;无命中为 null */
  strategy: TolerantStrategy | null
}

interface LineSpan {
  text: string
  start: number
  end: number
}

/** 按 \n 切分并保留每行在原文中的字符区间(end 不含换行符本身)。 */
function splitLineSpans(content: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  for (let i = 0; i <= content.length; i += 1) {
    if (i === content.length || content[i] === '\n') {
      spans.push({ text: content.slice(start, i), start, end: i })
      start = i + 1
    }
  }
  return spans
}

/** 去掉 oldText 末尾因换行产生的空串行,使 "foo\n" 视作单行块。 */
function oldTextLines(oldText: string): string[] {
  const lines = oldText.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)
const normalizeTrailing = (line: string): string => stripCr(line).replace(/[ \t]+$/, '')
const normalizeTrim = (line: string): string => stripCr(line).trim()

function matchByLines(
  spans: LineSpan[],
  oldLines: string[],
  normalize: (line: string) => string,
): TolerantMatch[] {
  const windowLen = oldLines.length
  if (windowLen === 0 || windowLen > spans.length) {
    return []
  }

  const normOld = oldLines.map(normalize)
  const matches: TolerantMatch[] = []

  for (let i = 0; i + windowLen <= spans.length; i += 1) {
    let ok = true
    for (let j = 0; j < windowLen; j += 1) {
      if (normalize(spans[i + j].text) !== normOld[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      matches.push({ start: spans[i].start, end: spans[i + windowLen - 1].end })
    }
  }

  return matches
}

/**
 * 依次尝试:行尾空白容错 → 整行 trim(缩进容错)。取第一个有命中的策略。
 */
export function findTolerantMatch(content: string, oldText: string): TolerantMatchResult {
  const spans = splitLineSpans(content)
  const oldLines = oldTextLines(oldText)

  // 全空白的 oldText 不适合做容错锚点,直接放弃。
  if (oldLines.every((line) => normalizeTrim(line) === '')) {
    return { matches: [], strategy: null }
  }

  const ladder: Array<{ strategy: TolerantStrategy; normalize: (line: string) => string }> = [
    { strategy: 'trailing-whitespace', normalize: normalizeTrailing },
    { strategy: 'indentation', normalize: normalizeTrim },
  ]

  for (const { strategy, normalize } of ladder) {
    const matches = matchByLines(spans, oldLines, normalize)
    if (matches.length > 0) {
      return { matches, strategy }
    }
  }

  return { matches: [], strategy: null }
}

/** 一段文本里所有非空行的公共前导空白。 */
function commonLeadingIndent(text: string): string {
  let common: string | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const indent = line.slice(0, line.length - line.trimStart().length)
    if (common === null) {
      common = indent
    } else {
      let k = 0
      while (k < common.length && k < indent.length && common[k] === indent[k]) k += 1
      common = common.slice(0, k)
    }
  }
  return common ?? ''
}

/**
 * 把 newText 从 oldText 的基准缩进重排到匹配块的真实缩进。
 *
 * 缩进策略命中意味着模型记错了缩进,它的 newText 通常与其 oldText 用同一(错误)
 * 基准。将差量施加到 newText 的每一非空行,避免把错误缩进写回文件。空行保持原样。
 */
export function reindentReplacement(newText: string, oldText: string, matchedText: string): string {
  const oldBase = commonLeadingIndent(oldText)
  const matchedBase = commonLeadingIndent(matchedText)
  if (oldBase === matchedBase) {
    return newText
  }

  return newText
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line
      const withoutOldBase = line.startsWith(oldBase) ? line.slice(oldBase.length) : line
      return matchedBase + withoutOldBase
    })
    .join('\n')
}
