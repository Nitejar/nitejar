'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { IdentityBadge } from '@/app/(app)/components/IdentityBadge'
import { IconDatabase, IconInfoCircle, IconTrash, IconPlus, IconLoader2 } from '@tabler/icons-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const FIELD_TYPES = ['string', 'number', 'boolean', 'datetime', 'enum', 'longtext'] as const

type FieldDraft = {
  key: string
  name: string
  type: string
  required: boolean
  description: string
  enumValues: string
}

type EditForm = {
  collectionId: string
  name: string
  description: string
  fields: FieldDraft[]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LabelWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label>{label}</Label>
      <Tooltip>
        <TooltipTrigger className="cursor-default text-muted-foreground">
          <IconInfoCircle className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function SchemaFieldsTable({
  fields,
}: {
  fields: Array<{
    name: string
    type: string
    required?: boolean
    description?: string | null
    enumValues?: string[]
  }>
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No fields defined.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Required</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Enum Values</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name} className="border-b border-white/5">
              <td className="px-3 py-2 font-mono text-xs">{field.name}</td>
              <td className="px-3 py-2">
                <Badge variant="secondary" className="text-[11px]">
                  {field.type}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.required ? 'Yes' : '\u2014'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.description || '\u2014'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.enumValues?.join(', ') || '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FieldBuilderRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: FieldDraft
  onChange: (updated: FieldDraft) => void
  onRemove: () => void
}) {
  return (
    <div className="grid items-start gap-2 rounded-lg border border-white/10 p-3 md:grid-cols-[1fr_120px_60px_1fr_1fr_40px]">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Name</Label>
        <Input
          className="font-mono text-xs"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="field_name"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Type</Label>
        <Select
          value={draft.type}
          onValueChange={(value) => {
            if (value) onChange({ ...draft, type: value })
          }}
        >
          <SelectTrigger className="text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Req</Label>
        <div className="flex h-9 items-center">
          <Switch
            size="sm"
            checked={draft.required}
            onCheckedChange={(checked) => onChange({ ...draft, required: checked })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Description</Label>
        <Input
          className="text-xs"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder="Optional"
        />
      </div>
      {draft.type === 'enum' ? (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Enum Values</Label>
          <Input
            className="text-xs"
            value={draft.enumValues}
            onChange={(e) => onChange({ ...draft, enumValues: e.target.value })}
            placeholder="val1, val2, val3"
          />
        </div>
      ) : (
        <div />
      )}
      <div className="flex h-full items-end pb-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <IconTrash className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function AccessLevelPicker({
  value,
  onChange,
}: {
  value: 'read' | 'readwrite'
  onChange: (level: 'read' | 'readwrite') => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        className={cn(
          'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
          value === 'read'
            ? 'border-primary bg-primary/5'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
        )}
        onClick={() => onChange('read')}
      >
        <div
          className={cn(
            'text-sm font-medium',
            value === 'read' ? 'text-foreground' : 'text-foreground/80'
          )}
        >
          Read Only
        </div>
        <div className="text-xs text-muted-foreground">
          Can query rows but not insert or update.
        </div>
      </button>
      <button
        type="button"
        className={cn(
          'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
          value === 'readwrite'
            ? 'border-primary bg-primary/5'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
        )}
        onClick={() => onChange('readwrite')}
      >
        <div
          className={cn(
            'text-sm font-medium',
            value === 'readwrite' ? 'text-foreground' : 'text-foreground/80'
          )}
        >
          Read &amp; Write
        </div>
        <div className="text-xs text-muted-foreground">
          Full access to query, insert, and update rows.
        </div>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20

export function CollectionDetailClient({ collectionId }: { collectionId: string }) {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'data'

  const [tab, setTab] = useState(initialTab)
  const [page, setPage] = useState(0)

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<EditForm | null>(null)

  // Review dialog
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  // Grant permission dialog
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantAgentId, setGrantAgentId] = useState('')
  const [grantAccessLevel, setGrantAccessLevel] = useState<'read' | 'readwrite'>('read')

  // Revoke permission alert
  const [revokeTarget, setRevokeTarget] = useState<{
    collectionId: string
    agentId: string
    agentName: string
  } | null>(null)

  // -- Queries
  const utils = trpc.useUtils()
  const collectionQuery = trpc.collections.getById.useQuery({ collectionId })
  const agentsQuery = trpc.org.listAgents.useQuery()

  const rowsQuery = trpc.collections.listRows.useQuery(
    { collectionId, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { enabled: tab === 'data' }
  )

  const reviewsQuery = trpc.collections.listSchemaReviews.useQuery(
    { collectionId, limit: 100 },
    { enabled: tab === 'reviews' }
  )

  // -- Mutations
  const updateSchemaMutation = trpc.collections.updateSchema.useMutation({
    onSuccess: () => {
      toast.success('Collection updated')
      void utils.collections.getById.invalidate({ collectionId })
      void utils.collections.listCollections.invalidate()
      setEditOpen(false)
      setEditForm(null)
    },
    onError: (error) => toast.error(error.message),
  })

  const reviewMutation = trpc.collections.reviewSchemaRequest.useMutation({
    onSuccess: () => {
      toast.success('Schema review updated')
      void utils.collections.listSchemaReviews.invalidate()
      void utils.collections.getById.invalidate({ collectionId })
      void utils.collections.listCollections.invalidate()
      setReviewOpen(false)
      setReviewTargetId(null)
      setReviewNotes('')
    },
    onError: (error) => toast.error(error.message),
  })

  const setPermissionMutation = trpc.collections.setPermission.useMutation({
    onSuccess: () => {
      toast.success('Permission granted')
      void utils.collections.getById.invalidate({ collectionId })
      void utils.collections.listCollections.invalidate()
      setGrantOpen(false)
      setGrantAgentId('')
      setGrantAccessLevel('read')
    },
    onError: (error) => toast.error(error.message),
  })

  const removePermissionMutation = trpc.collections.removePermission.useMutation({
    onSuccess: () => {
      toast.success('Permission revoked')
      void utils.collections.getById.invalidate({ collectionId })
      void utils.collections.listCollections.invalidate()
      setRevokeTarget(null)
    },
    onError: (error) => toast.error(error.message),
  })

  // -- Computed
  const collection = collectionQuery.data ?? null
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data])
  const reviews = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data])

  const reviewTarget = useMemo(
    () => reviews.find((r) => r.id === reviewTargetId) ?? null,
    [reviews, reviewTargetId]
  )

  const availableAgentsForGrant = useMemo(() => {
    if (!collection) return agents
    return agents.filter((agent) => !collection.permissions.some((p) => p.agentId === agent.id))
  }, [agents, collection])

  // Pagination
  const totalRows = rowsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const rowStart = page * PAGE_SIZE + 1
  const rowEnd = Math.min((page + 1) * PAGE_SIZE, totalRows)

  // -- Handlers
  const openEditDialog = () => {
    if (!collection) return
    setEditForm({
      collectionId: collection.id,
      name: collection.name,
      description: collection.description ?? '',
      fields: collection.schema.fields.map((f, i) => ({
        key: `f-${i}`,
        name: f.name,
        type: f.type,
        required: f.required ?? false,
        description: f.description ?? '',
        enumValues: f.enumValues?.join(', ') ?? '',
      })),
    })
    setEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editForm) return
    const schema = {
      fields: editForm.fields.map((f) => ({
        name: f.name.trim(),
        type: f.type,
        required: f.required,
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        ...(f.type === 'enum'
          ? {
              enumValues: f.enumValues
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
            }
          : {}),
      })),
    }
    await updateSchemaMutation.mutateAsync({
      collectionId: editForm.collectionId,
      name: editForm.name.trim(),
      description: editForm.description.trim() || null,
      schema,
    })
  }

  const addField = () => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      fields: [
        ...editForm.fields,
        {
          key: `f-${Date.now()}`,
          name: '',
          type: 'string',
          required: false,
          description: '',
          enumValues: '',
        },
      ],
    })
  }

  const updateField = (index: number, updated: FieldDraft) => {
    if (!editForm) return
    const fields = [...editForm.fields]
    fields[index] = updated
    setEditForm({ ...editForm, fields })
  }

  const removeField = (index: number) => {
    if (!editForm) return
    const fields = editForm.fields.filter((_, i) => i !== index)
    setEditForm({ ...editForm, fields })
  }

  const openReviewDialog = (reviewId: string) => {
    setReviewTargetId(reviewId)
    setReviewNotes('')
    setReviewOpen(true)
  }

  const openGrantDialog = () => {
    setGrantAgentId('')
    setGrantAccessLevel('read')
    setGrantOpen(true)
  }

  const handleGrantPermission = async () => {
    if (!collection || !grantAgentId) return
    await setPermissionMutation.mutateAsync({
      collectionId: collection.id,
      agentId: grantAgentId,
      canRead: true,
      canWrite: grantAccessLevel === 'readwrite',
    })
  }

  // -- Loading / not found
  if (collectionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (collectionQuery.error || !collection) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">Collection not found.</p>
        <Link href="/collections" className="mt-2 text-xs text-primary hover:underline">
          Back to collections
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={collection.name}
          description={`${collection.description ?? 'No description.'} \u00b7 v${collection.schema_version}`}
          backLink={{ href: '/collections', label: 'Collections' }}
        />
        <Button variant="outline" size="sm" className="mt-5 shrink-0" onClick={openEditDialog}>
          Edit Collection
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="reviews">
            Reviews
            {collection.pendingReviewCount > 0 && (
              <Badge
                variant="outline"
                className="ml-1.5 border-amber-500/30 text-[10px] text-amber-400"
              >
                {collection.pendingReviewCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Data tab */}
        <TabsContent value="data" className="mt-4">
          {rowsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : totalRows === 0 ? (
            <Empty className="py-8">
              <EmptyMedia variant="icon">
                <IconDatabase />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No data yet</EmptyTitle>
                <EmptyDescription>
                  Agents populate collections using the{' '}
                  <code className="text-xs">insert_collection_row</code> and{' '}
                  <code className="text-xs">upsert_collection_row</code> tools.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
                    <tr>
                      {collection.schema.fields
                        .filter((f) => f.type !== 'longtext')
                        .map((f) => (
                          <th key={f.name} className="px-3 py-2 font-mono">
                            {f.name}
                          </th>
                        ))}
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rowsQuery.data?.rows ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-white/5">
                        {collection.schema.fields
                          .filter((f) => f.type !== 'longtext')
                          .map((f) => (
                            <td key={f.name} className="max-w-[200px] truncate px-3 py-2 text-xs">
                              {row.values[f.name] != null ? String(row.values[f.name]) : '\u2014'}
                            </td>
                          ))}
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <RelativeTime timestamp={row.updated_at} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {rowStart}&ndash;{rowEnd} of {totalRows} row
                  {totalRows !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Schema tab */}
        <TabsContent value="schema" className="mt-4">
          <SchemaFieldsTable fields={collection.schema.fields} />
        </TabsContent>

        {/* Permissions tab */}
        <TabsContent value="permissions" className="mt-4 space-y-4">
          {collection.permissions.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>Open access</EmptyTitle>
                <EmptyDescription>
                  No explicit permissions are set. Any agent can read and write to this collection.
                  Grant access to specific agents to restrict it.
                </EmptyDescription>
              </EmptyHeader>
              <Button size="sm" onClick={openGrantDialog}>
                Grant Access
              </Button>
            </Empty>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Access</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collection.permissions.map((perm) => (
                      <tr key={perm.agentId} className="border-b border-white/5">
                        <td className="px-3 py-2">
                          <IdentityBadge
                            name={perm.agentName}
                            subtitle={`@${perm.agentHandle}`}
                            size="sm"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5">
                            {perm.canRead && (
                              <Badge variant="secondary" className="text-[11px]">
                                read
                              </Badge>
                            )}
                            {perm.canWrite && (
                              <Badge variant="secondary" className="text-[11px]">
                                write
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={removePermissionMutation.isPending}
                            onClick={() =>
                              setRevokeTarget({
                                collectionId: collection.id,
                                agentId: perm.agentId,
                                agentName: perm.agentName,
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={openGrantDialog}>
                  Grant Access
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* Reviews tab */}
        <TabsContent value="reviews" className="mt-4 space-y-3">
          {reviewsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schema reviews for this collection.</p>
          ) : (
            reviews.map((review) => (
              <div
                key={review.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px] uppercase',
                        review.status === 'pending' && 'border-amber-500/30 text-amber-400',
                        review.status === 'approved' && 'border-emerald-500/30 text-emerald-400',
                        review.status === 'rejected' && 'border-red-500/30 text-red-400'
                      )}
                    >
                      {review.action}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px]',
                        review.status === 'pending' && 'border-amber-500/30 text-amber-400',
                        review.status === 'approved' && 'border-emerald-500/30 text-emerald-400',
                        review.status === 'rejected' && 'border-red-500/30 text-red-400'
                      )}
                    >
                      {review.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requested by @{review.requester.handle}
                    {review.reviewed_at && (
                      <>
                        {' '}
                        &middot; reviewed <RelativeTime timestamp={review.reviewed_at} />
                      </>
                    )}
                    {!review.reviewed_at && (
                      <>
                        {' '}
                        &middot; <RelativeTime timestamp={review.created_at} />
                      </>
                    )}
                  </p>
                </div>
                {review.status === 'pending' && (
                  <Button variant="outline" size="sm" onClick={() => openReviewDialog(review.id)}>
                    Review
                  </Button>
                )}
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Collection Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>
              Update the collection name, description, and schema fields.
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Basics
                </legend>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      className="font-mono"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder="Optional description"
                    />
                  </div>
                </div>
              </fieldset>

              <hr className="border-white/10" />

              <fieldset className="space-y-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Schema Fields
                </legend>
                <div className="space-y-2">
                  {editForm.fields.map((field, i) => (
                    <FieldBuilderRow
                      key={field.key}
                      draft={field}
                      onChange={(updated) => updateField(i, updated)}
                      onRemove={() => removeField(i)}
                    />
                  ))}
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={addField}>
                  <IconPlus className="size-3.5" />
                  Add Field
                </Button>
              </fieldset>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleSaveEdit()}
                  disabled={updateSchemaMutation.isPending}
                >
                  {updateSchemaMutation.isPending ? 'Saving\u2026' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Review Detail Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {reviewTarget && (
            <>
              <DialogHeader>
                <DialogTitle>
                  @{reviewTarget.requester.handle} wants to {reviewTarget.action} collection &ldquo;
                  {reviewTarget.collection_name}&rdquo;
                </DialogTitle>
                <DialogDescription>
                  {reviewTarget.proposed_description || 'No description provided.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Proposed Schema</Label>
                  <SchemaFieldsTable fields={reviewTarget.proposed_schema.fields} />
                </div>

                <div className="space-y-2">
                  <LabelWithHint
                    label="Reviewer Notes"
                    hint="Optional notes about this decision. Visible to the requesting agent."
                  />
                  <Textarea
                    rows={3}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add notes about this decision..."
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setReviewOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({
                        reviewId: reviewTarget.id,
                        decision: 'reject',
                        notes: reviewNotes || undefined,
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({
                        reviewId: reviewTarget.id,
                        decision: 'approve',
                        notes: reviewNotes || undefined,
                      })
                    }
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Grant Permission Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grant Access</DialogTitle>
            <DialogDescription>
              Choose an agent and access level for &ldquo;{collection.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Agent</Label>
              <Select value={grantAgentId} onValueChange={(value) => setGrantAgentId(value ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {availableAgentsForGrant.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} (@{agent.handle})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Access Level</Label>
              <AccessLevelPicker value={grantAccessLevel} onChange={setGrantAccessLevel} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGrantOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!grantAgentId || setPermissionMutation.isPending}
                onClick={() => void handleGrantPermission()}
              >
                {setPermissionMutation.isPending ? 'Granting\u2026' : 'Grant Access'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke Permission AlertDialog */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all permissions for {revokeTarget?.agentName} on this collection. The
              agent will fall back to open access rules if no other permissions are set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removePermissionMutation.isPending}
              onClick={() => {
                if (revokeTarget) {
                  removePermissionMutation.mutate({
                    collectionId: revokeTarget.collectionId,
                    agentId: revokeTarget.agentId,
                  })
                }
              }}
            >
              {removePermissionMutation.isPending ? 'Revoking\u2026' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
