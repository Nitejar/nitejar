import { ImageResponse } from 'next/og'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'

const fontCache = new Map<string, ArrayBuffer>()

async function loadGoogleFont(family: string, weight: 400 | 600): Promise<ArrayBuffer> {
  const cacheKey = `${family}-${weight}`
  const cached = fontCache.get(cacheKey)
  if (cached) return cached

  try {
    const params = new URLSearchParams({
      family: `${family}:wght@${weight}`,
      display: 'swap',
    })

    const css = await fetch(`https://fonts.googleapis.com/css2?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'force-cache',
    }).then((res) => res.text())

    const fontUrlMatches = Array.from(
      css.matchAll(/src:\s*url\((https:[^)]+)\)\s*format\('([^']+)'\)/gi)
    )

    // next/og in this project rejects woff2, so prefer truetype/opentype/woff.
    const preferred =
      fontUrlMatches.find((m) => {
        const format = m[2]
        return typeof format === 'string' && /^(truetype|opentype|woff)$/i.test(format)
      }) ??
      fontUrlMatches.find((m) => {
        const url = m[1]
        return typeof url === 'string' && /\.(ttf|otf|woff)(?:\?|$)/i.test(url)
      })
    if (!preferred?.[1]) {
      throw new Error(`Unable to load ${family} ${weight} from Google Fonts`)
    }

    const fontData = await fetch(preferred[1], {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'force-cache',
    }).then((res) => res.arrayBuffer())

    fontCache.set(cacheKey, fontData)
    return fontData
  } catch (error) {
    throw new Error(
      `Failed to load Google font ${family} ${weight}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function getWordsLogo(): string {
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'logos', 'nitejar-words.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

function getWordmarkLogo(): string {
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'logos', 'wordmark.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const variant = searchParams.get('variant')
  const titleParam = searchParams.get('title')
  const descriptionParam = searchParams.get('description')
  const isDocs = variant === 'docs' || Boolean(titleParam || descriptionParam)

  const docsTitle = clampText(titleParam ?? 'Nitejar Docs', 80)
  const docsDescription = clampText(
    descriptionParam ?? 'Documentation for the self-hosted AI agent fleet.',
    140
  )

  const [interRegularData, interSemiboldData, dmSerifRegularData] = await Promise.all([
    loadGoogleFont('Inter', 400),
    loadGoogleFont('Inter', 600),
    loadGoogleFont('DM Serif Display', 400),
  ])

  const wordsLogo = getWordsLogo()
  const wordmarkLogo = getWordmarkLogo()

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' }[] = [
    {
      name: 'Inter',
      data: interRegularData,
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Inter',
      data: interSemiboldData,
      weight: 600,
      style: 'normal',
    },
    {
      name: 'DM Serif Display',
      data: dmSerifRegularData,
      weight: 400,
      style: 'normal',
    },
  ]

  return new ImageResponse(
    isDocs ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          width: '100%',
          height: '100%',
          padding: '54px 72px 42px',
          boxSizing: 'border-box',
          backgroundColor: '#0b0d16',
          backgroundImage:
            'radial-gradient(circle at 12% 12%, rgba(201,160,64,0.18) 0%, rgba(201,160,64,0) 34%), radial-gradient(circle at 92% 88%, rgba(201,160,64,0.12) 0%, rgba(201,160,64,0) 40%)',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {wordmarkLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={wordmarkLogo}
              width="510"
              height="190"
              alt="Nitejar"
              // Render from a larger source box, display smaller for cleaner edges.
              style={{ width: '255px', height: '95px' }}
            />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '72px',
          }}
        >
          <span
            style={{
              fontFamily: 'DM Serif Display',
              color: '#f2ebdc',
              fontSize: docsTitle.length > 42 ? 62 : 68,
              fontWeight: 400,
              lineHeight: 1.02,
            }}
          >
            {docsTitle}
          </span>
          <span
            style={{
              color: '#cec3ad',
              fontSize: 32,
              fontWeight: 400,
              lineHeight: 1.2,
              maxWidth: '1000px',
            }}
          >
            {docsDescription}
          </span>
        </div>

        <span
          style={{
            fontFamily: 'Inter',
            color: '#9f936f',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '0.08em',
            marginTop: 'auto',
            alignSelf: 'flex-end',
          }}
        >
          nitejar.dev/docs
        </span>
      </div>
    ) : (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          width: '100%',
          height: '100%',
          padding: '22px 56px 44px',
          boxSizing: 'border-box',
          backgroundColor: '#0b0d16',
          backgroundImage:
            'radial-gradient(circle at 50% -10%, rgba(201,160,64,0.2) 0%, rgba(201,160,64,0) 48%), radial-gradient(circle at 85% 85%, rgba(201,160,64,0.12) 0%, rgba(201,160,64,0) 40%)',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: 'translateY(-20px)',
          }}
        >
          {wordsLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={wordsLogo}
              width="410"
              height="410"
              alt="Nitejar"
              style={{ marginBottom: '6px' }}
            />
          )}

          <span
            style={{
              fontFamily: 'DM Serif Display',
              color: '#f2ebdc',
              fontSize: 52,
              fontWeight: 400,
              lineHeight: 1.05,
              maxWidth: '1040px',
            }}
          >
            Your agents work the night shift
          </span>

          <span
            style={{
              color: '#cec3ad',
              fontSize: 30,
              fontWeight: 400,
              lineHeight: 1.18,
              marginTop: '10px',
              maxWidth: '980px',
            }}
          >
            Self-hosted AI agent fleet for real team workflows
          </span>
        </div>

        <span
          style={{
            fontFamily: 'Inter',
            color: '#9f936f',
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.08em',
            position: 'absolute',
            bottom: '22px',
            right: '34px',
          }}
        >
          nitejar.dev
        </span>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
    }
  )
}
