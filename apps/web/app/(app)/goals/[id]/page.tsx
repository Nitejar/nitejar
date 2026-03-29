import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { findGoalById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'
import { ScrollArea } from '@/components/ui/scroll-area'

const GoalDetailClient = loadable(
  () => import('./GoalDetailClient').then((mod) => mod.GoalDetailClient),
  {
    loading: () => <RouteClientFallback label="Loading goal..." className="min-h-[480px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const goal = await findGoalById(id)
  return createPageMetadata(goal?.title ?? 'Goal')
}

export default async function GoalDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="-mx-2 -mt-2 -mb-4 flex min-h-0 flex-1 flex-col overflow-hidden sm:-mx-6 sm:-mt-4 sm:-mb-6">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pt-2 pb-4 sm:px-6 sm:pt-4 sm:pb-6">
          <GoalDetailClient goalId={id} />
        </div>
      </ScrollArea>
    </div>
  )
}
