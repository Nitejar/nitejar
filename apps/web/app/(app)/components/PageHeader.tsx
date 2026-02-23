import Link from 'next/link'
import { IconChevronLeft } from '@tabler/icons-react'

interface PageHeaderProps {
  category?: string
  title: string
  description?: string
  backLink?: { href: string; label: string }
  action?: { href: string; label: string }
}

export function PageHeader({ category, title, description, backLink, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        {backLink ? (
          <Link
            href={backLink.href}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <IconChevronLeft className="h-3 w-3" />
            {backLink.label}
          </Link>
        ) : category ? (
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">
            {category}
          </p>
        ) : null}
        <h2 className="text-2xl font-semibold">{title}</h2>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <Link
          href={action.href}
          className="rounded-md border border-border/60 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/50 hover:bg-primary/20"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
