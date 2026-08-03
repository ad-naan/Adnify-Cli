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
  'remote',
  'tag',
  'ls-files',
  'blame',
  'shortlog',
  'describe',
])

const CAREFUL_GIT_SUBCOMMANDS = new Set([
  'add',
  'commit',
  'stash',
  'checkout',
  'reset',
  'restore',
])

/** `bun <sub>` 中允许的子命令；跑测试/构建会改动产物，所以按 careful 处理。 */
const ALLOWED_BUN_SUBCOMMANDS = new Set(['test', 'run', 'x'])

/** `bun run <script>` 只放行项目验证脚本，避免变成任意脚本执行入口。 */
const ALLOWED_BUN_SCRIPTS = new Set([
  'build',
  'typecheck',
  'test',
  'lint',
  'check',
  'dev',
  'start',
])

/** `bunx <bin>` 允许的验证类二进制。 */
const ALLOWED_BUNX_BINARIES = new Set(['tsc', 'eslint', 'prettier', 'vitest'])

/** `npx` 允许的验证类包。 */
const ALLOWED_NPX_PACKAGES = new Set([
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
])

/** `npm run` 允许的脚本名。 */
const ALLOWED_NPM_SCRIPTS = new Set([
  'build',
  'test',
  'lint',
  'typecheck',
  'dev',
  'start',
])

/**
 * 判定一条命令是否允许执行，并给出风险级别。
 * 只读检索类为 safe，可直接放行；会跑构建/测试的命令为 careful，需要用户审批。
 * 会修改 git 状态的命令（add/commit/stash）也为 careful。
 */
export function classifyShellCommand(argv: string[]): ShellCommandClassification {
  const command = argv[0]?.toLowerCase()
  if (!command) {
    return { ok: false, reason: 'Missing command name.' }
  }

  const summary = argv.join(' ')

  if (command === 'rg' || command === 'grep' || command === 'find') {
    return { ok: true, riskLevel: 'safe', summary }
  }

  if (command === 'cat' || command === 'head' || command === 'tail' || command === 'wc' || command === 'sort' || command === 'uniq') {
    return { ok: true, riskLevel: 'safe', summary }
  }

  if (command === 'node' && argv[1] === '--version') {
    return { ok: true, riskLevel: 'safe', summary }
  }

  if (command === 'git') {
    return classifyGitCommand(argv, summary)
  }

  if (command === 'bun' || command === 'bunx') {
    return classifyBunCommand(command, argv, summary)
  }

  if (command === 'npm' || command === 'pnpm' || command === 'yarn') {
    return classifyNpmLikeCommand(command, argv, summary)
  }

  if (command === 'npx') {
    return classifyNpxCommand(argv, summary)
  }

  if (command === 'tsc') {
    return { ok: true, riskLevel: 'careful', summary }
  }

  return {
    ok: false,
    reason:
      'Command is not allowed. Supported: rg/grep/find, cat/head/tail/wc, git (read-only + add/commit/stash/checkout/reset/restore with approval), bun test/run/x, npm/pnpm/yarn run <script>, npx <pkg>, tsc.',
  }
}

function classifyGitCommand(
  argv: string[],
  summary: string,
): ShellCommandClassification {
  const subcommand = argv[1]?.toLowerCase()
  if (!subcommand) {
    return { ok: false, reason: 'Missing git subcommand.' }
  }

  if (READONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, riskLevel: 'safe', summary }
  }

  if (subcommand === 'stash') {
    // git stash list → safe; git stash push/drop/pop → careful
    const action = argv[2]?.toLowerCase()
    if (!action || action === 'list') {
      return { ok: true, riskLevel: 'safe', summary }
    }
    return { ok: true, riskLevel: 'careful', summary }
  }

  if (CAREFUL_GIT_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, riskLevel: 'careful', summary }
  }

  return {
    ok: false,
    reason: `git ${subcommand} is not allowed. Read-only: ${[...READONLY_GIT_SUBCOMMANDS].join(', ')}. With approval: ${[...CAREFUL_GIT_SUBCOMMANDS].join(', ')}.`,
  }
}

function classifyBunCommand(
  command: string,
  argv: string[],
  summary: string,
): ShellCommandClassification {
  if (command === 'bunx' || argv[1]?.toLowerCase() === 'x') {
    const binary = (command === 'bunx' ? argv[1] : argv[2])?.toLowerCase()
    if (!binary || !ALLOWED_BUNX_BINARIES.has(binary)) {
      return { ok: false, reason: `bunx ${binary ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_BUNX_BINARIES].join(', ')}.` }
    }

    return { ok: true, riskLevel: 'careful', summary }
  }

  const subcommand = argv[1]?.toLowerCase()
  if (!subcommand || !ALLOWED_BUN_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      reason: `bun ${subcommand ?? '(missing)'} is not allowed. Allowed subcommands: ${[...ALLOWED_BUN_SUBCOMMANDS].join(', ')}.`,
    }
  }

  if (subcommand === 'run') {
    const script = argv[2]?.toLowerCase()
    if (!script || !ALLOWED_BUN_SCRIPTS.has(script)) {
      return {
        ok: false,
        reason: `bun run ${script ?? '(missing)'} is not allowed. Allowed scripts: ${[...ALLOWED_BUN_SCRIPTS].join(', ')}.`,
      }
    }
  }

  return { ok: true, riskLevel: 'careful', summary }
}

function classifyNpmLikeCommand(
  command: string,
  argv: string[],
  summary: string,
): ShellCommandClassification {
  const subcommand = argv[1]?.toLowerCase()

  // npm/pnpm/yarn install / ci → careful (modifies node_modules)
  if (subcommand === 'install' || subcommand === 'ci' || subcommand === 'i' || subcommand === 'add') {
    return { ok: true, riskLevel: 'careful', summary }
  }

  // npm run <script>
  if (subcommand === 'run' || subcommand === 'run-script') {
    const script = argv[2]?.toLowerCase()
    if (!script || !ALLOWED_NPM_SCRIPTS.has(script)) {
      return { ok: false, reason: `${command} run ${script ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPM_SCRIPTS].join(', ')}.` }
    }
    return { ok: true, riskLevel: 'careful', summary }
  }

  // npm test / npm exec
  if (subcommand === 'test' || subcommand === 't') {
    return { ok: true, riskLevel: 'careful', summary }
  }

  if (subcommand === 'exec') {
    const pkg = argv[2]?.toLowerCase()
    if (!pkg || !ALLOWED_NPX_PACKAGES.has(pkg)) {
      return { ok: false, reason: `${command} exec ${pkg ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPX_PACKAGES].join(', ')}.` }
    }
    return { ok: true, riskLevel: 'careful', summary }
  }

  // yarn without subcommand (yarn <script> shorthand)
  if (!subcommand) {
    return { ok: false, reason: `Missing ${command} subcommand.` }
  }

  if (ALLOWED_NPM_SCRIPTS.has(subcommand)) {
    return { ok: true, riskLevel: 'careful', summary }
  }

  return { ok: false, reason: `${command} ${subcommand} is not allowed.` }
}

function classifyNpxCommand(
  argv: string[],
  summary: string,
): ShellCommandClassification {
  const pkg = argv[1]?.toLowerCase()?.replace(/^@[^/]+\//, '')
  if (!pkg || !ALLOWED_NPX_PACKAGES.has(pkg)) {
    return { ok: false, reason: `npx ${pkg ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPX_PACKAGES].join(', ')}.` }
  }
  return { ok: true, riskLevel: 'careful', summary }
}
