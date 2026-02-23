interface IdentityBadgeProps {
  name: string
  subtitle?: string
  avatarUrl?: string | null
  emoji?: string | null
  size?: 'sm' | 'md'
}

export function IdentityBadge({
  name,
  subtitle,
  avatarUrl,
  emoji,
  size = 'md',
}: IdentityBadgeProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const dimension = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div className="flex items-center gap-3">
      <div
        className={`relative flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/70 text-muted-foreground ${dimension}`}
        aria-hidden="true"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="h-full w-full rounded-full object-cover" />
        ) : (
          <span className="font-medium text-foreground">{emoji ? emoji : initials}</span>
        )}
      </div>
      <div>
        <p className={`${textSize} font-semibold text-foreground`}>{name}</p>
        {subtitle ? <p className="text-[0.65rem] text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}
