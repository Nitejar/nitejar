import { createAgent, createWorkUpdate, getDb } from '../packages/database/src/index.ts'

const PREFIX = 'ws8-scale'
const TEAM_SIZE = 10

const PARENT_TEAM_DEFINITIONS = [
  {
    key: 'company',
    parentKey: null,
    name: 'Nitejar Inc',
    charter:
      'Nitejar builds the operating system for self-hosted AI agent fleets. The mission is to give every team a controllable, observable fleet of agents that do real work across channels. Success means users trust their agents enough to let them run unsupervised.',
  },
  {
    key: 'engineering',
    parentKey: 'company',
    name: 'Engineering',
    charter:
      'Owns the agent runtime, plugin system, inference routing, database layer, and API surface. Ships the core platform that agents execute on. Success means agents run reliably, plugins connect cleanly, and the API contract stays stable across releases.',
  },
  {
    key: 'product',
    parentKey: 'company',
    name: 'Product',
    charter:
      'Owns the features users interact with: Command Center, Sessions, the agent builder, Skills, Collections, and Evals. Responsible for shipping what users see and making sure each release lands with docs, changelogs, and support readiness.',
  },
  {
    key: 'revenue',
    parentKey: 'company',
    name: 'Revenue',
    charter:
      "Grows Nitejar's user base from trial to paid and from paid to expanded. Owns the funnel from first signup through first deployed agent fleet, renewal cycles, and upsell into higher-tier plans.",
  },
  {
    key: 'operations',
    parentKey: 'company',
    name: 'Operations',
    charter:
      'Keeps the Nitejar platform running: agent execution sandboxes, inference cost controls, queue health, and deploy pipeline. Success means agents stay up, costs stay predictable, and incidents get resolved before users notice.',
  },
  {
    key: 'strategy',
    parentKey: 'company',
    name: 'Strategy',
    charter:
      "Owns Nitejar's positioning in the AI agent market. Tracks competitors like CrewAI, AutoGPT, and n8n. Frames company posture for the board, shapes pricing response, and feeds growth bets with concrete research.",
  },
] as const

const TEAM_DEFINITIONS = [
  {
    key: 'revenue-ops',
    parentTeam: 'revenue',
    name: 'Revenue Ops',
    charter:
      'Converts trials into paying users and manages subscription renewals and expansions. Owns the path from first signup to first deployed agent, then keeps accounts healthy through renewal cycles and upgrade nudges.',
    agents: [
      { name: 'Closer', title: 'Deal closer', emoji: '💼' },
      { name: 'Piper', title: 'Pipeline analyst', emoji: '📈' },
      { name: 'Onboard', title: 'Onboarding specialist', emoji: '📎' },
      { name: 'Pricer', title: 'Pricing desk', emoji: '🧾' },
      { name: 'Forecast', title: 'Revenue forecaster', emoji: '📊' },
      { name: 'Renew', title: 'Renewal ops', emoji: '🔄' },
      { name: 'Churn Watch', title: 'Churn prevention', emoji: '🛡️' },
      { name: 'Expand', title: 'Expansion specialist', emoji: '🚀' },
      { name: 'Quota', title: 'Quota tracker', emoji: '🎯' },
      { name: 'Ledger', title: 'Billing reconciliation', emoji: '🧮' },
    ],
  },
  {
    key: 'product-delivery',
    parentTeam: 'product',
    name: 'Product Delivery',
    charter:
      'Ships Nitejar features end-to-end: specs, builds, QA, release gates, and changelogs. Coordinates across docs, support, and marketing so launches land cleanly instead of creating reactive cleanup.',
    agents: [
      { name: 'Shipper', title: 'Release captain', emoji: '🚢' },
      { name: 'Specwright', title: 'Spec writer', emoji: '📝' },
      { name: 'Launcher', title: 'Launch coordinator', emoji: '🎯' },
      { name: 'Bugcatcher', title: 'Bug triage', emoji: '🐞' },
      { name: 'QA Sweep', title: 'Quality assurance', emoji: '🧪' },
      { name: 'Flagbearer', title: 'Feature flag ops', emoji: '🏁' },
      { name: 'Changelog', title: 'Release notes', emoji: '📋' },
      { name: 'Rollback', title: 'Rollback monitor', emoji: '⏪' },
      { name: 'Dogfood', title: 'Internal testing', emoji: '🍖' },
      { name: 'Gatekeeper', title: 'Ship-readiness check', emoji: '🚦' },
    ],
  },
  {
    key: 'platform-reliability',
    parentTeam: 'operations',
    name: 'Platform Reliability',
    charter:
      "Keeps Nitejar's infrastructure healthy: agent sandboxes, inference routing, queue throughput, and the deploy pipeline. Runs incident response, manages infra spend, and makes sure weekend traffic spikes don't become Monday fires.",
    agents: [
      { name: 'Uptime', title: 'Runtime monitor', emoji: '🛰️' },
      { name: 'Incident', title: 'Incident commander', emoji: '🚨' },
      { name: 'Costwatch', title: 'Infra cost guard', emoji: '💸' },
      { name: 'Firehose', title: 'Queue triage', emoji: '🧯' },
      { name: 'Wrench', title: 'Recovery ops', emoji: '🔧' },
      { name: 'Canary', title: 'Deploy canary', emoji: '🐤' },
      { name: 'Pager', title: 'On-call router', emoji: '📟' },
      { name: 'Postmortem', title: 'Incident review', emoji: '📓' },
      { name: 'Scaler', title: 'Autoscale ops', emoji: '📏' },
      { name: 'Sentinel', title: 'Security watch', emoji: '🔒' },
    ],
  },
  {
    key: 'customer-success',
    parentTeam: 'revenue',
    name: 'Customer Success',
    charter:
      'Helps users get real value from their agent fleet. Owns support queues, escalation handling, and adoption coaching: agent configuration, skill authoring, plugin setup, and getting users past their first working workflow.',
    agents: [
      { name: 'Frontline', title: 'Support triage', emoji: '🎧' },
      { name: 'Escalator', title: 'Escalation handler', emoji: '📬' },
      { name: 'Adopter', title: 'Adoption coach', emoji: '🤝' },
      { name: 'Pulse', title: 'NPS & sentiment', emoji: '⭐' },
      { name: 'Inbox Zero', title: 'Queue cleaner', emoji: '📥' },
      { name: 'Handoff', title: 'Cross-team handoff', emoji: '🤲' },
      { name: 'Winback', title: 'Re-engagement', emoji: '💌' },
      { name: 'Onramp', title: 'New user guide', emoji: '🛤️' },
      { name: 'Feedback', title: 'Feature request triage', emoji: '💡' },
      { name: 'SLA Watch', title: 'SLA compliance', emoji: '⏱️' },
    ],
  },
  {
    key: 'market-intelligence',
    parentTeam: 'strategy',
    name: 'Market Intelligence',
    charter:
      "Tracks the AI agent market: competitors like CrewAI, AutoGPT, and n8n, emerging patterns, and pricing shifts. Produces research briefs, competitive positioning, and outbound content that keeps Nitejar's narrative ahead of the market.",
    agents: [
      { name: 'Scanner', title: 'Signal detection', emoji: '🔭' },
      { name: 'Rival', title: 'Competitor analyst', emoji: '🗺️' },
      { name: 'Megaphone', title: 'Campaign ops', emoji: '📣' },
      { name: 'Analyst', title: 'Research briefs', emoji: '🧠' },
      { name: 'Lookout', title: 'Partner watch', emoji: '🕯️' },
      { name: 'Trendline', title: 'Trend forecaster', emoji: '📉' },
      { name: 'Narrator', title: 'Narrative writer', emoji: '✍️' },
      { name: 'Source', title: 'Data sourcing', emoji: '🔗' },
      { name: 'Benchmark', title: 'Industry benchmarks', emoji: '📐' },
      { name: 'Brief', title: 'Executive briefings', emoji: '📎' },
    ],
  },
] as const

