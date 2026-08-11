import { useCallback, useRef, useState } from 'react'
import type { AppI18n } from '../../../application/i18n/AppI18n'
import type { ModelConfig } from '../../../domain/assistant/value-objects/ModelConfig'
import { PROVIDER_PRESETS, type ProviderPreset } from '../../../infrastructure/config/providerPresets'
import { writeModelConfig } from '../../../infrastructure/config/writeLocalConfig'
import { resolveAppStorage } from '../../../infrastructure/storage/resolveAppStorage'

type InitStep =
  | 'idle'
  | 'select-provider'
  | 'select-model'
  | 'enter-model'
  | 'enter-apikey'
  | 'enter-baseurl'
  | 'confirm'
  | 'done'

export interface ConfigInitState {
  isActive: boolean
  promptText: string
  errorText: string
  start: () => void
  stop: () => void
  handleInput: (input: string) => Promise<ConfigInitResult | null>
  moveSelection: (direction: 'up' | 'down') => void
  isSelectionStep: boolean
}

export interface ConfigInitResult {
  config: ModelConfig
  message: string
}

/**
 * 交互式模型配置向导。
 * 流程：选择 Provider -> 选择模型 -> 输入 Key -> 必要时输入 Base URL -> 确认保存。
 */
export function useConfigInit(i18n: AppI18n): ConfigInitState {
  const [step, setStep] = useState<InitStep>('idle')
  const [errorText, setErrorText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const chosen = useRef<{
    preset: ProviderPreset | null
    model: string
    apiKey: string
    baseUrl: string
    isCustom: boolean
  }>({
    preset: null,
    model: '',
    apiKey: '',
    baseUrl: '',
    isCustom: false,
  })

  const buildPromptText = useCallback((): string => {
    switch (step) {
      case 'select-provider': {
        const lines = [i18n.t('config.selectProviderTitle')]
        PROVIDER_PRESETS.forEach((preset, index) => {
          lines.push(`${index === selectedIndex ? '›' : ' '} ${index + 1}. ${preset.label} (${preset.models.slice(0, 3).join(' / ')})`)
        })
        lines.push(`${selectedIndex === PROVIDER_PRESETS.length ? '›' : ' '} ${PROVIDER_PRESETS.length + 1}. ${i18n.t('config.customProvider')}`)
        lines.push('')
        lines.push(i18n.t('config.enterIndexContinue'))
        return lines.join('\n')
      }

      case 'select-model': {
        const preset = chosen.current.preset
        if (!preset) {
          return i18n.t('config.selectModelInstruction')
        }

        const lines = [i18n.t('config.selectModelTitle', { provider: preset.label })]
        preset.models.forEach((model, index) => {
          const isDefault = model === preset.defaultModel ? i18n.t('config.defaultSuffix') : ''
          lines.push(`${index === selectedIndex ? '›' : ' '} ${index + 1}. ${model}${isDefault}`)
        })
        lines.push('')
        lines.push(i18n.t('config.selectModelInstruction'))
        return lines.join('\n')
      }

      case 'enter-apikey':
        return i18n.t('config.enterApiKey')

      case 'enter-baseurl':
        return i18n.t('config.enterBaseUrl')

      case 'enter-model':
        return i18n.t('config.enterCustomModel')

      case 'confirm': {
        const current = chosen.current
        const masked =
          current.apiKey.length > 10
            ? `${current.apiKey.slice(0, 6)}...${current.apiKey.slice(-4)}`
            : current.apiKey || '(empty)'

        return [
          i18n.t('config.confirmTitle'),
          `  ${i18n.t('config.confirmBaseUrl', { value: current.baseUrl })}`,
          `  ${i18n.t('config.confirmModel', { value: current.model })}`,
          `  ${i18n.t('config.confirmApiKey', { value: masked })}`,
          '',
          i18n.t('config.confirmInstruction'),
        ].join('\n')
      }

      default:
        return ''
    }
  }, [i18n, selectedIndex, step])

  const start = useCallback(() => {
    chosen.current = {
      preset: null,
      model: '',
      apiKey: '',
      baseUrl: '',
      isCustom: false,
    }
    setErrorText('')
    setSelectedIndex(0)
    setStep('select-provider')
  }, [])

  const stop = useCallback(() => {
    setErrorText('')
    setStep('idle')
  }, [])

  const handleInput = useCallback(async (input: string): Promise<ConfigInitResult | null> => {
    const trimmed = input.trim()
    setErrorText('')

    switch (step) {
      case 'select-provider': {
        const index = trimmed ? Number.parseInt(trimmed, 10) - 1 : selectedIndex
        const maxIndex = PROVIDER_PRESETS.length

        if (Number.isNaN(index) || index < 0 || index > maxIndex) {
          setErrorText(i18n.t('config.rangeError', { max: maxIndex + 1 }))
          return null
        }

        if (index === maxIndex) {
          chosen.current.isCustom = true
          chosen.current.preset = null
          setStep('enter-baseurl')
          return null
        }

        const preset = PROVIDER_PRESETS[index]!
        chosen.current.preset = preset
        chosen.current.baseUrl = preset.baseUrl
        chosen.current.isCustom = false
        setSelectedIndex(Math.max(0, preset.models.indexOf(preset.defaultModel)))
        setStep('select-model')
        return null
      }

      case 'select-model': {
        const preset = chosen.current.preset
        if (!preset) {
          setStep('idle')
          return null
        }

        const index = trimmed ? Number.parseInt(trimmed, 10) - 1 : selectedIndex
        if (Number.isNaN(index) || index < 0 || index >= preset.models.length) {
          setErrorText(i18n.t('config.modelRangeError', { max: preset.models.length }))
          return null
        }
        chosen.current.model = preset.models[index]!

        setStep('enter-apikey')
        return null
      }

      case 'enter-baseurl': {
        if (!trimmed) {
          setErrorText(i18n.t('config.baseUrlRequired'))
          return null
        }

        chosen.current.baseUrl = trimmed
        chosen.current.model = ''
        setStep('enter-model')
        return null
      }

      case 'enter-model': {
        if (!trimmed) {
          setErrorText(i18n.t('config.modelRequired'))
          return null
        }

        chosen.current.model = trimmed
        setStep('enter-apikey')
        return null
      }

      case 'enter-apikey': {
        if (!trimmed) {
          setErrorText(i18n.t('config.apiKeyRequired'))
          return null
        }

        chosen.current.apiKey = trimmed

        setStep('confirm')
        return null
      }

      case 'confirm': {
        const lower = trimmed.toLowerCase()
        if (lower === 'n') {
          setStep('idle')
          return null
        }

        if (lower !== 'y') {
          setErrorText(i18n.t('config.confirmChoiceError'))
          return null
        }

        const current = chosen.current
        const config: ModelConfig = {
          provider: current.preset?.provider ?? 'openai-compatible',
          apiKey: current.apiKey,
          baseUrl: current.baseUrl,
          model: current.model,
          maxTokens: 4096,
          temperature: 0.7,
          timeoutMs: 60_000,
        }

        await writeModelConfig(config)
        const storage = await resolveAppStorage()
        setStep('done')

        return {
          config,
          message: [
            i18n.t('config.savedLine1').replace('~/.adnify-cli/config.json', storage.configPath),
            i18n.t('config.savedLine2', {
              model: config.model,
              baseUrl: config.baseUrl,
            }),
            i18n.t('config.savedLine3'),
          ].join('\n'),
        }
      }

      default:
        return null
    }
  }, [i18n, selectedIndex, step])

  const moveSelection = useCallback((direction: 'up' | 'down') => {
    const itemCount = step === 'select-provider'
      ? PROVIDER_PRESETS.length + 1
      : step === 'select-model'
        ? chosen.current.preset?.models.length ?? 0
        : 0

    if (itemCount <= 0) return
    setErrorText('')
    setSelectedIndex((current) =>
      direction === 'up'
        ? (current - 1 + itemCount) % itemCount
        : (current + 1) % itemCount,
    )
  }, [step])

  return {
    isActive: step !== 'idle' && step !== 'done',
    promptText: buildPromptText(),
    errorText,
    start,
    stop,
    handleInput,
    moveSelection,
    isSelectionStep: step === 'select-provider' || step === 'select-model',
  }
}
