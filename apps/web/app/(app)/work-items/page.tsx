import Link from 'next/link'
import { listWorkItems, getCostByWorkItems } from '@nitejar/database'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '../components/PageHeader'
import { formatCost } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const statusVariant = (status: string) => {
  switch (status) {
    case 'RUNNING':
      return 'default'
    case 'DONE':
    case 'COMPLETED':
      return 'secondary'
    case 'FAILED':
      return 'destructive'
    case 'NEEDS_APPROVAL':
      return 'outline'
    case 'CANCELED':
      return 'outline'
    default:
      return 'outline'
  }
}

export default async function WorkItemsPage() {
  const workItems = await listWorkItems(100)
  const costData = await getCostByWorkItems(workItems.map((w) => w.id))
  const costMap = new Map(costData.map((c) => [c.work_item_id, c]))

  return (
    <div className="space-y-6">
      <PageHeader
        category="Debug"
        title="Event Log"
        description="Raw event log for debugging agent actions."
      />

      {workItems.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle>No work items yet</CardTitle>
            <CardDescription>
              Plugin instances, chat, cron, and heartbeats will surface here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="bg-card/70">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workItems.map((item) => {
                  const cost = costMap.get(item.id)
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>
                          {item.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-sm font-medium text-foreground">
                        <Link href={`/work-items/${item.id}`} className="hover:text-primary">
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground">{item.source}</span>
                          <span className="text-[0.65rem] text-muted-foreground">
                            {item.source_ref}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {cost ? formatCost(cost.total_cost) : '\u2014'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {new Date(item.updated_at * 1000).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
