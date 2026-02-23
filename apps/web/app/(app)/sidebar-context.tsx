'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

interface SidebarContextValue {
  collapsed: boolean
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggleCollapsed: () => {},
  setCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
})

const STORAGE_KEY = 'nitejar-sidebar-collapsed'

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setCollapsedState(true)
    } catch {
      /* noop */
    }
  }, [])

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v)
    try {
      localStorage.setItem(STORAGE_KEY, String(v))
    } catch {
      /* noop */
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        /* noop */
      }
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapsed, setCollapsed, mobileOpen, setMobileOpen }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
