import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { RouteClientFallback } from './components/RouteClientFallback'

const AdminHome = loadable(() => import('./AdminHome').then((mod) => mod.AdminHome), {
  loading: () => (
    <RouteClientFallback label="Loading command center..." className="min-h-[480px]" />
  ),
})

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Command Center')

export default function AdminPage() {
  return <AdminHome />
}
