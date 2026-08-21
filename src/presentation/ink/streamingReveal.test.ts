import { describe, expect, test } from 'bun:test'
import {
  codePointLength,
  nextRevealStep,
  revealPrefix,
  REVEAL_MIN_STEP,
} from './streamingReveal'

describe('nextRevealStep', () => {
  test('never advances less than the floor', () => {
    expect(nextRevealStep(0)).toBe(REVEAL_MIN_STEP)
    expect(nextRevealStep(1)).toBe(REVEAL_MIN_STEP)
    expect(nextRevealStep(-5)).toBe(REVEAL_MIN_STEP)
  })

  test('catches up proportionally on a large backlog', () => {
    expect(nextRevealStep(80)).toBe(10)
    expect(nextRevealStep(800)).toBe(100)
  })
})

describe('codePointLength', () => {
  test('counts ASCII and CJK by character', () => {
    expect(codePointLength('abc')).toBe(3)
    expect(codePointLength('你好')).toBe(2)
  })

  test('counts an emoji surrogate pair as one', () => {
    expect(codePointLength('a🎉')).toBe(2)
  })
})

describe('revealPrefix', () => {
  test('returns a growing prefix', () => {
    expect(revealPrefix('hello', 0)).toBe('')
    expect(revealPrefix('hello', 3)).toBe('hel')
    expect(revealPrefix('hello', 99)).toBe('hello')
  })

  test('never splits a surrogate pair', () => {
    expect(revealPrefix('a🎉b', 2)).toBe('a🎉')
    expect(revealPrefix('🎉', 1)).toBe('🎉')
  })

  test('slices CJK cleanly', () => {
    expect(revealPrefix('你好世界', 2)).toBe('你好')
  })
})
