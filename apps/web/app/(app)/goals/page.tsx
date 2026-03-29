import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from '../components/RouteClientFallback'

const GoalsClient = loadable(() => import('./GoalsClient').then((mod) => mod.GoalsClient), {
  loading: () => <RouteClientFallback label="Loading goals..." className="min-h-[480px]" />,
})

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Goals')

export default function GoalsPage() {
  return <GoalsClient />
}
