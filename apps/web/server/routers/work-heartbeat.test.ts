import { describe, expect, it } from 'vitest'

import {
  buildGoalHeartbeatPrompt,
  determineGoalHeartbeatMode,
  type GoalHeartbeatPromptInput,
} from './work-heartbeat'

function makeInput(overrides?: Partial<GoalHeartbeatPromptInput>): GoalHeartbeatPromptInput {
  return {
    goalId: 'goal-parent',
    title: 'Stabilize onboarding',
    outcome: 'New customers activate without manual intervention.',
    assignedAgentName: 'Avery',
    assignedAgentTitle: 'Chief of Staff',
    goalOwnerLabel: 'Avery',
    goalOwnerTitle: 'Chief of Staff',
    descendants: [],
    ...overrides,
  }
}

describe('goal heartbeat prompt helpers', () => {
  it('uses execution mode when there are no active descendant stewardship loops', () => {
    const input = makeInput({
      descendants: [
        {
          id: 'goal-child',
          title: 'Ship welcome flow',
          outcome: 'Welcome sequence is live.',
          ownerLabel: 'Riley',
          ownerTitle: 'Release Steward',
          latestUpdate: 'Drafted the rollout checklist.',
          hasActiveHeartbeat: false,
        },
      ],
    })

    expect(determineGoalHeartbeatMode(input.descendants)).toBe('execution')

    const prompt = buildGoalHeartbeatPrompt(input)
    expect(prompt).toContain('Stewardship mode: execution.')
    expect(prompt).toContain('Use search_tickets with goal_id="goal-parent"')
    expect(prompt).toContain('Acting owner: Avery (Chief of Staff).')
    expect(prompt).not.toContain('Goal owner:')
    expect(prompt).not.toContain('Do not re-triage healthy descendant ticket queues')
  })

  it('switches to oversight mode when a descendant already has active stewardship', () => {
    const input = makeInput({
      descendants: [
        {
          id: 'goal-child-a',
          title: 'Launch workspace invites',
          outcome: 'Invites land without manual QA.',
          ownerLabel: 'Riley',
          ownerTitle: 'Release Steward',
          latestUpdate: 'Heartbeat flagged a flaky permission sync and opened a follow-up ticket.',
          hasActiveHeartbeat: true,
        },
        {
          id: 'goal-child-b',
          title: 'Tighten first-run docs',
          outcome: 'Every path has current copy.',
          ownerLabel: 'Morgan',
          ownerTitle: 'Documentation Steward',
          latestUpdate: 'Docs sweep is waiting on product copy.',
          hasActiveHeartbeat: false,
        },
      ],
    })

    expect(determineGoalHeartbeatMode(input.descendants)).toBe('oversight')

    const prompt = buildGoalHeartbeatPrompt(input)
    expect(prompt).toContain('Stewardship mode: oversight.')
    expect(prompt).toContain('Active descendant stewardship:')
    expect(prompt).toContain('goal-child-a')
    expect(prompt).toContain('owner: Riley (Release Steward)')
    expect(prompt).toContain('latest receipt:')
    expect(prompt).toContain('Use query_activity')
    expect(prompt).toContain('Acting owner: Avery (Chief of Staff).')
    expect(prompt).toContain('Do not re-triage healthy descendant ticket queues')
    expect(prompt).not.toContain('Use search_tickets with goal_id="goal-parent"')
  })
})
