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

void main()
