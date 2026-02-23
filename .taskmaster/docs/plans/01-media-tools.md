# Plan: Media Tools (Image Gen, STT, TTS)

**Prerequisites:** None — can start immediately.
**Estimated new files:** 4
**Estimated modified files:** 5+

## Architecture Decisions

- **Image generation and STT route through OpenRouter.** No separate API key needed — they use the existing gateway client at `packages/agent/src/model-client.ts`.
- **TTS requires a direct provider API key** (OpenRouter has no audio output endpoint). Provider is configurable via dropdown in admin UI; OpenAI only at launch. Key stored in `capability_settings`.
- All media operations produce receipts via `media_artifacts` table + existing `external_api_calls`.

### OpenRouter Strategy

| Tool | OpenRouter? | How | Cost model |
|---|---|---|---|
| Image generation | **Yes** | Chat completions with `modalities: ["image", "text"]`. Models: `google/gemini-2.5-flash-image-preview` (cheapest at $0.03/M image output), `openai/gpt-5-image-mini`, `black-forest-labs/flux.2-pro` | Per-token or per-megapixel via OpenRouter |
| STT (transcribe) | **Yes** | Send audio as `input_audio` content part to a chat model (e.g. `google/gemini-2.5-flash`), ask it to transcribe. Base64-encoded audio input. | Chat completion pricing |
| TTS (speech) | **No** | Direct provider API call. Provider configurable (OpenAI only at launch). API key in `capability_settings`. | Provider-specific (OpenAI TTS pricing) |

---

## Step 1: Migration + Infrastructure

### New files

**`packages/database/migrations/2026MMDD_000000_media_capabilities.ts`**

`media_artifacts` table:
- `id` (text PK)
- `job_id` (text FK)
- `agent_id` (text FK)
- `artifact_type` (text — 'image', 'audio', 'transcript')
- `provider` (text)
- `model` (text)
- `operation` (text — 'generate_image', 'transcribe', 'synthesize_speech')
- `file_path` (text, nullable)
- `file_size_bytes` (integer, nullable)
- `metadata` (text — JSON)
- `cost_usd` (real, nullable)
- `created_at` (text)

**`packages/database/src/repositories/media-artifacts.ts`**
- `insertMediaArtifact(artifact)` — insert a row
- `listMediaArtifactsForJob(jobId)` — list all artifacts for a given job

**`packages/agent/src/media-settings.ts`** — capability checks + model config:
- `isImageGenAvailable()` — checks gateway has API key (uses existing OpenRouter key)
- `isSTTAvailable()` — same check (uses OpenRouter gateway)
- `isTTSAvailable()` — checks `capability_settings` row `text_to_speech` has API key + provider
- `getTTSProvider()` — returns provider from `capability_settings.config` JSON (default: `openai`)
- `getImageGenModel()` — returns configured model (default: `google/gemini-2.5-flash-image-preview`)
- `getSTTModel()` — returns configured model (default: `google/gemini-2.5-flash`)

### Modified files

- `packages/database/src/types.ts` — add `MediaArtifact` type

### Patterns to follow

- `packages/agent/src/web-search.ts` — capability settings loading
- `packages/agent/src/model-client.ts` `getClient()` — reuse for image gen + STT calls
- `packages/database/src/repositories/external-api-calls.ts` — receipt repository pattern

---

## Step 2: Media Tool Handlers

### New file

**`packages/agent/src/tools/handlers/media.ts`** — all three handlers:

#### `generate_image(prompt, size?, model?, output_path?)`

Uses existing OpenRouter gateway client:
```ts
client.chat.completions.create({
  model: "google/gemini-2.5-flash-image-preview",  // or user-configured
  modalities: ["image", "text"],
  messages: [{ role: "user", content: prompt }],
})
```
Response images arrive as base64 data URLs in the message. Handler decodes, writes to sprite filesystem via `spriteExec`, returns path + metadata + cost.

Available models (configurable per instance):
- `google/gemini-2.5-flash-image-preview` — cheapest ($0.03/M image output)
- `openai/gpt-5-image-mini` — $8/M image output
- `openai/gpt-5-image` — $40/M image output, highest quality
- `black-forest-labs/flux.2-pro` — $0.03/megapixel, pure image model

#### `transcribe_audio(input_path, model?, language?)`

Uses existing OpenRouter gateway client:
```ts
client.chat.completions.create({
  model: "google/gemini-2.5-flash",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Transcribe this audio accurately. Return only the transcript." },
      { type: "input_audio", input_audio: { data: base64Audio, format: "wav" } }
    ]
  }]
})
```
Handler reads audio file from sprite (base64 encode), sends to chat model via OpenRouter, returns transcript text.

#### `synthesize_speech(text, voice, model?, format?, output_path?)`

Uses **direct provider client** (separate from gateway). Provider configurable; OpenAI at launch:
```ts
const provider = getTTSProvider() // 'openai' (only option at launch)
const openai = new OpenAI({ apiKey: ttsApiKey }) // from capability_settings
openai.audio.speech.create({ model: "tts-1", voice, input: text, response_format: format })
```
This is the only media tool needing a separate API key. The handler dispatches to a provider-specific function.

### Modified files

- `packages/agent/src/tools/definitions.ts` — add `generateImageDefinition`, `synthesizeSpeechDefinition`, `transcribeAudioDefinition`
- `packages/agent/src/tools/handlers/index.ts` — register handlers in the flat map
- `packages/agent/src/runner.ts` — gate media tools on availability checks from `media-settings.ts` (same pattern as Tavily at ~line 1015)

### Patterns to follow

- `packages/agent/src/tools/handlers/web.ts` — `externalApiCost` return in `_meta`
- `packages/agent/src/integrations/telegram.ts` `sendFileHandler` (~line 364) — sprite file I/O
- `packages/agent/src/model-client.ts` `getClient()` — reuse for OpenRouter calls

---

## Step 3: Admin UI + Receipts

### Modified files

Admin capability settings page — add three cards:

- **Image generation card**: model selector (dropdown of supported models), enable/disable toggle. No API key field — uses existing gateway key.
- **Speech-to-text card**: model selector, enable/disable toggle. No API key field — uses existing gateway key.
- **Text-to-speech card**: provider dropdown (OpenAI only at launch, extensible), API key field, model selector, enable/disable toggle.

`apps/web/server/routers/costs.ts` — ensure media costs show up in cost dashboard (they'll already be in `external_api_calls`, may just need UI formatting).

### Pattern

Existing Tavily/web search capability card. Note that image gen and STT cards are simpler — no API key field since they reuse the gateway.

---

## Testing

**File:** `packages/agent/src/tools/handlers/media.test.ts`

- Unit tests for each handler mocking OpenAI API
- Verify `externalApiCost` tracking and `media_artifacts` insertion
- Test TTS provider dispatch (OpenAI case)
- Test image base64 decode + file write
- Test STT audio encode + transcript extraction

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. Run migration: `pnpm --filter @nitejar/database db:migrate`
4. Trigger image gen via Telegram, verify file output + cost receipt
5. Trigger TTS via Telegram (if API key configured), verify audio file output
