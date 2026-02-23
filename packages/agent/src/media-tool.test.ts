import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import * as Sprites from '@nitejar/sprites'
import * as GatewayOpenAIClient from './gateway-openai-client'
import * as MediaSettings from './media-settings'
import { executeTool } from './tools'
import type { ToolContext } from './tools/types'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    insertMediaArtifact: vi.fn(),
    insertMediaArtifactBlob: vi.fn(),
  }
})

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    appendFile: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    spriteExec: vi.fn(),
  }
})

vi.mock('./gateway-openai-client', async () => {
  const actual = await vi.importActual<typeof GatewayOpenAIClient>('./gateway-openai-client')
  return {
    ...actual,
    getGatewayClient: vi.fn(),
  }
})

vi.mock('./media-settings', async () => {
  const actual = await vi.importActual<typeof MediaSettings>('./media-settings')
  return {
    ...actual,
    getImageGenModel: vi.fn(),
    getSTTModel: vi.fn(),
    getTTSProvider: vi.fn(),
    getTTSModel: vi.fn(),
    getTTSSettings: vi.fn(),
  }
})

const mockedInsertMediaArtifact = vi.mocked(Database.insertMediaArtifact)
const mockedInsertMediaArtifactBlob = vi.mocked(Database.insertMediaArtifactBlob)
const mockedAppendFile = vi.mocked(Sprites.appendFile)
const mockedMkdir = vi.mocked(Sprites.mkdir)
const mockedWriteFile = vi.mocked(Sprites.writeFile)
const mockedSpriteExec = vi.mocked(Sprites.spriteExec)
const mockedGetGatewayClient = vi.mocked(GatewayOpenAIClient.getGatewayClient)
const mockedGetImageGenModel = vi.mocked(MediaSettings.getImageGenModel)
const mockedGetSTTModel = vi.mocked(MediaSettings.getSTTModel)
const mockedGetTTSProvider = vi.mocked(MediaSettings.getTTSProvider)
const mockedGetTTSModel = vi.mocked(MediaSettings.getTTSModel)
const mockedGetTTSSettings = vi.mocked(MediaSettings.getTTSSettings)

const context: ToolContext = {
  spriteName: 'sprite-1',
  session: undefined,
  agentId: 'agent-1',
  jobId: 'job-1',
}

describe('media tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedInsertMediaArtifact.mockResolvedValue({ id: 'artifact-1' } as never)
    mockedInsertMediaArtifactBlob.mockResolvedValue({} as never)
    mockedAppendFile.mockResolvedValue(undefined)
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedSpriteExec.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    mockedGetImageGenModel.mockResolvedValue('google/gemini-2.5-flash-image-preview')
    mockedGetSTTModel.mockResolvedValue('google/gemini-2.5-flash')
    mockedGetTTSProvider.mockResolvedValue('openai')
    mockedGetTTSModel.mockResolvedValue('tts-1')
    mockedGetTTSSettings.mockResolvedValue({
      enabled: true,
      provider: 'openai',
      apiKey: 'tts-key',
      model: 'tts-1',
      costPer1kCharsUsd: null,
    })
  })

  it('generates image, writes file, tracks cost, and stores artifact receipt', async () => {
    const imageBase64 = Buffer.from('fake-image-bytes').toString('base64')
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        cost: 0.001,
      },
    })
    mockedGetGatewayClient.mockResolvedValue({
      chat: { completions: { create } },
    } as never)

    const result = await executeTool('generate_image', { prompt: 'A sunset over snow' }, context)

    expect(result.success).toBe(true)
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(mockedSpriteExec).toHaveBeenCalledWith('sprite-1', expect.stringContaining('base64 -d'))
    expect(result._meta?.externalApiCost).toMatchObject({
      provider: 'openrouter',
      operation: 'generate_image',
      creditsUsed: 15,
      costUsd: 0.001,
    })
    expect(mockedInsertMediaArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: 'job-1',
        agent_id: 'agent-1',
        artifact_type: 'image',
        operation: 'generate_image',
      })
    )
    expect(mockedInsertMediaArtifactBlob).toHaveBeenCalledTimes(1)
  })

  it('transcribes sprite audio, returns transcript, tracks cost, and stores transcript receipt', async () => {
    const audioBase64 = Buffer.from('fake-audio').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: audioBase64,
      stderr: '',
      exitCode: 0,
      duration: 2,
    })

    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'hello from transcript' } }],
      usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, cost: 0.0023 },
    })
    mockedGetGatewayClient.mockResolvedValue({
      chat: { completions: { create } },
    } as never)

    const result = await executeTool(
      'transcribe_audio',
      { input_path: '/tmp/audio.wav', language: 'en' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('hello from transcript')
    expect(mockedSpriteExec).toHaveBeenCalledWith(
      'sprite-1',
      expect.stringContaining("base64 -w0 '/tmp/audio.wav'"),
      expect.anything()
    )
    const firstRequest = create.mock.calls[0]?.[0] as {
      messages?: Array<{ content?: Array<{ type: string }> }>
    }
    expect(firstRequest.messages?.[0]?.content?.[1]?.type).toBe('input_audio')
    expect(result._meta?.externalApiCost).toMatchObject({
      provider: 'openrouter',
      operation: 'transcribe',
      creditsUsed: 42,
      costUsd: 0.0023,
    })
    expect(mockedInsertMediaArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_type: 'transcript',
        operation: 'transcribe',
      })
    )
  })

  it('synthesizes speech via OpenAI provider, writes audio file, tracks cost, and stores artifact', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Buffer.from('audio-bytes').buffer),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeTool(
      'synthesize_speech',
      { text: 'Hello world', voice: 'alloy', format: 'mp3' },
      context
    )

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
      })
    )
    const requestOptions = fetchMock.mock.calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined
    expect(requestOptions?.headers).toMatchObject({ Authorization: 'Bearer tts-key' })
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(result._meta?.externalApiCost).toMatchObject({
      provider: 'openai',
      operation: 'synthesize_speech',
      creditsUsed: 11,
    })
    expect(mockedInsertMediaArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_type: 'audio',
        provider: 'openai',
        operation: 'synthesize_speech',
      })
    )
    expect(mockedInsertMediaArtifactBlob).toHaveBeenCalledTimes(1)
  })
})
