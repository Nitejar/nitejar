'use client'

import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RouteModalProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function RouteModal({ title, description, children, className }: RouteModalProps) {
  const router = useRouter()

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          router.back()
        }
      }}
    >
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
