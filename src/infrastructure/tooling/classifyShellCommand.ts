import type { ToolRiskLevel } from '../../domain/tooling/value-objects/ToolApproval'

export type ShellCommandClassification =
  | { ok: true; riskLevel: ToolRiskLevel; summary: string; effect: ShellCommandEffect }
  | { ok: false; reason: string }

/**
 * 判定命令为何是这个风险级别 —— 面向用户，不面向模型。
 * 光有 careful 标签说明不了「批准之后会发生什么」，用户没有依据做决定；
 * 这里给出具体后果（改哪些文件、动不动 git 历史、联不联网）。
 */
export interface ShellCommandEffect {
  /** 这条命令会做什么，一句话。 */
  action: string
  /** 会被改动的东西；只读命令为空数组。 */
  writes: string[]
  /** 需要用户特别注意的点，例如不可逆、会联网。 */
  cautions: string[]
}

const READ_ONLY: ShellCommandEffect = { action: '', writes: [], cautions: [] }

function readOnly(action: string): ShellCommandEffect {
  return { ...READ_ONLY, action }
}

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
    return { ok: true, riskLevel: 'safe', summary, effect: readOnly('Search files') }
  }

  if (command === 'cat' || command === 'head' || command === 'tail' || command === 'wc' || command === 'sort' || command === 'uniq') {
    return { ok: true, riskLevel: 'safe', summary, effect: readOnly('Read file contents') }
  }

  if (command === 'node' && argv[1] === '--version') {
    return { ok: true, riskLevel: 'safe', summary, effect: readOnly('Print the Node version') }
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
    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: 'Run the TypeScript compiler',
        writes: ['Emitted .js/.d.ts output, unless --noEmit is passed'],
        cautions: [],
      },
    }
  }

  return {
    ok: false,
    reason:
      'Command is not allowed. Supported: rg/grep/find, cat/head/tail/wc, git (read-only + add/commit/stash/checkout/reset/restore with approval), bun test/run/x, npm/pnpm/yarn run <script>, npx <pkg>, tsc.',
  }
}

/**
 * 把 effect 渲染成审批面板里的预览文本。
 * 只读命令返回空串 —— 它们本来就不触发审批，硬塞一段说明只会稀释真正需要注意的那几条。
 */
export function formatShellCommandEffect(effect: ShellCommandEffect): string {
  if (effect.writes.length === 0 && effect.cautions.length === 0) {
    return ''
  }

  const lines: string[] = []

  if (effect.action) {
    lines.push(effect.action)
  }

  if (effect.writes.length > 0) {
    lines.push('', 'Modifies:')
    lines.push(...effect.writes.map((entry) => `  - ${entry}`))
  }

  if (effect.cautions.length > 0) {
    lines.push('', 'Note:')
    lines.push(...effect.cautions.map((entry) => `  ! ${entry}`))
  }

  return lines.join('\n')
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
    return {
      ok: true,
      riskLevel: 'safe',
      summary,
      effect: readOnly(`Inspect repository state (git ${subcommand})`),
    }
  }

  if (subcommand === 'stash') {
    // git stash list → safe; git stash push/drop/pop → careful
    const action = argv[2]?.toLowerCase()
    if (!action || action === 'list') {
      return { ok: true, riskLevel: 'safe', summary, effect: readOnly('List stash entries') }
    }
    return { ok: true, riskLevel: 'careful', summary, effect: describeGitEffect('stash', argv) }
  }

  if (CAREFUL_GIT_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, riskLevel: 'careful', summary, effect: describeGitEffect(subcommand, argv) }
  }

  return {
    ok: false,
    reason: `git ${subcommand} is not allowed. Read-only: ${[...READONLY_GIT_SUBCOMMANDS].join(', ')}. With approval: ${[...CAREFUL_GIT_SUBCOMMANDS].join(', ')}.`,
  }
}

/**
 * 把 git 子命令翻译成「批准之后会发生什么」。
 * 重点是标出不可逆的那几个：reset --hard / checkout / restore 会直接丢掉未提交的改动，
 * 而它们和 git add 在面板上都只是一个 careful 标签，用户区分不出来。
 */