const INITIATIVE_DEFINITIONS = [
  {
    key: 'revenue-activation',
    parentKey: null,
    title: 'Revenue activation',
    description:
      'Bring onboarding, renewals, and follow-up back inside a predictable operating window.',
    status: 'active',
    team: 'revenue-ops',
    targetLabel: 'Q2 2026',
  },
  {
    key: 'launch-discipline',
    parentKey: null,
    title: 'Launch discipline',
    description: 'Make launches legible across product, docs, support, and release gates.',
    status: 'at_risk',
    team: 'product-delivery',
    targetLabel: 'Q2 2026',
  },
  {
    key: 'runtime-discipline',
    parentKey: null,
    title: 'Runtime discipline',
    description: 'Reduce queue volatility, incident drag, and surprise infrastructure spend.',
    status: 'active',
    team: 'platform-reliability',
    targetLabel: 'H1 2026',
  },
  {
    key: 'support-receipts',
    parentKey: null,
    title: 'Support receipts',
    description:
      'Turn support chaos into governed work with visible blocked-state and ownership receipts.',
    status: 'active',
    team: 'customer-success',
    targetLabel: 'Q2 2026',
  },
  {
    key: 'board-readiness',
    parentKey: null,
    title: 'Board readiness',
    description:
      'Frame company posture in a way executives can understand without opening five tools.',
    status: 'active',
    team: 'market-intelligence',
    targetLabel: 'Board meeting',
  },
  {
    key: 'growth-governance',
    parentKey: 'board-readiness',
    title: 'Growth governance',
    description:
      'Attach ownership and operating discipline to research, experiments, and pricing response.',
    status: 'at_risk',
    team: 'market-intelligence',
    targetLabel: 'Q2 2026',
  },
] as const

