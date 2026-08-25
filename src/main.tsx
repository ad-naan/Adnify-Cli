import { render } from 'ink'
import { createRuntime } from './infrastructure/bootstrap/createRuntime'
import { App } from './presentation/ink/App'
import { ensureWindowsUtf8Console } from './infrastructure/bootstrap/ensureWindowsUtf8Console'

async function main() {
  await ensureWindowsUtf8Console()
  const runtime = await createRuntime()
  render(<App runtime={runtime} cwd={process.cwd()} />, {
    exitOnCtrlC: false,
    // A scrollable application shell should own one clean terminal viewport.
    // Incremental rendering leaves stale rows in some VS Code terminal builds.
    alternateScreen: true,
    maxFps: 30,
    kittyKeyboard: {
      mode: 'auto',
      flags: ['disambiguateEscapeCodes'],
    },
  })
}

// 启动阶段（Ink 渲染之前）抛出的异常没有任何 UI 可以承接，
// 不兜底就是一个 unhandled rejection，Windows 下甚至可能静默退出。
void main().catch((error) => {
  const detail = error instanceof Error
    ? `${error.message}\n${error.stack ?? ''}`
    : String(error)
  process.stderr.write(`Adnify CLI failed to start:\n${detail}\n`)
  process.exitCode = 1
})
