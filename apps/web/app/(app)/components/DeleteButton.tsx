'use client'

import { useFormStatus } from 'react-dom'

interface DeleteButtonProps {
  className?: string
  confirmMessage: string
  children: React.ReactNode
}

export function DeleteButton({ className, confirmMessage, children }: DeleteButtonProps) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!confirm(confirmMessage)) {
          e.preventDefault()
        }
      }}
    >
      {pending ? 'Deleting...' : children}
    </button>
  )
}