const SCENARIOS = [
  {
    title: 'Stop enterprise onboarding from slipping past seven days',
    outcome: 'Enterprise customers hit first value inside one week instead of stalling in setup.',
    status: 'active',
    team: 'revenue-ops',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'Onboarding handoffs are moving; the remaining risk is legal review speed, not staffing.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 3, blocked: 0, done: 2 },
    progress: { source: 'number', current: 4.2, target: 7, unit: 'days avg' },
  },
  {
    title: 'Recover stalled renewals in the 20k to 50k ARR band',
    outcome: 'Renewal leakage drops before quarter close and account plans stop going dark.',
    status: 'at_risk',
    team: 'revenue-ops',
    owner: 'user',
    coverage: 'thin',
    heartbeat: 'Renewal work is thinly staffed and the legal queue is eating response time.',
    ticketPlan: { inbox: 1, ready: 2, in_progress: 1, blocked: 2, done: 1 },
    progress: { source: 'currency', current: 127000, target: 320000, unit: 'USD' },
  },
  {
    title: 'Rebuild launch confidence for the shared inbox release',
    outcome: 'The release can ship without support volume doubling on day one.',
    status: 'blocked',
    team: 'product-delivery',
    owner: 'agent',
    coverage: 'overloaded',
    heartbeat: 'QA found regressions late and the same two agents are carrying every blocker.',
    ticketPlan: { inbox: 0, ready: 1, in_progress: 3, blocked: 3, done: 1 },
    progress: { source: 'sub_goal_rollup' },
  },
  {
    title: 'Cut runtime spend spikes during weekend routing bursts',
    outcome: 'Cost posture stays predictable even when cross-channel volume jumps.',
    status: 'active',
    team: 'platform-reliability',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'The team has a working mitigation plan and cost receipts are already trending down.',
    ticketPlan: { inbox: 0, ready: 2, in_progress: 2, blocked: 0, done: 3 },
    progress: { source: 'currency', current: 2400, target: 1500, unit: 'USD/wk' },
  },
  {
    title: 'Drain the support escalation backlog before SLA breach',
    outcome: 'Escalations return to same-day response and angry threads stop compounding.',
    status: 'blocked',
    team: 'customer-success',
    owner: 'agent',
    coverage: 'thin',
    heartbeat: 'Escalations are blocked on product answers and one staffed agent is overloaded.',
    ticketPlan: { inbox: 2, ready: 1, in_progress: 2, blocked: 3, done: 0 },
    progress: { source: 'number', current: 23, target: 0, unit: 'open escalations' },
  },
  {
    title: 'Turn competitor launch noise into a coherent pricing response',
    outcome:
      'The company has a concrete response before buyers start repeating competitor framing.',
    status: 'active',
    team: 'market-intelligence',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'Research is moving and narrative drafts are already linked to open revenue tickets.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 2, blocked: 0, done: 2 },
    progress: { source: 'boolean', current: 0, target: 1 },
  },
  {
    title: 'Untangle the webhook retry storm after the plugin rollout',
    outcome: 'Retries stop amplifying incidents and queue behavior is boring again.',
    status: 'at_risk',
    team: 'platform-reliability',
    owner: 'agent',
    coverage: 'overloaded',
    heartbeat:
      'The retry storm is understood, but platform is still leaning on one recovery specialist.',
    ticketPlan: { inbox: 0, ready: 1, in_progress: 4, blocked: 2, done: 0 },
    progress: { source: 'number', current: 847, target: 50, unit: 'retries/hr' },
  },
  {
    title: 'Give support a cleaner path from session chaos to durable tickets',
    outcome: 'Sessions still launch fast, but support work no longer disappears into chat.',
    status: 'active',
    team: 'customer-success',
    owner: 'user',
    coverage: 'covered',
    heartbeat:
      'Promotion flows are live and support can prove what moved from chat into managed work.',
    ticketPlan: { inbox: 1, ready: 2, in_progress: 2, blocked: 0, done: 2 },
    progress: { source: 'percentage', current: 68, target: 100 },
  },
  {
    title: 'Tighten launch coordination across docs, product, and success',
    outcome: 'Feature launches stop creating mismatched docs and reactive support cleanup.',
    status: 'active',
    team: 'product-delivery',
    owner: 'agent',
    coverage: 'covered',
    heartbeat: 'Delivery has enough staffing; the risk is keeping downstream teams in the loop.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 3, blocked: 0, done: 1 },
    progress: { source: 'ticket_rollup' },
  },
  {
    title: 'Prepare the board update on fleet economics and queue health',
    outcome: 'The executive summary reads like a real company, not a dev harness.',
    status: 'active',
    team: 'market-intelligence',
    owner: 'user',
    coverage: 'thin',
    heartbeat:
      'The board pack is moving, but analysis still depends on one research agent and one human owner.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 1, blocked: 1, done: 2 },
    progress: { source: 'percentage', current: 45, target: 100 },
  },
  {
    title: 'Resolve incomplete ownership on growth experiments',
    outcome: 'Every experiment has an owner, a team, and a visible follow-through path.',
    status: 'at_risk',
    team: 'market-intelligence',
    owner: 'none',
    coverage: 'thin',
    heartbeat: 'Experiments exist, but ownership is still incomplete and momentum is shallow.',
    ticketPlan: { inbox: 2, ready: 1, in_progress: 1, blocked: 1, done: 1 },
    progress: { source: 'number', current: 3, target: 8, unit: 'experiments owned' },
  },
  {
    title: 'Finish the partner migration without breaking webhook receipts',
    outcome: 'Partner traffic moves cleanly and receipt links stay trustworthy.',
    status: 'active',
    team: 'platform-reliability',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'Migration work is on track; the team has enough capacity to absorb partner surprises.',
    ticketPlan: { inbox: 0, ready: 2, in_progress: 2, blocked: 1, done: 2 },
    progress: { source: 'number', current: 14, target: 22, unit: 'partners' },
  },
  {
    title: 'Refactor support macros into governed skills',
    outcome: 'Support automations become reusable skills with clear owners and receipts.',
    status: 'done',
    team: 'customer-success',
    owner: 'agent',
    coverage: 'covered',
    heartbeat: 'This one is complete and the receipts are already linked from the final review.',
    ticketPlan: { inbox: 0, ready: 0, in_progress: 0, blocked: 0, done: 6 },
    progress: { source: 'boolean', current: 1, target: 1 },
  },
  {
    title: 'Pull flaky eval cases out of the release gate',
    outcome: 'Release readiness reads clearly instead of getting distorted by noisy eval failures.',
    status: 'blocked',
    team: 'product-delivery',
    owner: 'agent',
    coverage: 'overloaded',
    heartbeat:
      'The eval gate is blocking launch decisions and the same release agents are carrying the cleanup.',
    ticketPlan: { inbox: 0, ready: 1, in_progress: 2, blocked: 4, done: 0 },
    progress: { source: 'number', current: 12, target: 0, unit: 'flaky cases' },
  },
  {
    title: 'Bring revenue follow-up back inside one business day',
    outcome: 'Hot inbound leads stop aging out between chat, email, and queue handoffs.',
    status: 'active',
    team: 'revenue-ops',
    owner: 'agent',
    coverage: 'covered',
    heartbeat: 'The team owns the queue and staffed agents are healthy enough to keep pace.',
    ticketPlan: { inbox: 2, ready: 1, in_progress: 2, blocked: 0, done: 2 },
    progress: { source: 'number', current: 18, target: 8, unit: 'hrs avg response' },
  },
  {
    title: 'Make incident retros land as actionable portfolio changes',
    outcome: 'Incidents produce goal, staffing, and queue changes that management can see.',
    status: 'active',
    team: 'platform-reliability',
    owner: 'user',
    coverage: 'covered',
    heartbeat:
      'Retros are turning into concrete follow-through instead of disappearing into notes.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 2, blocked: 0, done: 2 },
    progress: { source: 'percentage', current: 72, target: 100 },
  },
  {
    title: 'Stabilize the trial-to-paid handoff narrative',
    outcome: 'Growth, product, and revenue are telling the same story to prospects.',
    status: 'at_risk',
    team: 'revenue-ops',
    owner: 'none',
    coverage: 'thin',
    heartbeat:
      'The narrative exists, but follow-through is still under-owned and light on staffing depth.',
    ticketPlan: { inbox: 1, ready: 2, in_progress: 1, blocked: 1, done: 1 },
    progress: { source: 'percentage', current: 30, target: 100 },
  },
  {
    title: 'Give customer success cleaner blocked-state receipts',
    outcome: 'Success managers can prove what is blocked, by whom, and for how long.',
    status: 'active',
    team: 'customer-success',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'Blocked-state receipts are getting cleaner and the team is no longer arguing from vibes.',
    ticketPlan: { inbox: 0, ready: 1, in_progress: 2, blocked: 1, done: 3 },
    progress: { source: 'ticket_rollup' },
  },
  {
    title: 'Rescue the launch calendar from cross-team drift',
    outcome: 'Launch dates, docs, and handoff owners line up without opening five pages.',
    status: 'at_risk',
    team: 'product-delivery',
    owner: 'user',
    coverage: 'thin',
    heartbeat: 'The calendar is visible, but staffing is still too shallow when blockers stack up.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 2, blocked: 2, done: 1 },
    progress: { source: 'number', current: 3, target: 7, unit: 'teams aligned' },
  },
  {
    title: 'Map idle capacity before the next portfolio shuffle',
    outcome: 'Management can move work onto idle agents instead of guessing from memory.',
    status: 'active',
    team: 'market-intelligence',
    owner: 'agent',
    coverage: 'covered',
    heartbeat:
      'Idle capacity is visible now; the remaining work is making reassignment decisions obvious.',
    ticketPlan: { inbox: 1, ready: 1, in_progress: 1, blocked: 0, done: 2 },
    progress: { source: 'number', current: 6, target: 10, unit: 'agents mapped' },
  },
] as const

