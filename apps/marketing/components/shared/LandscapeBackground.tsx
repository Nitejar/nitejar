'use client'

import { useState, useEffect } from 'react'
import { StarField, StarFieldTuner } from './StarField'
import type { StarFieldTuning } from './StarField'

export function StarFieldBackground() {
  const [tuning, setTuning] = useState<Partial<StarFieldTuning>>({})
  const [showTuner, setShowTuner] = useState(false)
  const [tunerCollapsed, setTunerCollapsed] = useState(false)

  // Easter egg: triple-click the starfield background to toggle the tuner
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only trigger on empty space — not links, buttons, or inputs
      const tag = (e.target as HTMLElement).tagName
      if (['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if ((e.target as HTMLElement).closest('a, button, input, textarea, select')) return

      if (e.detail === 3) {
        setShowTuner((prev) => !prev)
      }
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0">
        <StarField tuning={tuning} />
      </div>
      {showTuner && (
        <StarFieldTuner
          onChange={setTuning}
          collapsed={tunerCollapsed}
          onCollapsedChange={setTunerCollapsed}
        />
      )}
    </>
  )
}

/** Desktop: absolute to page bottom. Mobile: hidden (use LandscapeImageMobile instead). */
export function LandscapeImage() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] hidden overflow-hidden md:block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/landscape.jpg"
        alt=""
        aria-hidden="true"
        className="landscape-mask relative left-1/2 block h-auto min-w-[1143px] -translate-x-1/2"
      />
    </div>
  )
}

/** Mobile only: absolute to bottom of its parent (main). Hidden on md+. */
export function LandscapeImageMobile() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 -z-10 overflow-hidden md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/landscape.jpg"
        alt=""
        aria-hidden="true"
        className="landscape-mask relative left-1/2 block h-auto min-w-[1143px] -translate-x-1/2"
      />
    </div>
  )
}
