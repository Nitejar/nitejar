import { createPageMetadata } from '@/app/metadata'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Company')

export default function CompanyPage() {
  redirect('/company/structure')
}