const SCENARIO_STRUCTURE: Record<
  (typeof SCENARIOS)[number]['title'],
  {
    initiativeKey: (typeof INITIATIVE_DEFINITIONS)[number]['key']
    parentTitle?: (typeof SCENARIOS)[number]['title']
  }
> = {
  'Stop enterprise onboarding from slipping past seven days': {
    initiativeKey: 'revenue-activation',
  },
  'Recover stalled renewals in the 20k to 50k ARR band': {
    initiativeKey: 'revenue-activation',
    parentTitle: 'Stop enterprise onboarding from slipping past seven days',
  },
  'Bring revenue follow-up back inside one business day': {
    initiativeKey: 'revenue-activation',
    parentTitle: 'Stop enterprise onboarding from slipping past seven days',
  },
  'Stabilize the trial-to-paid handoff narrative': {
    initiativeKey: 'revenue-activation',
    parentTitle: 'Recover stalled renewals in the 20k to 50k ARR band',
  },
  'Rebuild launch confidence for the shared inbox release': {
    initiativeKey: 'launch-discipline',
  },
  'Tighten launch coordination across docs, product, and success': {
    initiativeKey: 'launch-discipline',
    parentTitle: 'Rebuild launch confidence for the shared inbox release',
  },
  'Pull flaky eval cases out of the release gate': {
    initiativeKey: 'launch-discipline',
    parentTitle: 'Rebuild launch confidence for the shared inbox release',
  },
  'Rescue the launch calendar from cross-team drift': {
    initiativeKey: 'launch-discipline',
    parentTitle: 'Tighten launch coordination across docs, product, and success',
  },
  'Cut runtime spend spikes during weekend routing bursts': {
    initiativeKey: 'runtime-discipline',
  },
  'Untangle the webhook retry storm after the plugin rollout': {
    initiativeKey: 'runtime-discipline',
    parentTitle: 'Cut runtime spend spikes during weekend routing bursts',
  },
  'Finish the partner migration without breaking webhook receipts': {
    initiativeKey: 'runtime-discipline',
    parentTitle: 'Cut runtime spend spikes during weekend routing bursts',
  },
  'Make incident retros land as actionable portfolio changes': {
    initiativeKey: 'runtime-discipline',
  },
  'Drain the support escalation backlog before SLA breach': {
    initiativeKey: 'support-receipts',
  },
  'Give support a cleaner path from session chaos to durable tickets': {
    initiativeKey: 'support-receipts',
    parentTitle: 'Drain the support escalation backlog before SLA breach',
  },
  'Refactor support macros into governed skills': {
    initiativeKey: 'support-receipts',
    parentTitle: 'Give support a cleaner path from session chaos to durable tickets',
  },
  'Give customer success cleaner blocked-state receipts': {
    initiativeKey: 'support-receipts',
    parentTitle: 'Drain the support escalation backlog before SLA breach',
  },
  'Prepare the board update on fleet economics and queue health': {
    initiativeKey: 'board-readiness',
  },
  'Turn competitor launch noise into a coherent pricing response': {
    initiativeKey: 'growth-governance',
  },
  'Resolve incomplete ownership on growth experiments': {
    initiativeKey: 'growth-governance',
    parentTitle: 'Prepare the board update on fleet economics and queue health',
  },
  'Map idle capacity before the next portfolio shuffle': {
    initiativeKey: 'growth-governance',
    parentTitle: 'Prepare the board update on fleet economics and queue health',
  },
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

function ticketTitle(
  goalTitle: string,
  status: keyof (typeof SCENARIOS)[number]['ticketPlan'],
  index: number
) {
  const verbs = {
    inbox: ['Triage', 'Review', 'Sort'],
    ready: ['Prepare', 'Stage', 'Queue'],
    in_progress: ['Run', 'Ship', 'Coordinate'],
    blocked: ['Unblock', 'Escalate', 'Resolve'],
    done: ['Close', 'Document', 'Confirm'],
  } as const

  const verb = verbs[status][index % verbs[status].length]
  return `${verb} ${goalTitle.toLowerCase()}`
}

async function main() {
  const db = getDb()
  const timestamp = now()
  const user = await db
    .selectFrom('users')
    .select(['id', 'name', 'email'])
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!user) {
    throw new Error('No local user found. Complete setup before seeding scale data.')
  }

  const seededInitiativeIds = (
    await db
      .selectFrom('initiatives')
      .select(['id'])
      .where('id', 'like', `${PREFIX}-initiative-%`)
      .execute()
  ).map((row) => row.id)
  const seededTeamIds = (
    await db
      .selectFrom('teams')
      .select(['id'])
      .where((eb) =>
        eb.or([eb('slug', 'like', `${PREFIX}-%`), eb('id', 'like', `${PREFIX}-team-%`)])
      )
      .execute()
  ).map((row) => row.id)
  const seededAgentIds = (
    await db.selectFrom('agents').select(['id']).where('handle', 'like', `${PREFIX}-%`).execute()
  ).map((row) => row.id)
  const legacyHarnessGoalIds = (
    await db.selectFrom('goals').select(['id']).where('title', 'like', '[WS8]%').execute()
  ).map((row) => row.id)
  const seededGoalIds = (
    await db
      .selectFrom('goals')
      .select(['id'])
      .where((eb) =>
        eb.or([
          eb('team_id', 'in', seededTeamIds.length > 0 ? seededTeamIds : ['__none__']),
          eb(
            'owner_ref',
            'in',
            [...seededTeamIds, ...seededAgentIds].length > 0
              ? [...seededTeamIds, ...seededAgentIds]
              : ['__none__']
          ),
        ])
      )
      .execute()
  ).map((row) => row.id)
  const seededGoalIdsFromAllocations = (
    await db
      .selectFrom('goal_agent_allocations')
      .select(['goal_id'])
      .where('agent_id', 'in', seededAgentIds.length > 0 ? seededAgentIds : ['__none__'])
      .execute()
  ).map((row) => row.goal_id)
  const allSeededGoalIds = [
    ...new Set([...legacyHarnessGoalIds, ...seededGoalIds, ...seededGoalIdsFromAllocations]),
  ]
  const seededTicketIds = (
    await db
      .selectFrom('tickets')
      .select(['id'])
      .where((eb) =>
        eb.or([
          eb('goal_id', 'in', allSeededGoalIds.length > 0 ? allSeededGoalIds : ['__none__']),
          eb(
            'assignee_ref',
            'in',
            [...seededTeamIds, ...seededAgentIds].length > 0
              ? [...seededTeamIds, ...seededAgentIds]
              : ['__none__']
          ),
        ])
      )
      .execute()
  ).map((row) => row.id)
  const seededTicketRelationIds = (
    await db
      .selectFrom('ticket_relations')
      .select(['id'])
      .where((eb) =>
        eb.or([
          eb('id', 'like', `${PREFIX}-ticket-relation-%`),
          eb('ticket_id', 'in', seededTicketIds.length > 0 ? seededTicketIds : ['__none__']),
          eb(
            'related_ticket_id',
            'in',
            seededTicketIds.length > 0 ? seededTicketIds : ['__none__']
          ),
        ])
      )
      .execute()
  ).map((row) => row.id)

  if (seededTicketRelationIds.length > 0) {
    await db.deleteFrom('ticket_relations').where('id', 'in', seededTicketRelationIds).execute()
  }
  if (seededTicketIds.length > 0) {
    await db.deleteFrom('ticket_links').where('ticket_id', 'in', seededTicketIds).execute()
    await db.deleteFrom('work_updates').where('ticket_id', 'in', seededTicketIds).execute()
    await db.deleteFrom('tickets').where('id', 'in', seededTicketIds).execute()
  }
  if (allSeededGoalIds.length > 0) {
    await db.deleteFrom('goal_agent_allocations').where('goal_id', 'in', allSeededGoalIds).execute()
    await db.deleteFrom('work_updates').where('goal_id', 'in', allSeededGoalIds).execute()
    await db.deleteFrom('goals').where('id', 'in', allSeededGoalIds).execute()
  }
  if (seededAgentIds.length > 0) {
    await db.deleteFrom('agent_teams').where('agent_id', 'in', seededAgentIds).execute()
    await db.deleteFrom('agents').where('id', 'in', seededAgentIds).execute()
  }
  if (seededTeamIds.length > 0) {
    await db.deleteFrom('work_updates').where('team_id', 'in', seededTeamIds).execute()
    await db.deleteFrom('agent_teams').where('team_id', 'in', seededTeamIds).execute()
    await db.deleteFrom('team_members').where('team_id', 'in', seededTeamIds).execute()
    await db.deleteFrom('teams').where('id', 'in', seededTeamIds).execute()
  }
  if (seededInitiativeIds.length > 0) {
    await db.deleteFrom('initiatives').where('id', 'in', seededInitiativeIds).execute()
  }

  const teams = new Map<string, { id: string; name: string }>()
  const initiatives = new Map<string, { id: string; title: string }>()
  const agentsByTeam = new Map<
    string,
    Array<{ id: string; name: string; handle: string; overloaded: boolean; idle: boolean }>
  >()

  // Parent teams: user leads "Nitejar Inc", rest will get agent leads after agents are created
  for (const [index, definition] of PARENT_TEAM_DEFINITIONS.entries()) {
    const teamId = `${PREFIX}-team-${definition.key}`
    const isUserLed = definition.key === 'company' // Only the company root gets the human lead
    await db
      .insertInto('teams')
      .values({
        id: teamId,
        parent_team_id: definition.parentKey ? `${PREFIX}-team-${definition.parentKey}` : null,
        name: definition.name,
        charter: definition.charter,
        slug: `${PREFIX}-team-${slugify(definition.key)}`,
        sort_order: index,
        lead_kind: isUserLed ? 'user' : null, // Non-root parent teams get agent leads later
        lead_ref: isUserLed ? user.id : null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()

    if (isUserLed) {
      await db
        .insertInto('team_members')
        .values({
          team_id: teamId,
          user_id: user.id,
          role: 'lead',
          created_at: timestamp,
        })
        .execute()
    }

    teams.set(definition.key, { id: teamId, name: definition.name })
  }

  for (const definition of TEAM_DEFINITIONS) {
    const teamId = `${PREFIX}-${definition.key}`
    const parentTeamId = teams.get(definition.parentTeam)?.id ?? null
    await db
      .insertInto('teams')
      .values({
        id: teamId,
        parent_team_id: parentTeamId,
        name: definition.name,
        charter: definition.charter,
        slug: `${PREFIX}-${slugify(definition.key)}`,
        sort_order: 0,
        lead_kind: null, // Will be set to first agent after creation
        lead_ref: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()

    teams.set(definition.key, { id: teamId, name: definition.name })

    const teamAgents: Array<{
      id: string
      name: string
      handle: string
      overloaded: boolean
      idle: boolean
    }> = []
    for (let index = 0; index < TEAM_SIZE; index += 1) {
      const agentDef = definition.agents[index % definition.agents.length]
      const agent = await createAgent({
        handle: `${PREFIX}-${definition.key}-${slugify(agentDef.name)}`,
        name: agentDef.name,
        sprite_id: null,
        config: JSON.stringify({
          title: agentDef.title,
          emoji: agentDef.emoji,
        }),
        status: index === TEAM_SIZE - 1 ? 'offline' : 'idle',
      })
      await db
        .insertInto('agent_teams')
        .values({
          team_id: teamId,
          agent_id: agent.id,
          is_primary: 1,
          created_at: timestamp,
        })
        .execute()

      teamAgents.push({
        id: agent.id,
        name: agent.name,
        handle: agent.handle,
        overloaded: index < 2,
        idle: index >= TEAM_SIZE - 3,
      })
    }
    agentsByTeam.set(definition.key, teamAgents)

    // Set the first agent as lead for this leaf team
    if (teamAgents.length > 0) {
      await db
        .updateTable('teams')
        .set({ lead_kind: 'agent', lead_ref: teamAgents[0].id })
        .where('id', '=', teamId)
        .execute()
    }
  }

  // Now set agent leads for non-root parent teams (Engineering, Product, etc.)
  // Use the first agent from their first child team
  for (const definition of PARENT_TEAM_DEFINITIONS) {
    if (definition.key === 'company') continue // Already has user lead
    const parentTeamId = teams.get(definition.key)?.id
    if (!parentTeamId) continue
    // Find first child leaf team's agents to pick a lead
    const childDef = TEAM_DEFINITIONS.find((t) => t.parentTeam === definition.key)
    const childAgents = childDef ? agentsByTeam.get(childDef.key) : undefined
    if (childAgents && childAgents.length > 1) {
      // Use the second agent so it's different from the leaf team lead
      await db
        .updateTable('teams')
        .set({ lead_kind: 'agent', lead_ref: childAgents[1].id })
        .where('id', '=', parentTeamId)
        .execute()
    } else {
      // No child agents — fall back to user as lead
      await db
        .updateTable('teams')
        .set({ lead_kind: 'user', lead_ref: user.id })
        .where('id', '=', parentTeamId)
        .execute()
    }
  }

  for (const definition of INITIATIVE_DEFINITIONS) {
    const initiativeId = `${PREFIX}-initiative-${definition.key}`
    await db
      .insertInto('initiatives')
      .values({
        id: initiativeId,
        parent_initiative_id: definition.parentKey
          ? `${PREFIX}-initiative-${definition.parentKey}`
          : null,
        title: definition.title,
        slug: `${PREFIX}-initiative-${slugify(definition.key)}`,
        description: definition.description,
        status: definition.status,
        owner_kind: 'user',
        owner_ref: user.id,
        team_id: teams.get(definition.team)?.id ?? null,
        target_label: definition.targetLabel,
        created_by_user_id: user.id,
        created_at: timestamp,
        updated_at: timestamp,
        archived_at: null,
      })
      .execute()

    initiatives.set(definition.key, { id: initiativeId, title: definition.title })
  }

  let goalCounter = 0
  let ticketCounter = 0
  let ticketRelationCounter = 0
  const goalIdsByTitle = new Map<string, string>()

  for (const scenario of SCENARIOS) {
    goalCounter += 1
    const team = teams.get(scenario.team)
    const structure = SCENARIO_STRUCTURE[scenario.title]
    const teamAgents = agentsByTeam.get(scenario.team) ?? []
    const overloadedAgents = teamAgents.filter((agent) => agent.overloaded)
    const steadyAgents = teamAgents.filter((agent) => !agent.overloaded && !agent.idle)
    const idleAgents = teamAgents.filter((agent) => agent.idle)
    const ownerAgent = overloadedAgents[0] ?? steadyAgents[0] ?? teamAgents[0]

    const goalId = `${PREFIX}-goal-${goalCounter}`
    const ownerKind =
      scenario.owner === 'agent' ? 'agent' : scenario.owner === 'user' ? 'user' : null
    const ownerRef =
      scenario.owner === 'agent'
        ? (ownerAgent?.id ?? null)
        : scenario.owner === 'user'
          ? user.id
          : null

    await db
      .insertInto('goals')
      .values({
        id: goalId,
        initiative_id: initiatives.get(structure.initiativeKey)?.id ?? null,
        parent_goal_id: structure.parentTitle
          ? (goalIdsByTitle.get(structure.parentTitle) ?? null)
          : null,
        title: scenario.title,
        outcome: scenario.outcome,
        status: scenario.status,
        owner_kind: ownerKind,
        owner_ref: ownerRef,
        team_id: team?.id ?? null,
        progress_source: scenario.progress?.source ?? 'ticket_rollup',
        progress_current: scenario.progress?.current ?? null,
        progress_target: scenario.progress?.target ?? null,
        progress_unit: scenario.progress?.unit ?? null,
        created_by_user_id: user.id,
        created_at: timestamp - goalCounter * 3600,
        updated_at: timestamp - goalCounter * 1800,
        archived_at: null,
      })
      .execute()
    goalIdsByTitle.set(scenario.title, goalId)

    const directStaffingPool =
      scenario.coverage === 'covered'
        ? [...steadyAgents.slice(0, 2), ...idleAgents.slice(0, 1)]
        : scenario.coverage === 'thin'
          ? [steadyAgents[0] ?? ownerAgent].filter(Boolean)
          : scenario.coverage === 'overloaded'
            ? overloadedAgents.slice(0, 1)
            : []

    for (const agent of directStaffingPool) {
      if (!agent) continue
      await db
        .insertInto('goal_agent_allocations')
        .values({
          goal_id: goalId,
          agent_id: agent.id,
          created_by_kind: 'user',
          created_by_ref: user.id,
          created_at: timestamp - goalCounter * 1200,
        })
        .onConflict((oc) => oc.columns(['goal_id', 'agent_id']).doNothing())
        .execute()
    }

    await createWorkUpdate({
      goal_id: goalId,
      ticket_id: null,
      team_id: team?.id ?? null,
      author_kind: 'user',
      author_ref: user.id,
      kind: 'heartbeat',
      body: scenario.heartbeat,
      metadata_json: JSON.stringify({ seeded: PREFIX }),
    })

    const ticketEntries = Object.entries(scenario.ticketPlan) as Array<
      [keyof typeof scenario.ticketPlan, number]
    >
    let anchorTicketId: string | null = null
    // Track the first in_progress ticket so we can nest subsequent ones under it
    let firstInProgressTicketId: string | null = null
    for (const [status, count] of ticketEntries) {
      for (let index = 0; index < count; index += 1) {
        ticketCounter += 1
        const assignToOverloaded = scenario.coverage === 'overloaded' || status === 'blocked'
        const assignedAgent = assignToOverloaded
          ? (overloadedAgents[index % Math.max(overloadedAgents.length, 1)] ?? ownerAgent)
          : (steadyAgents[index % Math.max(steadyAgents.length, 1)] ?? ownerAgent)
        const assigneeKind =
          status === 'inbox'
            ? index % 2 === 0
              ? 'agent'
              : null
            : status === 'done'
              ? 'agent'
              : scenario.coverage === 'thin' && index === 0
                ? 'agent'
                : 'agent'
        const assigneeRef = assigneeKind === 'agent' ? (assignedAgent?.id ?? null) : null

        const ticketId = `${PREFIX}-ticket-${ticketCounter}`

        // Nesting logic: nest child tickets under a parent within the same goal.
        // - The first non-inbox, non-done ticket becomes the anchor (parent).
        // - All subsequent in_progress tickets (index > 0) nest under the first in_progress ticket.
        // - All blocked tickets nest under the anchor.
        // - Ready tickets at index > 0 nest under the anchor.
        let parentTicketId: string | null = null
        if (status === 'in_progress' && firstInProgressTicketId !== null && index > 0) {
          parentTicketId = firstInProgressTicketId
        } else if (status === 'blocked' && anchorTicketId !== null) {
          parentTicketId = anchorTicketId
        } else if (status === 'ready' && index > 0 && anchorTicketId !== null) {
          parentTicketId = anchorTicketId
        }

        await db
          .insertInto('tickets')
          .values({
            id: ticketId,
            goal_id: goalId,
            parent_ticket_id: parentTicketId,
            title: ticketTitle(scenario.title, status, index + goalCounter),
            body: `${scenario.outcome} This ticket exists to keep the queue realistic and legible.`,
            status,
            assignee_kind: assigneeKind,
            assignee_ref: assigneeRef,
            created_by_user_id: user.id,
            claimed_by_kind: assigneeKind === 'agent' ? 'user' : null,
            claimed_by_ref: assigneeKind === 'agent' ? user.id : null,
            claimed_at: assigneeKind === 'agent' ? timestamp - ticketCounter * 90 : null,
            created_at: timestamp - ticketCounter * 600,
            updated_at: timestamp - ticketCounter * 300,
            archived_at: null,
          })
          .execute()

        if (!anchorTicketId && status !== 'inbox' && status !== 'done') {
          anchorTicketId = ticketId
        }
        if (status === 'in_progress' && firstInProgressTicketId === null) {
          firstInProgressTicketId = ticketId
        }

        if (status === 'blocked' && anchorTicketId && anchorTicketId !== ticketId) {
          ticketRelationCounter += 1
          await db
            .insertInto('ticket_relations')
            .values({
              id: `${PREFIX}-ticket-relation-${ticketRelationCounter}`,
              ticket_id: ticketId,
              related_ticket_id: anchorTicketId,
              kind: 'blocked_by',
              created_by_kind: 'user',
              created_by_ref: user.id,
              created_at: timestamp - ticketCounter * 120,
            })
            .execute()
        }

        await createWorkUpdate({
          goal_id: goalId,
          ticket_id: ticketId,
          team_id: null,
          author_kind: 'user',
          author_ref: user.id,
          kind: status === 'blocked' ? 'status' : 'note',
          body:
            status === 'blocked'
              ? `Queue shift: blocked on cross-team follow-through for ${scenario.title.toLowerCase()}.`
              : status === 'done'
                ? `Receipt posted: ${scenario.title.toLowerCase()} moved one more step toward done.`
                : `Queue shift: ${scenario.title.toLowerCase()} is actively moving through the work queue.`,
          metadata_json: JSON.stringify({ seeded: PREFIX }),
        })
      }
    }
  }

  for (const definition of TEAM_DEFINITIONS) {
    const team = teams.get(definition.key)
    if (!team) continue
    const summary =
      definition.key === 'platform-reliability'
        ? 'Platform heartbeat: carrying incident cleanup, partner migration, and cost posture at the same time.'
        : definition.key === 'product-delivery'
          ? 'Delivery heartbeat: launches are moving, but QA and eval cleanup are still the thin edge.'
          : definition.key === 'customer-success'
            ? 'Success heartbeat: support is staffed, but escalations still spike when product answers stall.'
            : definition.key === 'revenue-ops'
              ? 'Revenue heartbeat: renewals and onboarding are visible, with ownership still uneven in a few bets.'
              : 'Market heartbeat: research is healthy, and idle capacity is finally visible enough to reassign.'

    await createWorkUpdate({
      goal_id: null,
      ticket_id: null,
      team_id: team.id,
      author_kind: 'user',
      author_ref: user.id,
      kind: 'heartbeat',
      body: summary,
      metadata_json: JSON.stringify({ seeded: PREFIX }),
    })
  }

  console.log(
    `Seeded ${PARENT_TEAM_DEFINITIONS.length} parent teams, ${TEAM_DEFINITIONS.length} leaf teams, ${INITIATIVE_DEFINITIONS.length} initiatives, ${TEAM_DEFINITIONS.length * TEAM_SIZE} agents, ${SCENARIOS.length} goals, and ${ticketCounter} tickets with realistic hierarchy and staffing patterns.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
