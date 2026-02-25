import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rowRef, decryptMock, getDbMock } = vi.hoisted(() => {
  const row = {
    current: null as { enabled: number; api_key_encrypted: string | null } | null,
  }
  const decrypt = vi.fn((value: string) => `dec:${value}`)
  const getDb = vi.fn(() => ({
    selectFrom: vi.fn(() => ({
      select: vi.fn(() => ({
        where: vi.fn(() => ({
          executeTakeFirst: vi.fn(() => Promise.resolve(row.current)),
        })),
      })),
    })),
  }))
  return { rowRef: row, decryptMock: decrypt, getDbMock: getDb }
})

vi.mock('@nitejar/database', () => ({
  decrypt: decryptMock,
  getDb: getDbMock,
}))

import {
  getOptionalSpritesToken,
  requireSpritesToken,
  getSpritesTokenSettings,
  isSpritesExecutionAvailable,
} from '../src/token-settings'

describe('token settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rowRef.current = null
  })

  it('returns no token when capability row is missing', async () => {
    const settings = await getSpritesTokenSettings()

    expect(settings).toEqual({
      enabled: true,
      token: null,
      source: 'none',
    })
    expect(isSpritesExecutionAvailable(settings)).toBe(false)
  })

  it('uses DB token when capability row is configured', async () => {
    rowRef.current = { enabled: 1, api_key_encrypted: 'enc-token' }

    const settings = await getSpritesTokenSettings()

    expect(settings).toEqual({
      enabled: true,
      token: 'dec:enc-token',
      source: 'capability_settings',
    })
    expect(decryptMock).toHaveBeenCalledWith('enc-token')
  })

  it('returns no token when capability row is enabled without DB key', async () => {
    rowRef.current = { enabled: 1, api_key_encrypted: null }

    const settings = await getSpritesTokenSettings()

    expect(settings).toEqual({
      enabled: true,
      token: null,
      source: 'none',
    })
  })

  it('returns null optional token when capability is disabled', async () => {
    rowRef.current = { enabled: 0, api_key_encrypted: 'enc-token' }

    const settings = await getSpritesTokenSettings()
    const token = await getOptionalSpritesToken()

    expect(settings.enabled).toBe(false)
    expect(settings.token).toBe('dec:enc-token')
    expect(token).toBeNull()
    expect(isSpritesExecutionAvailable(settings)).toBe(false)
  })

  it('throws when requiring token while capability is disabled', async () => {
    rowRef.current = { enabled: 0, api_key_encrypted: 'enc-token' }
    await expect(requireSpritesToken()).rejects.toThrow('Tool execution is disabled')
  })

  it('throws when requiring token and key is missing', async () => {
    rowRef.current = { enabled: 1, api_key_encrypted: null }
    await expect(requireSpritesToken()).rejects.toThrow('Sprites API key not configured')
  })
})
