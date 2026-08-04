import { render } from 'ink'
import { createRuntime } from './infrastructure/bootstrap/createRuntime'
import { installSynchronizedOutput } from './presentation/ink/syncOutput'
import { App } from './presentation/ink/App'

async function main() {
  // Install synchronized output before render to eliminate flicker on full-screen rewrites.
  if (process.stdout.isTTY) {
    installSynchronizedOutput(process.stdout)
  }

  const runtime = await createRuntime()
  render(<App runtime={runtime} cwd={process.cwd()} />, {
    exitOnCtrlC: false,
  })
}

void main()
