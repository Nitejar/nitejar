import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findEvalRunById } from '@nitejar/database'
import { createPageMetadata, shortTitleId } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'

const EvalRunDetailClient = loadable(
  () => import('./EvalRunDetailClient').then((mod) => mod.EvalRunDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading eval run..." className="min-h-[360px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const run = await findEvalRunById(id)
  return createPageMetadata(`Eval Run ${shortTitleId(run?.id ?? id)}`)
}

export default async function EvalRunDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Evals"
        title="Eval Run"
        backLink={{ href: '/evals', label: 'Eval Dashboard' }}
      />
      <EvalRunDetailClient runId={id} />
    </PageScrollShell>
  )
}
