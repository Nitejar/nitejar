import { beforeEach, describe, expect, it, vi } from 'vitest'

const CANCEL = Symbol('cancel')

const promptMocks = vi.hoisted(() => ({
  introMock: vi.fn(),
  outroMock: vi.fn(),
  cancelMock: vi.fn(),
  selectMock: vi.fn(),
  textMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === CANCEL),
}))

const cryptoMocks = vi.hoisted(() => ({
  randomBytesMock: vi.fn((size: number) => Buffer.alloc(size, 1)),
}))

vi.mock('@clack/prompts', () => ({
  intro: promptMocks.introMock,
  outro: promptMocks.outroMock,
  cancel: promptMocks.cancelMock,
  select: promptMocks.selectMock,
  text: promptMocks.textMock,
  isCancel: promptMocks.isCancelMock,
}))

vi.mock('node:crypto', () => ({
  randomBytes: cryptoMocks.randomBytesMock,
}))

import { runWizard, shouldRunWizard } from '../../src/lib/wizard.js'

describe('wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    promptMocks.isCancelMock.mockImplementation((value: unknown) => value === CANCEL)
    cryptoMocks.randomBytesMock.mockImplementation((size: number) => Buffer.alloc(size, 1))
  })

  describe('shouldRunWizard', () => {
    it('returns true on first boot with TTY', () => {
      expect(shouldRunWizard(false, false, true)).toBe(true)
    })

    it('returns false when env file already exists', () => {
      expect(shouldRunWizard(true, false, true)).toBe(false)
    })

    it('returns false when --no-wizard is passed', () => {
      expect(shouldRunWizard(false, true, true)).toBe(false)
    })

    it('returns false when not a TTY', () => {
      expect(shouldRunWizard(false, false, false)).toBe(false)
    })
  })

  it('completes local-mode flow with defaults and generated secrets', async () => {
    promptMocks.selectMock.mockResolvedValueOnce('local')
    promptMocks.textMock.mockResolvedValueOnce('3100').mockResolvedValueOnce('')

    const result = await runWizard(3000)

    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      appBaseUrl: 'http://localhost:3100',
      port: 3100,
      openRouterApiKey: undefined,
    })
    expect(result?.encryptionKey).toHaveLength(64)
    expect(result?.betterAuthSecret).toBe(Buffer.alloc(32, 1).toString('base64'))
    expect(promptMocks.introMock).toHaveBeenCalledWith('Welcome to Nitejar')
    expect(promptMocks.outroMock).toHaveBeenCalledWith('Configuration saved. Starting Nitejar...')
    expect(cryptoMocks.randomBytesMock).toHaveBeenCalledTimes(2)
  })

  it('completes internet-mode flow and validates URL/port input', async () => {
    promptMocks.selectMock.mockResolvedValueOnce('internet')
    promptMocks.textMock
      .mockImplementationOnce((options: { validate?: (value: string) => string | void }) => {
        expect(options.validate?.('')).toContain('A URL is required')
        expect(options.validate?.('not-a-url')).toContain('Enter a valid URL')
        expect(options.validate?.('https://example.ngrok-free.app')).toBeUndefined()
        return 'https://example.ngrok-free.app'
      })
      .mockImplementationOnce((options: { validate?: (value: string) => string | void }) => {
        expect(options.validate?.('0')).toContain('Enter a valid port')
        expect(options.validate?.('70000')).toContain('Enter a valid port')
        expect(options.validate?.('3001')).toBeUndefined()
        return '3001'
      })
      .mockResolvedValueOnce('sk-or-test')

    const result = await runWizard(3000)

    expect(result).toMatchObject({
      appBaseUrl: 'https://example.ngrok-free.app',
      port: 3001,
      openRouterApiKey: 'sk-or-test',
    })
  })

  it('returns null when access mode selection is cancelled', async () => {
    promptMocks.selectMock.mockResolvedValueOnce(CANCEL)

    const result = await runWizard(3000)

    expect(result).toBeNull()
    expect(promptMocks.cancelMock).toHaveBeenCalledWith('Setup cancelled.')
    expect(promptMocks.textMock).not.toHaveBeenCalled()
  })

  it('returns null when internet URL prompt is cancelled', async () => {
    promptMocks.selectMock.mockResolvedValueOnce('internet')
    promptMocks.textMock.mockResolvedValueOnce(CANCEL)

    const result = await runWizard(3000)

    expect(result).toBeNull()
    expect(promptMocks.cancelMock).toHaveBeenCalledWith('Setup cancelled.')
  })

  it('returns null when port prompt is cancelled', async () => {
    promptMocks.selectMock.mockResolvedValueOnce('local')
    promptMocks.textMock.mockResolvedValueOnce(CANCEL)

    const result = await runWizard(3000)

    expect(result).toBeNull()
    expect(promptMocks.cancelMock).toHaveBeenCalledWith('Setup cancelled.')
  })

  it('returns null when API key prompt is cancelled', async () => {
    promptMocks.selectMock.mockResolvedValueOnce('local')
    promptMocks.textMock.mockResolvedValueOnce('3000').mockResolvedValueOnce(CANCEL)

    const result = await runWizard(3000)

    expect(result).toBeNull()
    expect(promptMocks.cancelMock).toHaveBeenCalledWith('Setup cancelled.')
  })
})
