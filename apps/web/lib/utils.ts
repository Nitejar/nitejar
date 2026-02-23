import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a USD cost value with appropriate precision for tiny amounts. */
export function formatCost(value: number): string {
  if (value === 0) return '$0'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(6)}`
}
