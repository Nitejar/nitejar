export function GlowOrb({
  className,
  size = 'md',
}: {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses = {
    sm: 'h-32 w-32',
    md: 'h-64 w-64',
    lg: 'h-96 w-96',
  }

  return (
    <div
      className={`pointer-events-none absolute rounded-full blur-3xl ${sizeClasses[size]} ${className ?? ''}`}
      style={{
        background:
          'radial-gradient(circle, oklch(0.75 0.15 75 / 0.15) 0%, oklch(0.75 0.15 75 / 0) 70%)',
      }}
      aria-hidden="true"
    />
  )
}
