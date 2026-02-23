'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Star {
  x: number
  y: number
  size: number
  baseOpacity: number
  /** Depth layer 0 = far/slow, 1 = mid, 2 = near/fast */
  layer: 0 | 1 | 2
  /* Twinkle: blend of two sine waves at different frequencies */
  freqA: number
  freqB: number
  phaseA: number
  phaseB: number
  /** Colour temperature — 0 = warm (gold tint), 1 = cool (blue-white) */
  warmth: number
}

interface ShootingStar {
  x: number
  y: number
  angle: number
  speed: number
  length: number
  life: number
  maxLife: number
  opacity: number
}

/* ------------------------------------------------------------------ */
/*  Tunable defaults                                                   */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  density: 3500,
  sizeMin: 0.3,
  sizeMax: 2,
  lightness: 0.93,
  twinkleSpeed: 4,
  twinkleDepth: 0.8,
  brightnessFloor: 0.25,
  shootingMinInterval: 4,
  shootingMaxInterval: 12,
}

export type StarFieldTuning = typeof DEFAULTS

/** Parallax multiplier per layer (px shifted per 1 px of scroll) */
const PARALLAX = [0.02, 0.05, 0.1] as const
/** Opacity range per layer — near stars can reach full brightness */
const OPACITY_LAYER_0: readonly [number, number] = [0.3, 0.4]
const OPACITY_LAYER_1: readonly [number, number] = [0.5, 0.4]
const OPACITY_LAYER_2: readonly [number, number] = [0.7, 0.3]

