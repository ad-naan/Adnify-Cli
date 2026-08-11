import { describe, expect, it } from 'bun:test'
import { classifyFileOpsRisk, requiresApproval, resolveToolAuthorization } from './ToolApprovalPolicy'
import type { ToolActionIntent } from '../value-objects/ToolApproval'
import { isApprovedDecision } from '../value-objects/ToolApproval'

function createIntent(overrides: Partial<ToolActionIntent> = {}): ToolActionIntent {
  return {
    toolId: 'file-ops',
    riskLevel: 'careful',
    summary: 'write src/a.ts',
    ...overrides,
  }
}

describe('ToolApprovalPolicy', () => {
  it('lets safe intents through without asking', () => {
    expect(requiresApproval(createIntent({ riskLevel: 'safe' }))).toBe(false)
  })

  it('requires approval for careful and dangerous intents', () => {
    expect(requiresApproval(createIntent({ riskLevel: 'careful' }))).toBe(true)
    expect(requiresApproval(createIntent({ riskLevel: 'dangerous' }))).toBe(true)
  })

  it('treats file-ops read and list as safe', () => {
    expect(classifyFileOpsRisk('read')).toBe('safe')
    expect(classifyFileOpsRisk('list')).toBe('safe')
  })

  it('treats write-like file-ops actions as careful', () => {
    expect(classifyFileOpsRisk('write')).toBe('careful')
    expect(classifyFileOpsRisk('update')).toBe('careful')
    expect(classifyFileOpsRisk('patch')).toBe('careful')
  })

  it('treats unknown file-ops actions as careful so new actions cannot skip approval', () => {
    expect(classifyFileOpsRisk('delete')).toBe('careful')
  })

  it('auto-runs workspace edits and verification in workspace mode', () => {
    expect(resolveToolAuthorization(createIntent({ kind: 'write', mutates: true }), 'workspace')).toBe('allow')
    expect(resolveToolAuthorization(createIntent({ toolId: 'shell-runner', kind: 'verification' }), 'workspace')).toBe('allow')
  })

  it('still asks for protected, outside, and dangerous operations', () => {
    expect(resolveToolAuthorization(createIntent({ scope: 'protected', kind: 'write' }), 'auto')).toBe('ask')
    expect(resolveToolAuthorization(createIntent({ scope: 'outside', kind: 'read', riskLevel: 'safe' }), 'auto')).toBe('ask')
    expect(resolveToolAuthorization(createIntent({ riskLevel: 'dangerous' }), 'auto')).toBe('ask')
  })

  it('blocks mutations in plan mode', () => {
    expect(resolveToolAuthorization(createIntent({ kind: 'write', mutates: true }), 'plan')).toBe('deny')
    expect(resolveToolAuthorization(createIntent({ kind: 'read', mutates: false, riskLevel: 'safe' }), 'plan')).toBe('allow')
  })
})

describe('isApprovedDecision', () => {
  it('accepts both one-off and session-wide approvals', () => {
    expect(isApprovedDecision('approved')).toBe(true)
    expect(isApprovedDecision('always-approved')).toBe(true)
    expect(isApprovedDecision('denied')).toBe(false)
  })
})
