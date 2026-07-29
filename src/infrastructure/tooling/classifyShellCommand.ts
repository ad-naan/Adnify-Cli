import type { ToolRiskLevel } from '../../domain/tooling/value-objects/ToolApproval'

export type ShellCommandClassification =
  | { ok: true; riskLevel: ToolRiskLevel; summary: string }
  | { ok: false; reason: string }

const READONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'rev-parse',
])

/** `bun <sub>` 中允许的子命令；跑测试/构建会改动产物，所以按 careful 处理。 */
const ALLOWED_BUN_SUBCOMMANDS = new Set(['test', 'run', 'x'])

/** `bun run <script>` 只放行项目验证脚本，避免变成任意脚本执行入口。 */
const ALLOWED_BUN_SCRIPTS = new Set(['build', 'typecheck', 'test', 'lint'])

/** `bunx <bin>` 只放行类型检查器。 */
const ALLOWED_BUNX_BINARIES = new Set(['tsc'])

/**
 * 判定一条命令是否允许执行，并给出风险级别。
 * 只读检索类为 safe，可直接放行；会跑构建/测试的命令为 careful，需要用户审批。
 */
export function classifyShellCommand(argv: string[]): ShellCommandClassification {
  const command = argv[0]?.toLowerCase()
  if (!command) {
    return { ok: false, reason: 'Missing command name.' }
  }

  const summary = argv.join(' ')

  if (command === 'rg') {
    return { ok: true, riskLevel: 'safe', summary }
  }

  if (command === 'git') {
    const subcommand = argv[1]?.toLowerCase()
    if (!subcommand || !READONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return {
        ok: false,
        reason:
          'Only read-only git commands are allowed: status, diff, log, show, branch, rev-parse.',
      }
    }

    return { ok: true, riskLevel: 'safe', summary }
  }

  if (command === 'bun' || command === 'bunx') {
    return classifyBunCommand(command, argv, summary)
  }

  return {
    ok: false,
    reason:
      'Command is not allowed in this build. Supported: rg, git status/diff/log/show/branch/rev-parse, bun test, bun run build/typecheck/test/lint, bunx tsc.',
  }
}

function classifyBunCommand(
  command: string,
  argv: string[],
  summary: string,
): ShellCommandClassification {
  // `bunx tsc` 与 `bun x tsc` 是同一件事，统一取二进制名判断。
  if (command === 'bunx' || argv[1]?.toLowerCase() === 'x') {
    const binary = (command === 'bunx' ? argv[1] : argv[2])?.toLowerCase()
    if (!binary || !ALLOWED_BUNX_BINARIES.has(binary)) {
      return { ok: false, reason: 'Only "bunx tsc" is allowed in this build.' }
    }

    return { ok: true, riskLevel: 'careful', summary }
  }

  const subcommand = argv[1]?.toLowerCase()
  if (!subcommand || !ALLOWED_BUN_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      reason: 'Only "bun test" and "bun run build/typecheck/test/lint" are allowed in this build.',
    }
  }

  if (subcommand === 'run') {
    const script = argv[2]?.toLowerCase()
    if (!script || !ALLOWED_BUN_SCRIPTS.has(script)) {
      return {
        ok: false,
        reason: 'Only these bun scripts are allowed: build, typecheck, test, lint.',
      }
    }
  }

  return { ok: true, riskLevel: 'careful', summary }
}
