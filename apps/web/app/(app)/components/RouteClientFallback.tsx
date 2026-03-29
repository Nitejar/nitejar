import { cn } from '@/lib/utils'

export function RouteClientFallback({
  label = 'Loading...',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[320px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-sm text-white/45',
        className
      )}
    >
      {label}
    </div>
  )
}
