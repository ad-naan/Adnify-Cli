import { render } from 'ink'
import { createRuntime } from './infrastructure/bootstrap/createRuntime'
import { App } from './presentation/ink/App'
import { applyTheme } from './presentation/ink/theme'

async function main() {
  const runtime = await createRuntime()
  // Apply the resolved palette before the first render so a light terminal gets the
  // light palette (and vice-versa) instead of the hardcoded dark default.
  applyTheme(runtime.ui.theme)
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