function describeGitEffect(subcommand: string, argv: string[]): ShellCommandEffect {
  const flags = argv.slice(2).map((arg) => arg.toLowerCase())
  const hasFlag = (flag: string): boolean => flags.includes(flag)

  switch (subcommand) {
    case 'add':
      return { action: 'Stage changes for commit', writes: ['The git index'], cautions: [] }
    case 'commit':
      return {
        action: 'Record a new commit',
        writes: ['Branch history'],
        cautions: hasFlag('--amend')
          ? ['--amend rewrites the previous commit instead of adding one']
          : [],
      }
    case 'stash':
      return {
        action: 'Move working-tree changes onto the stash',
        writes: ['The working tree', 'The stash list'],
        cautions: hasFlag('drop') || hasFlag('clear')
          ? ['Dropped stash entries are not recoverable through git']
          : [],
      }
    case 'reset':
      return {
        action: 'Move the branch pointer',
        writes: hasFlag('--hard') ? ['Branch pointer', 'The working tree'] : ['Branch pointer', 'The git index'],
        cautions: hasFlag('--hard')
          ? ['--hard discards all uncommitted changes; they cannot be recovered']
          : [],
      }
    case 'checkout':
    case 'restore':
      return {
        action: subcommand === 'checkout' ? 'Switch branches or restore files' : 'Restore files from another revision',
        writes: ['The working tree'],
        cautions: ['Uncommitted changes to the affected files are overwritten'],
      }
    default:
      return { action: `Run git ${subcommand}`, writes: ['The repository'], cautions: [] }
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

    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: `Run ${binary}`,
        writes: binary === 'prettier' || binary === 'eslint'
          ? ['Source files, if --write/--fix is passed']
          : ['Compiler or test output'],
        cautions: ['Downloads the package if it is not already cached'],
      },
    }
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

  return {
    ok: true,
    riskLevel: 'careful',
    summary,
    effect: {
      action: subcommand === 'test' ? 'Run the test suite' : `Run the "${argv[2] ?? subcommand}" script`,
      writes: ['Whatever the script itself writes (build output, caches)'],
      cautions: ['Executes project-defined code from package.json'],
    },
  }
}

function classifyNpmLikeCommand(
  command: string,
  argv: string[],
  summary: string,
): ShellCommandClassification {
  const subcommand = argv[1]?.toLowerCase()

  // npm/pnpm/yarn install / ci → careful (modifies node_modules)
  if (subcommand === 'install' || subcommand === 'ci' || subcommand === 'i' || subcommand === 'add') {
    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: 'Install dependencies',
        writes: ['node_modules/', 'The lockfile'],
        cautions: [
          'Downloads packages from the network',
          'Runs install scripts from the downloaded packages',
          ...(subcommand === 'ci' ? ['npm ci deletes node_modules/ before installing'] : []),
        ],
      },
    }
  }

  // npm run <script>
  if (subcommand === 'run' || subcommand === 'run-script') {
    const script = argv[2]?.toLowerCase()
    if (!script || !ALLOWED_NPM_SCRIPTS.has(script)) {
      return { ok: false, reason: `${command} run ${script ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPM_SCRIPTS].join(', ')}.` }
    }
    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: `Run the "${script}" script`,
        writes: ['Whatever the script itself writes (build output, caches)'],
        cautions: ['Executes project-defined code from package.json'],
      },
    }
  }

  // npm test / npm exec
  if (subcommand === 'test' || subcommand === 't') {
    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: 'Run the test suite',
        writes: ['Test artifacts and caches'],
        cautions: ['Executes project-defined code from package.json'],
      },
    }
  }

  if (subcommand === 'exec') {
    const pkg = argv[2]?.toLowerCase()
    if (!pkg || !ALLOWED_NPX_PACKAGES.has(pkg)) {
      return { ok: false, reason: `${command} exec ${pkg ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPX_PACKAGES].join(', ')}.` }
    }
    return { ok: true, riskLevel: 'careful', summary, effect: describePackageRunnerEffect(pkg) }
  }

  // yarn without subcommand (yarn <script> shorthand)
  if (!subcommand) {
    return { ok: false, reason: `Missing ${command} subcommand.` }
  }

  if (ALLOWED_NPM_SCRIPTS.has(subcommand)) {
    return {
      ok: true,
      riskLevel: 'careful',
      summary,
      effect: {
        action: `Run the "${subcommand}" script`,
        writes: ['Whatever the script itself writes (build output, caches)'],
        cautions: ['Executes project-defined code from package.json'],
      },
    }
  }

  return { ok: false, reason: `${command} ${subcommand} is not allowed.` }
}

/** npx/npm exec 跑出来的二进制：formatter 会改源文件，其余只产出编译/测试结果。 */
function describePackageRunnerEffect(pkg: string): ShellCommandEffect {
  return {
    action: `Run ${pkg}`,
    writes: pkg === 'prettier' || pkg === 'eslint'
      ? ['Source files, if --write/--fix is passed']
      : ['Compiler or test output'],
    cautions: ['Downloads the package if it is not already cached'],
  }
}

function classifyNpxCommand(
  argv: string[],
  summary: string,
): ShellCommandClassification {
  const pkg = argv[1]?.toLowerCase()?.replace(/^@[^/]+\//, '')
  if (!pkg || !ALLOWED_NPX_PACKAGES.has(pkg)) {
    return { ok: false, reason: `npx ${pkg ?? '(missing)'} is not allowed. Allowed: ${[...ALLOWED_NPX_PACKAGES].join(', ')}.` }
  }
  return { ok: true, riskLevel: 'careful', summary, effect: describePackageRunnerEffect(pkg) }
}
