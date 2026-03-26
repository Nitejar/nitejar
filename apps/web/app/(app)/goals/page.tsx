import { createPageMetadata } from '@/app/metadata'
import { GoalsClient } from './GoalsClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Goals')

export default function GoalsPage() {
  return <GoalsClient />
}