function getLayerOpacity(layer: Star['layer']): readonly [number, number] {
  if (layer === 0) return OPACITY_LAYER_0
  if (layer === 1) return OPACITY_LAYER_1
  return OPACITY_LAYER_2
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function StarField({
  className,
  tuning: tuningOverride,
}: {
  className?: string
  tuning?: Partial<StarFieldTuning>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const shootingRef = useRef<ShootingStar[]>([])
  const animRef = useRef<number>(0)
  const scrollYRef = useRef(0)
  const lastTimeRef = useRef(0)
  const nextShootingRef = useRef(0)
  const tuningRef = useRef<StarFieldTuning>({ ...DEFAULTS, ...tuningOverride })
  const regenRef = useRef<(() => void) | null>(null)

  // Keep tuning ref in sync; regenerate stars when density/size changes
  useEffect(() => {
    const prev = tuningRef.current
    const next = { ...DEFAULTS, ...tuningOverride }
    tuningRef.current = next
    if (
      prev.density !== next.density ||
      prev.sizeMin !== next.sizeMin ||
      prev.sizeMax !== next.sizeMax
    ) {
      regenRef.current?.()
    }
  }, [tuningOverride])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0

    /* ---- resize -------------------------------------------------- */
    function resize() {
      const dpr = window.devicePixelRatio || 1
      w = canvas!.offsetWidth
      h = canvas!.offsetHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      generateStars()
    }

    /* ---- star generation ----------------------------------------- */
    function generateStars() {
      const t = tuningRef.current
      const area = w * h
      const count = Math.floor(area / t.density)
      const sizeRange = t.sizeMax - t.sizeMin
      starsRef.current = Array.from({ length: count }, () => {
        const layer = ([0, 0, 0, 1, 1, 2] as const)[Math.floor(Math.random() * 6)] as Star['layer']
        // Layer still biases size: far=small end, near=big end
        const layerBias = layer / 2 // 0, 0.5, 1
        const baseFrac = layerBias * 0.5 + Math.random() * 0.5 // biased toward layer end
        const [oMin, oRange] = getLayerOpacity(layer)
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          size: t.sizeMin + baseFrac * sizeRange,
          baseOpacity: Math.random() * oRange + oMin,
          layer,
          freqA: Math.random() * 0.0008 + 0.0002,
          freqB: Math.random() * 0.0015 + 0.0005,
          phaseA: Math.random() * Math.PI * 2,
          phaseB: Math.random() * Math.PI * 2,
          warmth: Math.random(),
        }
      })
    }
    regenRef.current = generateStars

    /* ---- scroll tracking ----------------------------------------- */
    function onScroll() {
      scrollYRef.current = window.scrollY
    }

    /* ---- shooting star spawning ---------------------------------- */
    function maybeSpawnShootingStar(time: number) {
      if (time < nextShootingRef.current) return
      const t = tuningRef.current
      const range = t.shootingMaxInterval - t.shootingMinInterval
      nextShootingRef.current = time + (t.shootingMinInterval + Math.random() * range) * 1000

      const fromLeft = Math.random() > 0.5
      shootingRef.current.push({
        x: fromLeft ? Math.random() * w * 0.6 : w * 0.4 + Math.random() * w * 0.6,
        y: Math.random() * h * 0.5,
        angle: fromLeft ? 0.3 + Math.random() * 0.5 : Math.PI - 0.3 - Math.random() * 0.5,
        speed: 0.3 + Math.random() * 0.3,
        length: 60 + Math.random() * 80,
        life: 0,
        maxLife: 600 + Math.random() * 400,
        opacity: 0.6 + Math.random() * 0.3,
      })
    }

    /* ---- draw ---------------------------------------------------- */
    function draw(time: number) {
      const dt = time - lastTimeRef.current
      lastTimeRef.current = time
      ctx!.clearRect(0, 0, w, h)

      const scrollY = scrollYRef.current
      const t = tuningRef.current

      /* Stars */
      for (const star of starsRef.current) {
        const py = (-scrollY * PARALLAX[star.layer]) % h
        const drawY = (((star.y + py) % h) + h) % h

        let opacity: number
        if (prefersReducedMotion) {
          opacity = star.baseOpacity
        } else {
          const tA = Math.sin(time * star.freqA * t.twinkleSpeed + star.phaseA)
          const tB = Math.sin(time * star.freqB * t.twinkleSpeed + star.phaseB)
          const wave = 0.6 * tA + 0.4 * tB // -1 to 1
          // Remap wave from [-1,1] to [0,1], apply depth, then floor
          const normalized = (1 + wave) / 2 // 0–1
          const dimmed = Math.pow(normalized, t.twinkleDepth) // depth controls dip curve
          const blend = t.brightnessFloor + (1 - t.brightnessFloor) * dimmed // floor–1.0
          opacity = star.baseOpacity * blend
        }

        const hue = star.warmth < 0.3 ? 60 : star.warmth > 0.7 ? 240 : 80
        const chroma = star.warmth < 0.3 || star.warmth > 0.7 ? 0.03 : 0.01

        ctx!.beginPath()
        ctx!.arc(star.x, drawY, star.size, 0, Math.PI * 2)
        ctx!.fillStyle = `oklch(${t.lightness} ${chroma} ${hue} / ${opacity})`
        ctx!.fill()
      }

      /* Shooting stars */
      if (!prefersReducedMotion) {
        maybeSpawnShootingStar(time)

        shootingRef.current = shootingRef.current.filter((s) => {
          s.life += dt
          if (s.life > s.maxLife) return false

          const progress = s.life / s.maxLife
          const alpha = s.opacity * (progress < 0.1 ? progress / 0.1 : 1 - (progress - 0.1) / 0.9)

          const headX = s.x + Math.cos(s.angle) * s.speed * s.life
          const headY = s.y + Math.sin(s.angle) * s.speed * s.life
          const tailX = headX - Math.cos(s.angle) * s.length * Math.min(progress * 5, 1)
          const tailY = headY - Math.sin(s.angle) * s.length * Math.min(progress * 5, 1)

          const grad = ctx!.createLinearGradient(tailX, tailY, headX, headY)
          grad.addColorStop(0, `oklch(0.95 0.02 80 / 0)`)
          grad.addColorStop(1, `oklch(0.95 0.02 80 / ${alpha})`)

          ctx!.beginPath()
          ctx!.moveTo(tailX, tailY)
          ctx!.lineTo(headX, headY)
          ctx!.strokeStyle = grad
          ctx!.lineWidth = 1.5
          ctx!.stroke()

          return true
        })
      }

      if (!prefersReducedMotion) {
        animRef.current = requestAnimationFrame(draw)
      }
    }

    /* ---- init ---------------------------------------------------- */
    resize()
    scrollYRef.current = window.scrollY
    const t = tuningRef.current
    nextShootingRef.current =
      performance.now() +
      (t.shootingMinInterval + Math.random() * (t.shootingMaxInterval - t.shootingMinInterval)) *
        1000

    if (prefersReducedMotion) {
      draw(0)
    } else {
      animRef.current = requestAnimationFrame(draw)
    }

    window.addEventListener('resize', resize)
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
      aria-hidden="true"
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Dev tuning panel — render alongside StarField during development   */
/* ------------------------------------------------------------------ */

export function StarFieldTuner({
  onChange,
  collapsed,
  onCollapsedChange,
}: {
  onChange: (tuning: StarFieldTuning) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}) {
  const [values, setValues] = useState<StarFieldTuning>({ ...DEFAULTS })

  const update = useCallback(
    (key: keyof StarFieldTuning, value: number) => {
      const next = { ...DEFAULTS, ...values, [key]: value }
      setValues(next)
      onChange(next)
    },
    [onChange, values]
  )

  if (collapsed) {
    return (
      <button
        onClick={() => onCollapsedChange(false)}
        className="fixed right-4 bottom-4 z-[9999] rounded-lg bg-night-800/95 px-3 py-2 font-mono text-xs text-gold-400 shadow-lg backdrop-blur-sm"
      >
        Stars
      </button>
    )
  }

  const sliders: {
    key: keyof StarFieldTuning
    label: string
    tip: string
    min: number
    max: number
    step: number
  }[] = [
    {
      key: 'density',
      label: 'Density',
      tip: 'Pixels of area per star. Lower = more stars. 3000 is dense, 10000 is sparse.',
      min: 1000,
      max: 20000,
      step: 500,
    },
    {
      key: 'sizeMin',
      label: 'Min Size',
      tip: 'Minimum star radius in pixels.',
      min: 0.1,
      max: 2,
      step: 0.1,
    },
    {
      key: 'sizeMax',
      label: 'Max Size',
      tip: 'Maximum star radius in pixels.',
      min: 0.5,
      max: 5,
      step: 0.1,
    },
    {
      key: 'lightness',
      label: 'Lightness',
      tip: 'Star colour lightness. 0 = black, 0.7 = gray, 1 = pure white.',
      min: 0.3,
      max: 1,
      step: 0.05,
    },
    {
      key: 'twinkleSpeed',
      label: 'Twinkle Speed',
      tip: 'Multiplier on flicker frequency. Higher = faster shimmer.',
      min: 0.5,
      max: 20,
      step: 0.5,
    },
    {
      key: 'twinkleDepth',
      label: 'Twinkle Depth',
      tip: 'How far stars dim when twinkling. 0 = steady, 1 = full on/off.',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'brightnessFloor',
      label: 'Brightness Floor',
      tip: 'Minimum brightness a star can reach. Prevents stars from fully disappearing.',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'shootingMinInterval',
      label: 'Shooting Min (s)',
      tip: 'Minimum seconds between shooting stars.',
      min: 1,
      max: 30,
      step: 1,
    },
    {
      key: 'shootingMaxInterval',
      label: 'Shooting Max (s)',
      tip: 'Maximum seconds between shooting stars.',
      min: 2,
      max: 60,
      step: 1,
    },
  ]

  return (
    <div className="fixed right-4 bottom-4 z-[9999] w-72 rounded-xl bg-night-800/95 p-4 shadow-xl backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs font-medium tracking-wider text-gold-400 uppercase">
          Star Tuner
        </span>
        <button
          onClick={() => onCollapsedChange(true)}
          className="text-xs text-night-600 hover:text-moon-200"
        >
          minimize
        </button>
      </div>
      <div className="space-y-3">
        {sliders.map(({ key, label, tip, min, max, step }) => (
          <label key={key} className="block">
            <div className="mb-1 flex justify-between font-mono text-[0.65rem] text-moon-200">
              <span className="group relative flex items-center gap-1">
                {label}
                <span className="inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full bg-night-700 text-[0.5rem] text-night-600">
                  ?
                </span>
                <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 hidden w-44 rounded-md bg-night-950 px-2 py-1.5 text-[0.6rem] leading-snug text-moon-200 shadow-lg group-hover:block">
                  {tip}
                </span>
              </span>
              <span className="text-gold-500">{values[key] ?? DEFAULTS[key]}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={values[key] ?? DEFAULTS[key]}
              onChange={(e) => update(key, parseFloat(e.target.value))}
              className="w-full accent-gold-500"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 border-t border-night-700/50 pt-2">
        <button
          onClick={() => {
            const payload = JSON.stringify(values, null, 2)
            // eslint-disable-next-line no-console
            console.log('StarField tuning:', payload)
            void navigator.clipboard?.writeText(payload)
          }}
          className="font-mono text-[0.6rem] text-night-600 hover:text-gold-400"
        >
          Copy values to clipboard
        </button>
      </div>
    </div>
  )
}
