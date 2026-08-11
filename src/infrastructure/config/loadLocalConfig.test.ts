import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadModelConfig, loadProviders } from './loadLocalConfig'

describe('loadLocalConfig', () => {
  test('should throw a clear error for malformed config json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'adnify-config-'))
    const configPath = join(root, 'config.json')

    try {
      await writeFile(configPath, '{"model": ', 'utf8')

      await expect(loadModelConfig({ configPath })).rejects.toThrow(
        `Invalid JSON in config file: ${configPath}`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('should load model and providers from a valid config file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'adnify-config-'))
    const configPath = join(root, 'config.json')

    try {
      await writeFile(
        configPath,
        JSON.stringify(
          {
            model: {
              provider: 'openai-compatible',
              apiKey: 'sk-file',
              baseUrl: 'https://api.example.com/v1',
              model: 'gpt-x',
              maxTokens: 1234,
              contextWindowTokens: 200000,
              temperature: 0.4,
              timeoutMs: 15000,
            },
            providers: {
              lab: {
                provider: 'openai-compatible',
                apiKey: 'sk-lab',
                baseUrl: 'https://lab.example.com/v1',
                models: ['lab-1', 'lab-2'],
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      )

      const modelConfig = await loadModelConfig({ configPath })
      const providers = await loadProviders({ configPath })

      expect(modelConfig.apiKey).toBe('sk-file')
      expect(modelConfig.model).toBe('gpt-x')
      expect(modelConfig.contextWindowTokens).toBe(200000)
      expect(providers.lab?.baseUrl).toBe('https://lab.example.com/v1')
      expect(providers.lab?.models).toEqual(['lab-1', 'lab-2'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('should clamp unsafe numeric model settings from config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'adnify-config-'))
    const configPath = join(root, 'config.json')

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          model: {
            maxTokens: -10,
            contextWindowTokens: 100,
            temperature: 9,
            timeoutMs: 1,
          },
        }),
        'utf8',
      )

      const modelConfig = await loadModelConfig({ configPath })

      expect(modelConfig.maxTokens).toBe(1)
      expect(modelConfig.contextWindowTokens).toBe(4096)
      expect(modelConfig.temperature).toBe(2)
      expect(modelConfig.timeoutMs).toBe(1000)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
