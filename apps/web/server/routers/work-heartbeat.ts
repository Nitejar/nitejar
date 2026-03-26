export type GoalHeartbeatMode = 'execution' | 'oversight'

export type GoalHeartbeatPromptDescendant = {
  id: string
  title: string
  outcome: string
  ownerLabel?: string | null
  ownerTitle?: string | null
  latestUpdate?: string | null
  hasActiveHeartbeat: boolean
}

export type GoalHeartbeatPromptInput = {
  goalId: string
  title: string
  outcome: string
  assignedAgentName: string
  assignedAgentTitle?: string | null
  goalOwnerLabel?: string | null
  goalOwnerTitle?: string | null
  descendants: GoalHeartbeatPromptDescendant[]
}

function formatActorWithTitle(label?: string | null, title?: string | null): string | null {
  if (!label) return null
  return title ? `${label} (${title})` : label
}

function truncateReceipt(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed
}

export function determineGoalHeartbeatMode(
  descendants: GoalHeartbeatPromptDescendant[]
): GoalHeartbeatMode {
  return descendants.some((descendant) => descendant.hasActiveHeartbeat) ? 'oversight' : 'execution'
}

export function buildGoalHeartbeatPrompt(input: GoalHeartbeatPromptInput): string {
  const mode = determineGoalHeartbeatMode(input.descendants)
  const actingOwner = formatActorWithTitle(input.assignedAgentName, input.assignedAgentTitle)
  const goalOwner = formatActorWithTitle(input.goalOwnerLabel, input.goalOwnerTitle)
  const activeDescendants = input.descendants.filter((descendant) => descendant.hasActiveHeartbeat)
  const descendantLines = activeDescendants.slice(0, 6).map((descendant) => {
    const owner = formatActorWithTitle(descendant.ownerLabel, descendant.ownerTitle)
    const receipt = truncateReceipt(descendant.latestUpdate)
    const detailBits = [
      owner ? `owner: ${owner}` : null,
      receipt ? `latest receipt: "${receipt}"` : null,
    ].filter(Boolean)
    return `- ${descendant.id} — "${descendant.title}"${detailBits.length > 0 ? ` (${detailBits.join(' · ')})` : ''}`
  })

  const lines = [
    `You are running the recurring stewardship loop for goal ${input.goalId}: "${input.title}".`,
    `Goal outcome: ${input.outcome}`,
  ]

  if (actingOwner && goalOwner && actingOwner === goalOwner) {
    lines.push(`Acting owner: ${actingOwner}.`)
  } else if (actingOwner) {
    lines.push(`Acting steward: ${actingOwner}.`)
  }

  if (goalOwner && goalOwner !== actingOwner) {
    lines.push(`Goal owner: ${goalOwner}.`)
  }

  lines.push('')

  if (mode === 'oversight') {
    lines.push(
      'Stewardship mode: oversight. One or more descendant goals already have active stewardship loops, so this run should coordinate the branch instead of duplicating local execution.'
    )
    if (descendantLines.length > 0) {
      lines.push('Active descendant stewardship:')
      lines.push(...descendantLines)
      lines.push('')
    }
    lines.push('Review branch health before you summarize it:')
    lines.push(
      `- Use query_activity with query="${input.title} stewardship heartbeat" and max_age_minutes=1440 to inspect recent descendant activity and receipts.`
    )
    lines.push(
      '- Use the descendant coverage list above to identify stale, blocked, or ownerless branches.'
    )
    lines.push(
      '- Only inspect descendant tickets with search_tickets when a branch looks stalled, blocked, under-covered, or missing recent activity.'
    )
    lines.push(
      '- Use get_ticket only on tickets that appear risky, blocked, stale, cross-goal, or expensive.'
    )
    lines.push('')
    lines.push(
      `Then post exactly one heartbeat update with post_work_update using goal_id="${input.goalId}" and kind="heartbeat".`
    )
    lines.push(
      'Focus on descendant posture, missing coverage, cross-goal blockers, escalation risk, and the next coordination move.'
    )
    lines.push(
      'Do not re-triage healthy descendant ticket queues when those descendants already have active stewardship.'
    )
    return lines.join('\n')
  }

  lines.push(
    'Stewardship mode: execution. No descendant goals currently have active stewardship loops, so this run owns the local execution pulse for the goal.'
  )
  lines.push('')
  lines.push('Review the active work before you summarize it:')
  lines.push(
    `- Use query_activity with query="${input.title} ${input.goalId}" and max_age_minutes=1440 to inspect recent activity and avoid repeating work.`
  )
  lines.push(
    `- Use search_tickets with goal_id="${input.goalId}" and status="ready,in_progress,blocked".`
  )
  lines.push('- Use get_ticket on any ticket that looks important, blocked, stale, or expensive.')
  lines.push('')
  lines.push(
    `Then post exactly one heartbeat update with post_work_update using goal_id="${input.goalId}" and kind="heartbeat".`
  )
  lines.push(
    'The update should cover current progress, blockers, workload risk, and the next concrete move.'
  )
  lines.push('Keep it concise and human-readable.')
  return lines.join('\n')
}
