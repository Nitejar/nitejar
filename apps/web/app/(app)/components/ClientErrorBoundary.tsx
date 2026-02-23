'use client'

import type { ReactNode } from 'react'
import React from 'react'

interface ClientErrorBoundaryProps {
  children: ReactNode
  label?: string
}

interface ClientErrorBoundaryState {
  error: Error | null
}

export class ClientErrorBoundary extends React.Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-4 text-xs text-destructive">
          <p className="font-medium">Client error</p>
          {this.props.label ? (
            <p className="mt-1 text-[0.65rem] text-destructive/80">{this.props.label}</p>
          ) : null}
          <p className="mt-2">{error.message}</p>
        </div>
      )
    }

    return this.props.children
  }
}
