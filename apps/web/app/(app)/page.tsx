import { createPageMetadata } from '@/app/metadata'
import { AdminHome } from './AdminHome'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Command Center')

export default function AdminPage() {
  return <AdminHome />
}
