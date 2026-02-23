import type { MouseEvent } from 'react'

/**
 * Attach to the grid/container wrapping multiple .card-surface elements.
 * Sets --mouse-x / --mouse-y on every card relative to each card's own
 * position, so the radial gradient spans across adjacent cards as one
 * continuous spotlight.
 */
export function handleGridShimmer(e: MouseEvent<HTMLElement>) {
  const cards = e.currentTarget.querySelectorAll<HTMLElement>('.card-surface')
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }
}

/** Attach to a single standalone .card-surface element. */
export function handleCardShimmer(e: MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
  e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
}
