'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type TeamFormValues = {
  name: string
  charter?: string
  slug?: string
}

interface CreateTeamFormProps {
  onSuccess?: () => void
}

export function CreateTeamForm({ onSuccess }: CreateTeamFormProps) {
  const utils = trpc.useUtils()

  const createTeam = trpc.org.createTeam.useMutation({
    onSuccess: () => {
      void utils.org.listTeams.invalidate()
      teamForm.reset({ name: '', charter: '', slug: '' })
      onSuccess?.()
    },
    onError: () => {
      toast.error('Failed to create team')
    },
  })

  const teamForm = useForm<TeamFormValues>({
    defaultValues: { name: '', charter: '', slug: '' },
  })
  const { setValue, watch, formState } = teamForm
  const nameValue = watch('name')

  useEffect(() => {
    if (formState.dirtyFields.slug) return
    const slug = nameValue
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    setValue('slug', slug, { shouldDirty: false })
  }, [formState.dirtyFields.slug, nameValue, setValue])

  const handleCreateTeam = teamForm.handleSubmit((values: TeamFormValues) => {
    createTeam.mutate({
      name: values.name.trim(),
      charter: values.charter?.trim() || null,
      slug: values.slug?.trim() || null,
    })
  })

  return (
    <form onSubmit={handleCreateTeam} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Name</Label>
        <Input {...teamForm.register('name', { required: true })} placeholder="Core Operators" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Charter</Label>
        <Input {...teamForm.register('charter')} placeholder="What this team owns" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Slug</Label>
        <Input
          {...teamForm.register('slug')}
          placeholder="core-operators"
          className="font-mono text-sm"
        />
      </div>
      <Button type="submit" disabled={createTeam.isPending} className="w-full">
        {createTeam.isPending ? 'Creating...' : 'Create team'}
      </Button>
    </form>
  )
}
