import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

// ============================================================================
// Database Interface - Single source of truth for both SQLite and Postgres
// ============================================================================

export interface Database {
  plugin_instances: PluginInstanceTable
  plugins: PluginTable
  plugin_versions: PluginVersionTable
  plugin_disclosure_acks: PluginDisclosureAckTable
  plugin_events: PluginEventTable
  gateway_settings: GatewaySettingsTable
  auth_signup_settings: AuthSignupSettingsTable
  model_catalog: ModelCatalogTable
  github_installations: GithubInstallationTable
  github_repos: GithubRepoTable
  agent_repo_capabilities: AgentRepoCapabilityTable
  audit_logs: AuditLogTable
  agents: AgentTable
  agent_sandboxes: AgentSandboxTable
  agent_plugin_instances: AgentPluginInstanceTable
  agent_memories: AgentMemoryTable
  users: UserTable
  session: AuthSessionTable
  account: AccountTable
  verification: VerificationTable
  oauth_application: OAuthApplicationTable
  oauth_access_token: OAuthAccessTokenTable
  oauth_consent: OAuthConsentTable
  invitations: InvitationTable
  teams: TeamTable
  team_members: TeamMemberTable
  agent_teams: AgentTeamTable
  collections: CollectionTable
  collection_rows: CollectionRowTable
  collection_permissions: CollectionPermissionTable
  collection_schema_reviews: CollectionSchemaReviewTable
  app_sessions: AppSessionTable
  app_session_participants: AppSessionParticipantTable
  work_items: WorkItemTable
  jobs: JobTable
  messages: MessageTable
  idempotency_keys: IdempotencyKeyTable
  session_summaries: SessionSummaryTable
  sprite_sessions: SpriteSessionTable
  scheduled_items: ScheduledItemTable
  routines: RoutineTable
  routine_runs: RoutineRunTable
  routine_event_queue: RoutineEventQueueTable
  queue_lanes: QueueLaneTable
  queue_messages: QueueMessageTable
  run_dispatches: RunDispatchTable
  effect_outbox: EffectOutboxTable
  passive_memory_queue: PassiveMemoryQueueTable
  runtime_control: RuntimeControlTable
  background_tasks: BackgroundTaskTable
  model_call_payloads: ModelCallPayloadTable
  inference_calls: InferenceCallTable
  cost_limits: CostLimitTable
  spans: SpanTable
  capability_settings: CapabilitySettingsTable
  credentials: CredentialTable
  agent_credentials: AgentCredentialTable
  external_api_calls: ExternalApiCallTable
  media_artifacts: MediaArtifactTable
  media_artifact_blobs: MediaArtifactBlobTable
  media_artifact_deliveries: MediaArtifactDeliveryTable
  activity_log: ActivityLogTable
  agent_messages: AgentMessageTable
  plugin_artifacts: PluginArtifactTable
  skills: SkillTable
  skill_files: SkillFileTable
  skill_assignments: SkillAssignmentTable
  rubrics: RubricTable
  evaluators: EvaluatorTable
  agent_evaluators: AgentEvaluatorTable
  eval_runs: EvalRunTable
  eval_results: EvalResultTable
  improvement_suggestions: ImprovementSuggestionTable
  eval_settings: EvalSettingsTable
}

// ============================================================================
// Plugin Instances
// ============================================================================

export interface PluginInstanceTable {
  id: Generated<string>
  plugin_id: string
  name: string
  config_json: string | null // JSON stored as text
  scope: Generated<string> // 'global' or agent-specific
  enabled: Generated<number> // 0 or 1 for SQLite compatibility
  created_at: Generated<number> // Unix timestamp
  updated_at: Generated<number> // Unix timestamp
}

export type PluginInstance = Selectable<PluginInstanceTable>
export type NewPluginInstance = Insertable<PluginInstanceTable>
export type PluginInstanceUpdate = Updateable<PluginInstanceTable>
export type PluginInstanceRecord = PluginInstance & {
  // Legacy derived fields are still expected by existing handlers.
  type: string
  config: string | null
}
/**
 * @deprecated Prefer `PluginInstanceRecord` for new code.
 */
export type Integration = PluginInstanceRecord
export type NewIntegration = NewPluginInstance
export type IntegrationUpdate = PluginInstanceUpdate

export interface PluginTable {
  id: Generated<string>
  name: string
  enabled: Generated<number> // 0 or 1 for SQLite compatibility
  trust_level: Generated<string> // builtin|trusted|untrusted|unknown
  source_kind: string // builtin|npm|git|upload|local
  source_ref: string | null
  current_version: string | null
  current_checksum: string | null
  current_install_path: string | null
  manifest_json: string
  config_json: string | null
  last_load_error: string | null
  last_loaded_at: number | null
  installed_at: Generated<number>
  updated_at: Generated<number>
}

export type Plugin = Selectable<PluginTable>
export type NewPlugin = Insertable<PluginTable>
export type PluginUpdate = Updateable<PluginTable>

export interface PluginVersionTable {
  plugin_id: string
  version: string
  checksum: string
  install_path: string
  manifest_json: string
  signature_json: string | null
  installed_at: Generated<number>
}

export type PluginVersion = Selectable<PluginVersionTable>
export type NewPluginVersion = Insertable<PluginVersionTable>
export type PluginVersionUpdate = Updateable<PluginVersionTable>

export interface PluginDisclosureAckTable {
  plugin_id: string
  permission: string
  scope: string
  acknowledged: Generated<number> // 0 or 1
  acknowledged_at: number | null
}

export type PluginDisclosureAck = Selectable<PluginDisclosureAckTable>
export type NewPluginDisclosureAck = Insertable<PluginDisclosureAckTable>
export type PluginDisclosureAckUpdate = Updateable<PluginDisclosureAckTable>

export interface PluginEventTable {
  id: Generated<string>
  plugin_id: string
  plugin_version: string | null
  kind: string
  status: string
  work_item_id: string | null
  job_id: string | null
  hook_name: string | null
  duration_ms: number | null
  detail_json: string | null
  created_at: Generated<number>
}

export type PluginEvent = Selectable<PluginEventTable>
export type NewPluginEvent = Insertable<PluginEventTable>
export type PluginEventUpdate = Updateable<PluginEventTable>

// ============================================================================
// Plugin Artifacts (tgz blobs stored per-version)
// ============================================================================

export interface PluginArtifactTable {
  plugin_id: string
  version: string
  tgz_blob: Buffer
  size_bytes: number
  checksum: string
  created_at: Generated<number>
}

export type PluginArtifact = Selectable<PluginArtifactTable>
export type NewPluginArtifact = Insertable<PluginArtifactTable>

// ============================================================================
// Gateway Settings + Model Catalog
// ============================================================================

export interface GatewaySettingsTable {
  id: Generated<string>
  provider: Generated<string>
  api_key_encrypted: string | null
  base_url: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type GatewaySettings = Selectable<GatewaySettingsTable>
export type NewGatewaySettings = Insertable<GatewaySettingsTable>
export type GatewaySettingsUpdate = Updateable<GatewaySettingsTable>

export interface AuthSignupSettingsTable {
  id: Generated<string>
  mode: Generated<string> // 'invite_only', 'approved_domain'
  approved_domains: Generated<string> // JSON string array
  default_role: Generated<string> // 'superadmin', 'admin', 'member'
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type AuthSignupSettings = Selectable<AuthSignupSettingsTable>
export type NewAuthSignupSettings = Insertable<AuthSignupSettingsTable>
export type AuthSignupSettingsUpdate = Updateable<AuthSignupSettingsTable>

export interface ModelCatalogTable {
  id: Generated<number>
  external_id: string
  name: string
  metadata_json: string | null
  source: string
  is_curated: Generated<number>
  refreshed_at: number | null
}

export type ModelCatalog = Selectable<ModelCatalogTable>
export type NewModelCatalog = Insertable<ModelCatalogTable>
export type ModelCatalogUpdate = Updateable<ModelCatalogTable>

// ============================================================================
// GitHub
// ============================================================================

export interface GithubInstallationTable {
  id: Generated<number>
  installation_id: number
  account_login: string | null
  account_id: number | null
  plugin_instance_id: string
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type GithubInstallation = Selectable<GithubInstallationTable>
export type NewGithubInstallation = Insertable<GithubInstallationTable>
export type GithubInstallationUpdate = Updateable<GithubInstallationTable>

export interface GithubRepoTable {
  id: Generated<number>
  repo_id: number
  full_name: string
  html_url: string | null
  installation_id: number
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type GithubRepo = Selectable<GithubRepoTable>
export type NewGithubRepo = Insertable<GithubRepoTable>
export type GithubRepoUpdate = Updateable<GithubRepoTable>

export interface AgentRepoCapabilityTable {
  agent_id: string
  github_repo_id: number
  capabilities: string // JSON string array (e.g., ["read_repo","open_pr"])
}

export type AgentRepoCapability = Selectable<AgentRepoCapabilityTable>
export type NewAgentRepoCapability = Insertable<AgentRepoCapabilityTable>
export type AgentRepoCapabilityUpdate = Updateable<AgentRepoCapabilityTable>

// ============================================================================
// Audit Logs
// ============================================================================

export interface AuditLogTable {
  id: Generated<string>
  event_type: string
  agent_id: string | null
  github_repo_id: number | null
  capability: string | null
  result: string | null
  metadata: string | null // JSON stored as text
  created_at: Generated<number>
}

export type AuditLog = Selectable<AuditLogTable>
export type NewAuditLog = Insertable<AuditLogTable>

// ============================================================================
// Agents
// ============================================================================

export interface AgentTable {
  id: Generated<string>
  handle: string // @mention ID (slug format, e.g., "mary")
  name: string // Display name (human readable, e.g., "Mary")
  sprite_id: string | null
  config: string | null // JSON stored as text (includes title for role)
  status: Generated<string> // 'idle', 'busy', 'offline'
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Agent = Selectable<AgentTable>
export type NewAgent = Insertable<AgentTable>
export type AgentUpdate = Updateable<AgentTable>

export interface AgentSandboxTable {
  id: Generated<string>
  agent_id: string
  name: string
  description: string
  sprite_name: string
  kind: string // 'home' | 'ephemeral'
  created_by: string // 'system' | 'admin' | 'agent'
  created_at: Generated<number>
  updated_at: Generated<number>
  last_used_at: Generated<number>
}

export type AgentSandbox = Selectable<AgentSandboxTable>
export type NewAgentSandbox = Insertable<AgentSandboxTable>
export type AgentSandboxUpdate = Updateable<AgentSandboxTable>

// ============================================================================
// Agent Memories
// ============================================================================

export interface AgentMemoryTable {
  id: Generated<string>
  agent_id: string
  content: string // the memory itself, freeform
  embedding: Uint8Array | null // vector embedding for similarity search (stored as BLOB)
  strength: Generated<number> // 0.0-1.0, decays over time
  access_count: Generated<number> // how often this memory has been retrieved
  permanent: Generated<number> // 0 or 1 for SQLite compatibility - if true, never decays
  version: Generated<number> // monotonic version counter for optimistic concurrency
  last_accessed_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type AgentMemory = Selectable<AgentMemoryTable>
export type NewAgentMemory = Insertable<AgentMemoryTable>
export type AgentMemoryUpdate = Updateable<AgentMemoryTable>

// ============================================================================
// Agent-Plugin Instance Assignments
// ============================================================================

export interface AgentPluginInstanceTable {
  agent_id: string
  plugin_instance_id: string
  created_at: Generated<number>
  policy_json: string | null
}

export type AgentPluginInstance = Selectable<AgentPluginInstanceTable>
export type NewAgentPluginInstance = Insertable<AgentPluginInstanceTable>

// ============================================================================
// Users (Organization Members)
// ============================================================================

export interface UserTable {
  id: string
  name: string
  email: string
  email_verified: Generated<number> // 0 or 1
  avatar_url: string | null
  role: Generated<string> // 'superadmin', 'admin', 'member'
  status: Generated<string> // 'active', 'disabled'
  created_at: string
  updated_at: string
}

export type User = Selectable<UserTable>
export type NewUser = Insertable<UserTable>
export type UserUpdate = Updateable<UserTable>

// ============================================================================
// Better Auth Session / Account / Verification
// ============================================================================

export interface AuthSessionTable {
  id: string
  expires_at: string
  token: string
  created_at: string
  updated_at: string
  ip_address: string | null
  user_agent: string | null
  user_id: string
}

export type AuthSession = Selectable<AuthSessionTable>
export type NewAuthSession = Insertable<AuthSessionTable>
export type AuthSessionUpdate = Updateable<AuthSessionTable>

export interface AccountTable {
  id: string
  account_id: string
  provider_id: string
  user_id: string
  access_token: string | null
  refresh_token: string | null
  id_token: string | null
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
  scope: string | null
  password_hash: string | null
  created_at: string
  updated_at: string
}

export type Account = Selectable<AccountTable>
export type NewAccount = Insertable<AccountTable>
export type AccountUpdate = Updateable<AccountTable>

export interface VerificationTable {
  id: string
  identifier: string
  value: string
  expires_at: string
  created_at: string
  updated_at: string
}

export type Verification = Selectable<VerificationTable>
export type NewVerification = Insertable<VerificationTable>
export type VerificationUpdate = Updateable<VerificationTable>

export interface OAuthApplicationTable {
  id: string
  name: string
  icon: string | null
  metadata: string | null
  client_id: string
  client_secret: string | null
  redirect_urls: string
  type: string
  authentication_scheme: string
  disabled: Generated<number> // 0 or 1
  user_id: string | null
  created_at: string
  updated_at: string
}

export type OAuthApplication = Selectable<OAuthApplicationTable>
export type NewOAuthApplication = Insertable<OAuthApplicationTable>
export type OAuthApplicationUpdate = Updateable<OAuthApplicationTable>

export interface OAuthAccessTokenTable {
  id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string
  refresh_token_expires_at: string
  client_id: string
  user_id: string | null
  scopes: string
  created_at: string
  updated_at: string
}

export type OAuthAccessToken = Selectable<OAuthAccessTokenTable>
export type NewOAuthAccessToken = Insertable<OAuthAccessTokenTable>
export type OAuthAccessTokenUpdate = Updateable<OAuthAccessTokenTable>

export interface OAuthConsentTable {
  id: string
  client_id: string
  user_id: string
  scopes: string
  created_at: string
  updated_at: string
  consent_given: Generated<number> // 0 or 1
}

export type OAuthConsent = Selectable<OAuthConsentTable>
export type NewOAuthConsent = Insertable<OAuthConsentTable>
export type OAuthConsentUpdate = Updateable<OAuthConsentTable>

// ============================================================================
// Invitations
// ============================================================================

export interface InvitationTable {
  id: string
  name: string
  email: string
  token_hash: string
  avatar_url: string | null
  role: Generated<string> // 'superadmin', 'admin', 'member'
  status: Generated<string> // 'pending', 'accepted', 'expired'
  expires_at: number | null
  accepted_at: number | null
  created_by_user_id: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Invitation = Selectable<InvitationTable>
export type NewInvitation = Insertable<InvitationTable>
export type InvitationUpdate = Updateable<InvitationTable>

// ============================================================================
// Teams
// ============================================================================

export interface TeamTable {
  id: Generated<string>
  name: string
  description: string | null
  slug: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Team = Selectable<TeamTable>
export type NewTeam = Insertable<TeamTable>
export type TeamUpdate = Updateable<TeamTable>

// ============================================================================
// Team Members
// ============================================================================

export interface TeamMemberTable {
  team_id: string
  user_id: string
  role: Generated<string> // 'member' (future: 'lead', etc.)
  created_at: Generated<number>
}

export type TeamMember = Selectable<TeamMemberTable>
export type NewTeamMember = Insertable<TeamMemberTable>
export type TeamMemberUpdate = Updateable<TeamMemberTable>

// ============================================================================
// Agent Team Assignments
// ============================================================================

export interface AgentTeamTable {
  team_id: string
  agent_id: string
  is_primary: Generated<number> // 0/1 for SQLite
  created_at: Generated<number>
}

export type AgentTeam = Selectable<AgentTeamTable>
export type NewAgentTeam = Insertable<AgentTeamTable>
export type AgentTeamUpdate = Updateable<AgentTeamTable>

// ============================================================================
// Collections (shared org-scoped structured data)
// ============================================================================

export interface CollectionTable {
  id: Generated<string>
  name: string
  description: string | null
  schema_json: string // JSON schema definition
  schema_version: Generated<number>
  created_by_agent_id: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Collection = Selectable<CollectionTable>
export type NewCollection = Insertable<CollectionTable>
export type CollectionUpdate = Updateable<CollectionTable>

export interface CollectionRowTable {
  id: Generated<string>
  collection_id: string
  data_json: string // metadata fields (filter/query oriented)
  content_json: string | null // longtext fields
  search_text: string | null // concatenated longtext for search
  created_by_agent_id: string | null
  updated_by_agent_id: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type CollectionRow = Selectable<CollectionRowTable>
export type NewCollectionRow = Insertable<CollectionRowTable>
export type CollectionRowUpdate = Updateable<CollectionRowTable>

export interface CollectionPermissionTable {
  collection_id: string
  agent_id: string
  can_read: Generated<number> // 0/1
  can_write: Generated<number> // 0/1
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type CollectionPermission = Selectable<CollectionPermissionTable>
export type NewCollectionPermission = Insertable<CollectionPermissionTable>
export type CollectionPermissionUpdate = Updateable<CollectionPermissionTable>

export interface CollectionSchemaReviewTable {
  id: Generated<string>
  collection_id: string | null
  collection_name: string
  action: string // 'create' | 'update'
  requested_by_agent_id: string
  proposed_description: string | null
  proposed_schema_json: string
  status: Generated<string> // 'pending' | 'approved' | 'rejected'
  reviewed_by_user_id: string | null
  review_notes: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
  reviewed_at: number | null
  applied_at: number | null
}

export type CollectionSchemaReview = Selectable<CollectionSchemaReviewTable>
export type NewCollectionSchemaReview = Insertable<CollectionSchemaReviewTable>
export type CollectionSchemaReviewUpdate = Updateable<CollectionSchemaReviewTable>

// ============================================================================
// App Sessions (in-app chat ownership + participants)
// ============================================================================

export interface AppSessionTable {
  session_key: string
  owner_user_id: string
  primary_agent_id: string
  title: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
  last_activity_at: Generated<number>
}

export type AppSession = Selectable<AppSessionTable>
export type NewAppSession = Insertable<AppSessionTable>
export type AppSessionUpdate = Updateable<AppSessionTable>

export interface AppSessionParticipantTable {
  session_key: string
  agent_id: string
  added_by_user_id: string
  added_at: Generated<number>
}

export type AppSessionParticipant = Selectable<AppSessionParticipantTable>
export type NewAppSessionParticipant = Insertable<AppSessionParticipantTable>
export type AppSessionParticipantUpdate = Updateable<AppSessionParticipantTable>

// ============================================================================
// Work Items
// ============================================================================

export interface WorkItemTable {
  id: Generated<string>
  plugin_instance_id: string | null
  session_key: string
  source: string // 'github', 'telegram', 'manual', etc.
  source_ref: string // platform-specific reference
  status: Generated<string> // 'NEW', 'IN_PROGRESS', 'COMPLETED', etc.
  title: string
  payload: string | null // JSON stored as text
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type WorkItem = Selectable<WorkItemTable>
export type NewWorkItem = Insertable<WorkItemTable>
export type WorkItemUpdate = Updateable<WorkItemTable>

// ============================================================================
// Jobs
// ============================================================================

export interface JobTable {
  id: Generated<string>
  work_item_id: string
  agent_id: string
  status: Generated<string> // 'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
  error_text: string | null
  todo_state: string | null // JSON stored as text
  final_response: string | null // Post-processed final response for final-mode jobs
  started_at: number | null
  completed_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Job = Selectable<JobTable>
export type NewJob = Insertable<JobTable>
export type JobUpdate = Updateable<JobTable>

// ============================================================================
// Messages
// ============================================================================

export interface MessageTable {
  id: Generated<string>
  job_id: string
  role: string // 'system', 'user', 'assistant', 'tool'
  content: string | null // JSON stored as text
  embedding: Uint8Array | null // Vector embedding for semantic search
  created_at: Generated<number>
}

export type Message = Selectable<MessageTable>
export type NewMessage = Insertable<MessageTable>

// ============================================================================
// Session Summaries
// ============================================================================

export interface SessionSummaryTable {
  id: Generated<string>
  session_key: string
  agent_id: string
  summary: string
  turn_count: number
  start_time: number // Unix timestamp of first message
  end_time: number // Unix timestamp of last message
  embedding: Uint8Array | null // Vector embedding for searching sessions
  compacted_at: Generated<number> // When the summary was created
}

export type SessionSummary = Selectable<SessionSummaryTable>
export type NewSessionSummary = Insertable<SessionSummaryTable>
export type SessionSummaryUpdate = Updateable<SessionSummaryTable>

// ============================================================================
// Idempotency Keys
// ============================================================================

export interface IdempotencyKeyTable {
  key: string
  work_item_id: string | null
  created_at: Generated<number>
}

export type IdempotencyKey = Selectable<IdempotencyKeyTable>
export type NewIdempotencyKey = Insertable<IdempotencyKeyTable>

// ============================================================================
// Sprite Sessions (WebSocket session management for tool execution)
// Sessions are per-conversation (session_key + agent_id), not per-job
// ============================================================================

export interface SpriteSessionTable {
  id: Generated<string>
  sprite_name: string
  session_id: string // Sprites API WebSocket session ID
  session_key: string // Conversation session key
  agent_id: string // Which agent owns this session
  status: Generated<string> // 'active', 'closed', 'error'
  created_at: Generated<number>
  last_active_at: Generated<number>
}

export type SpriteSession = Selectable<SpriteSessionTable>
export type NewSpriteSession = Insertable<SpriteSessionTable>
export type SpriteSessionUpdate = Updateable<SpriteSessionTable>

// ============================================================================
// Scheduled Items
// ============================================================================

export interface ScheduledItemTable {
  id: Generated<string>
  agent_id: string
  session_key: string
  type: Generated<string> // 'deferred' | 'heartbeat' | 'cron'
  payload: string // JSON instructions/context
  run_at: number // unix timestamp
  recurrence: string | null // null for one-shot (cron expression later)
  status: Generated<string> // 'pending' | 'firing' | 'fired' | 'cancelled'
  source_ref: string | null // optional link to PR, check run, etc.
  plugin_instance_id: string | null // plugin instance for response delivery
  response_context: string | null // JSON string for response delivery context
  routine_id: string | null // optional link to parent routine
  routine_run_id: string | null // optional link to routine run receipt
  created_at: Generated<number>
  fired_at: number | null
  cancelled_at: number | null
}

export type ScheduledItem = Selectable<ScheduledItemTable>
export type NewScheduledItem = Insertable<ScheduledItemTable>
export type ScheduledItemUpdate = Updateable<ScheduledItemTable>

// ============================================================================
// Routines (proactive autonomy)
// ============================================================================

export interface RoutineTable {
  id: Generated<string>
  agent_id: string
  name: string
  description: string | null
  enabled: Generated<number> // 0 or 1
  trigger_kind: string // 'cron' | 'event' | 'condition' | 'oneshot'
  cron_expr: string | null
  timezone: string | null
  rule_json: string // JSON rule object
  condition_probe: string | null
  condition_config: string | null // JSON config
  target_plugin_instance_id: string
  target_session_key: string
  target_response_context: string | null // JSON context
  action_prompt: string
  next_run_at: number | null
  last_evaluated_at: number | null
  last_fired_at: number | null
  last_status: string | null
  created_by_kind: string
  created_by_ref: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
  archived_at: number | null
}

export type Routine = Selectable<RoutineTable>
export type NewRoutine = Insertable<RoutineTable>
export type RoutineUpdate = Updateable<RoutineTable>

export interface RoutineRunTable {
  id: Generated<string>
  routine_id: string
  trigger_origin: string // 'cron' | 'event' | 'condition' | 'manual' | 'oneshot'
  trigger_ref: string | null
  envelope_json: string | null
  decision: string // 'enqueued' | 'skipped' | 'throttled' | 'error'
  decision_reason: string | null
  scheduled_item_id: string | null
  work_item_id: string | null
  evaluated_at: number
  created_at: Generated<number>
}

export type RoutineRun = Selectable<RoutineRunTable>
export type NewRoutineRun = Insertable<RoutineRunTable>
export type RoutineRunUpdate = Updateable<RoutineRunTable>

export interface RoutineEventQueueTable {
  id: Generated<string>
  event_key: string
  envelope_json: string
  status: Generated<string> // 'pending' | 'processing' | 'done' | 'failed'
  attempt_count: Generated<number>
  last_error: string | null
  lease_expires_at: number | null
  claimed_by: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type RoutineEventQueueItem = Selectable<RoutineEventQueueTable>
export type NewRoutineEventQueueItem = Insertable<RoutineEventQueueTable>
export type RoutineEventQueueUpdate = Updateable<RoutineEventQueueTable>

// ============================================================================
// Queue Lanes (durable per-session/agent queue state)
// ============================================================================

export interface QueueLaneTable {
  queue_key: string // `${session_key}:${agent_id}`
  session_key: string
  agent_id: string
  plugin_instance_id: string | null
  state: Generated<string> // 'idle' | 'queued' | 'running'
  mode: Generated<string> // 'collect' | 'followup' | 'steer'
  is_paused: Generated<number> // 0/1
  debounce_until: number | null
  debounce_ms: Generated<number>
  max_queued: Generated<number>
  active_dispatch_id: string | null
  paused_reason: string | null
  paused_by: string | null
  paused_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type QueueLane = Selectable<QueueLaneTable>
export type NewQueueLane = Insertable<QueueLaneTable>
export type QueueLaneUpdate = Updateable<QueueLaneTable>

// ============================================================================
// Queue Messages (durable queued ingress records)
// ============================================================================

export interface QueueMessageTable {
  id: Generated<string>
  queue_key: string
  work_item_id: string
  plugin_instance_id: string | null
  response_context: string | null
  text: string
  sender_name: string | null
  arrived_at: number
  status: Generated<string> // 'pending' | 'included' | 'dropped' | 'cancelled'
  dispatch_id: string | null
  drop_reason: string | null
  created_at: Generated<number>
}

export type QueueMessage = Selectable<QueueMessageTable>
export type NewQueueMessage = Insertable<QueueMessageTable>
export type QueueMessageUpdate = Updateable<QueueMessageTable>

// ============================================================================
// Run Dispatches (durable execution ledger)
// ============================================================================

export interface RunDispatchTable {
  id: Generated<string>
  run_key: string
  queue_key: string
  work_item_id: string
  agent_id: string
  plugin_instance_id: string | null
  session_key: string
  status: Generated<string> // 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'abandoned' | 'cancelled' | 'merged'
  control_state: Generated<string> // 'normal' | 'pause_requested' | 'paused' | 'cancel_requested' | 'cancelled'
  control_reason: string | null
  control_updated_at: number | null
  input_text: string
  coalesced_text: string | null
  sender_name: string | null
  response_context: string | null
  job_id: string | null
  attempt_count: Generated<number>
  claimed_by: string | null
  lease_expires_at: number | null
  claimed_epoch: Generated<number>
  last_error: string | null
  replay_of_dispatch_id: string | null
  merged_into_dispatch_id: string | null
  scheduled_at: number
  started_at: number | null
  finished_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type RunDispatch = Selectable<RunDispatchTable>
export type NewRunDispatch = Insertable<RunDispatchTable>
export type RunDispatchUpdate = Updateable<RunDispatchTable>

// ============================================================================
// Effect Outbox (durable side-effect delivery ledger)
// ============================================================================

export interface EffectOutboxTable {
  id: Generated<string>
  effect_key: string
  dispatch_id: string
  plugin_instance_id: string
  work_item_id: string
  job_id: string | null
  channel: string
  kind: string
  payload: string
  status: Generated<string> // 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled'
  retryable: Generated<number> // 0/1
  attempt_count: Generated<number>
  next_attempt_at: number | null
  claimed_by: string | null
  lease_expires_at: number | null
  claimed_epoch: Generated<number>
  provider_ref: string | null
  last_error: string | null
  unknown_reason: string | null
  released_by: string | null
  released_at: number | null
  sent_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type EffectOutbox = Selectable<EffectOutboxTable>
export type NewEffectOutbox = Insertable<EffectOutboxTable>
export type EffectOutboxUpdate = Updateable<EffectOutboxTable>

export interface PassiveMemoryQueueTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  work_item_id: string
  dispatch_id: string | null
  status: Generated<string> // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  attempt_count: Generated<number>
  max_attempts: Generated<number>
  next_attempt_at: number | null
  claimed_by: string | null
  lease_expires_at: number | null
  last_error: string | null
  summary_json: string | null
  started_at: number | null
  completed_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type PassiveMemoryQueue = Selectable<PassiveMemoryQueueTable>
export type NewPassiveMemoryQueue = Insertable<PassiveMemoryQueueTable>
export type PassiveMemoryQueueUpdate = Updateable<PassiveMemoryQueueTable>

// ============================================================================
// Runtime Control (global processing switch + epoch fencing)
// ============================================================================

export interface RuntimeControlTable {
  id: string
  processing_enabled: Generated<number> // 0/1
  pause_mode: Generated<string> // 'soft' | 'hard'
  pause_reason: string | null
  paused_by: string | null
  paused_at: number | null
  control_epoch: Generated<number>
  max_concurrent_dispatches: Generated<number>
  app_base_url: string | null
  updated_at: Generated<number>
}

export type RuntimeControl = Selectable<RuntimeControlTable>
export type NewRuntimeControl = Insertable<RuntimeControlTable>
export type RuntimeControlUpdate = Updateable<RuntimeControlTable>

// ============================================================================
// Background Tasks (run-scoped detachable command tracking)
// ============================================================================

export interface BackgroundTaskTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  sprite_name: string
  sprite_session_id: string
  label: string | null
  command: string
  cwd: string | null
  status: Generated<string> // 'running' | 'succeeded' | 'failed' | 'killed'
  cleanup_on_run_end: Generated<number> // 0 or 1
  exit_code: number | null
  error_text: string | null
  output_tail: string | null
  started_at: number
  finished_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type BackgroundTask = Selectable<BackgroundTaskTable>
export type NewBackgroundTask = Insertable<BackgroundTaskTable>
export type BackgroundTaskUpdate = Updateable<BackgroundTaskTable>

// ============================================================================
// Model Call Payloads (content-addressed deduped payload blobs)
// ============================================================================

export interface ModelCallPayloadTable {
  hash: string
  payload_json: string
  metadata_json: string | null
  byte_size: number
  created_at: Generated<number>
}

export type ModelCallPayload = Selectable<ModelCallPayloadTable>
export type NewModelCallPayload = Insertable<ModelCallPayloadTable>
export type ModelCallPayloadUpdate = Updateable<ModelCallPayloadTable>

// ============================================================================
// Inference Calls (cost tracking)
// ============================================================================

export interface InferenceCallTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  turn: number
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: Generated<number>
  cache_write_tokens: Generated<number>
  cost_usd: number | null
  tool_call_names: string | null // JSON array: ["bash","write_file"]
  finish_reason: string | null // 'stop', 'tool_calls', 'length'
  is_fallback: Generated<number> // 0 or 1
  duration_ms: number | null
  request_payload_hash: string | null
  response_payload_hash: string | null
  attempt_kind: string | null
  attempt_index: number | null
  payload_state: string | null
  model_span_id: string | null
  created_at: Generated<number>
}

export type InferenceCall = Selectable<InferenceCallTable>
export type NewInferenceCall = Insertable<InferenceCallTable>

// ============================================================================
// Cost Limits
// ============================================================================

export interface CostLimitTable {
  id: Generated<string>
  agent_id: string | null // null for org-level limits
  period: string // 'hourly', 'daily', 'monthly'
  limit_usd: number
  enabled: Generated<number> // 0 or 1
  scope: Generated<string> // 'org', 'team', 'agent'
  team_id: string | null // FK to teams.id, used when scope='team'
  soft_limit_pct: Generated<number> // percentage at which to warn (default 100)
  hard_limit_pct: Generated<number> // percentage at which to hard-stop (default 150)
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type CostLimit = Selectable<CostLimitTable>
export type NewCostLimit = Insertable<CostLimitTable>
export type CostLimitUpdate = Updateable<CostLimitTable>

// ============================================================================
// Spans (execution tracing)
// ============================================================================

export interface SpanTable {
  id: Generated<string>
  trace_id: string
  parent_span_id: string | null
  name: string // 'job', 'turn', 'model_call', 'tool_exec', etc.
  kind: string // 'lifecycle', 'inference', 'tool', 'internal'
  status: Generated<string> // 'ok', 'error'
  start_time: number // Unix ms
  end_time: number | null
  duration_ms: number | null
  attributes: string | null // JSON object
  job_id: string
  agent_id: string
  created_at: Generated<number>
}

export type Span = Selectable<SpanTable>
export type NewSpan = Insertable<SpanTable>
export type SpanUpdate = Updateable<SpanTable>

// ============================================================================
// Capability Settings (optional feature API keys — web search, etc.)
// ============================================================================

export interface CapabilitySettingsTable {
  id: string // 'web_search', future: 'pdf_reader', etc.
  provider: string // 'tavily'
  api_key_encrypted: string | null
  enabled: Generated<number> // 0 or 1
  config: string | null // JSON for provider-specific settings
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type CapabilitySetting = Selectable<CapabilitySettingsTable>
export type NewCapabilitySetting = Insertable<CapabilitySettingsTable>
export type CapabilitySettingUpdate = Updateable<CapabilitySettingsTable>

// ============================================================================
// Credentials (agent-scoped external API keys)
// ============================================================================

export interface CredentialTable {
  id: Generated<string>
  alias: string // globally unique immutable alias used by agent tools
  provider: string
  auth_type: Generated<string> // 'api_key'
  secret_encrypted: string
  auth_key: string
  auth_scheme: string | null // e.g. 'Bearer'
  allowed_hosts: string // JSON string[]
  enabled: Generated<number> // 0 or 1
  allowed_in_header: Generated<number> // 0 or 1
  allowed_in_query: Generated<number> // 0 or 1
  allowed_in_body: Generated<number> // 0 or 1
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Credential = Selectable<CredentialTable>
export type NewCredential = Insertable<CredentialTable>
export type CredentialUpdate = Updateable<CredentialTable>

export interface AgentCredentialTable {
  agent_id: string
  credential_id: string
  created_at: Generated<number>
}

export type AgentCredential = Selectable<AgentCredentialTable>
export type NewAgentCredential = Insertable<AgentCredentialTable>

// ============================================================================
// External API Calls (cost tracking for non-inference APIs — Tavily, etc.)
// ============================================================================

export interface ExternalApiCallTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  provider: string // 'tavily'
  operation: string // 'search', 'extract'
  tool_call_id: string | null
  media_artifact_id: string | null
  cost_usd: number | null
  credits_used: number | null
  pricing_status: Generated<string> // 'actual' | 'estimated' | 'unknown'
  pricing_source: string | null
  duration_ms: number | null
  metadata: string | null // JSON
  created_at: Generated<number>
}

export type ExternalApiCall = Selectable<ExternalApiCallTable>
export type NewExternalApiCall = Insertable<ExternalApiCallTable>

// ============================================================================
// Media Artifacts (durable media receipts + blob storage + delivery receipts)
// ============================================================================

export interface MediaArtifactTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  artifact_type: string // 'image' | 'audio' | 'transcript'
  provider: string
  model: string
  operation: string // 'generate_image' | 'transcribe_audio' | 'synthesize_speech'
  file_path: string | null
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  transcript_text: string | null
  metadata: string | null // JSON
  cost_usd: number | null
  created_at: Generated<number>
}

export type MediaArtifact = Selectable<MediaArtifactTable>
export type NewMediaArtifact = Insertable<MediaArtifactTable>
export type MediaArtifactUpdate = Updateable<MediaArtifactTable>

export interface MediaArtifactBlobTable {
  artifact_id: string
  blob_data: Uint8Array
  sha256: string
  created_at: Generated<number>
}

export type MediaArtifactBlob = Selectable<MediaArtifactBlobTable>
export type NewMediaArtifactBlob = Insertable<MediaArtifactBlobTable>
export type MediaArtifactBlobUpdate = Updateable<MediaArtifactBlobTable>

export interface MediaArtifactDeliveryTable {
  id: Generated<string>
  media_artifact_id: string
  effect_outbox_id: string
  plugin_instance_id: string
  channel: string
  status: string // 'sent' | 'skipped' | 'failed'
  provider_ref: string | null
  error_text: string | null
  metadata: string | null // JSON
  created_at: Generated<number>
}

export type MediaArtifactDelivery = Selectable<MediaArtifactDeliveryTable>
export type NewMediaArtifactDelivery = Insertable<MediaArtifactDeliveryTable>
export type MediaArtifactDeliveryUpdate = Updateable<MediaArtifactDeliveryTable>

// ============================================================================
// Activity Log (cross-agent activity tracking)
// ============================================================================

export type ActivityLogStatus = 'starting' | 'completed' | 'failed' | 'passed'

export interface ActivityLogTable {
  id: Generated<string>
  agent_id: string
  agent_handle: string // denormalized for display
  job_id: string | null
  session_key: string | null
  status: string // ActivityLogStatus
  summary: string // freeform triage summary
  resources: string | null // JSON array of freeform resource identifiers
  embedding: Uint8Array | null // vector for similarity search on summary
  created_at: Generated<number>
}

export type ActivityLogEntry = Selectable<ActivityLogTable>
export type NewActivityLogEntry = Insertable<ActivityLogTable>

// ============================================================================
// Agent Messages (inter-agent private messaging)
// ============================================================================

export interface AgentMessageTable {
  id: Generated<string>
  from_agent_id: string
  to_agent_id: string
  session_key: string | null
  content: string
  delivered: Generated<number> // 0 or 1
  created_at: Generated<number>
}

export type AgentMessage = Selectable<AgentMessageTable>
export type NewAgentMessage = Insertable<AgentMessageTable>

// ============================================================================
// Skills
// ============================================================================

export interface SkillTable {
  id: Generated<string>
  name: string
  slug: string
  description: string | null
  category: Generated<string>
  source_kind: string // 'admin' | 'plugin'
  plugin_id: string | null
  source_ref: string | null
  content: string // SKILL.md content (DB is the authoritative store)
  is_directory: Generated<number> // 0/1
  version: string | null
  checksum: string | null
  enabled: Generated<number> // 0/1
  tags_json: string | null // JSON string[]
  requires_tools_json: string | null // JSON string[]
  metadata_json: string | null // JSON object
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Skill = Selectable<SkillTable>
export type NewSkill = Insertable<SkillTable>
export type SkillUpdate = Updateable<SkillTable>

export interface SkillFileTable {
  id: Generated<string>
  skill_id: string
  relative_path: string
  content: string // file content (DB is the authoritative store)
  content_type: string | null
  size_bytes: number | null
  checksum: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type SkillFile = Selectable<SkillFileTable>
export type NewSkillFile = Insertable<SkillFileTable>
export type SkillFileUpdate = Updateable<SkillFileTable>

export interface SkillAssignmentTable {
  id: Generated<string>
  skill_id: string
  skill_slug: string
  scope: string // 'global' | 'team' | 'agent'
  scope_id: string | null
  priority: Generated<number>
  auto_inject: Generated<number> // 0/1
  enabled: Generated<number> // 0/1
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type SkillAssignment = Selectable<SkillAssignmentTable>
export type NewSkillAssignment = Insertable<SkillAssignmentTable>
export type SkillAssignmentUpdate = Updateable<SkillAssignmentTable>

// ============================================================================
// Rubrics (eval scoring templates)
// ============================================================================

export interface RubricTable {
  id: Generated<string>
  name: string
  description: string | null
  criteria_json: string // JSON array of RubricCriterion
  version: Generated<number>
  judge_model: string | null
  created_by: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Rubric = Selectable<RubricTable>
export type NewRubric = Insertable<RubricTable>
export type RubricUpdate = Updateable<RubricTable>

// ============================================================================
// Evaluators (typed evaluation pipeline instances)
// ============================================================================

export interface EvaluatorTable {
  id: Generated<string>
  name: string
  description: string | null
  type: string // 'llm_judge' | 'programmatic' | 'statistical' | 'safety' | 'human_feedback' | 'task_completion' | 'custom'
  config_json: string // Type-specific configuration
  judge_model: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Evaluator = Selectable<EvaluatorTable>
export type NewEvaluator = Insertable<EvaluatorTable>
export type EvaluatorUpdate = Updateable<EvaluatorTable>

// ============================================================================
// Agent Evaluators (assignment join table)
// ============================================================================

export interface AgentEvaluatorTable {
  id: Generated<string>
  agent_id: string
  evaluator_id: string
  weight: Generated<number> // real, default 1.0
  is_active: Generated<number> // 0 or 1
  sample_rate: number | null
  is_gate: Generated<number> // 0 or 1
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type AgentEvaluator = Selectable<AgentEvaluatorTable>
export type NewAgentEvaluator = Insertable<AgentEvaluatorTable>
export type AgentEvaluatorUpdate = Updateable<AgentEvaluatorTable>

// ============================================================================
// Eval Runs (pipeline-level eval execution)
// ============================================================================

export interface EvalRunTable {
  id: Generated<string>
  job_id: string
  agent_id: string
  work_item_id: string
  trigger: Generated<string> // 'auto' | 'manual'
  status: Generated<string> // 'pending' | 'running' | 'completed' | 'failed'
  overall_score: number | null
  gates_passed: number | null // 0 or 1
  pipeline_result_json: string | null
  total_cost_usd: number | null
  error_text: string | null
  started_at: number | null
  completed_at: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type EvalRun = Selectable<EvalRunTable>
export type NewEvalRun = Insertable<EvalRunTable>
export type EvalRunUpdate = Updateable<EvalRunTable>

// ============================================================================
// Eval Results (per-evaluator results within a pipeline run)
// ============================================================================

export interface EvalResultTable {
  id: Generated<string>
  eval_run_id: string
  evaluator_id: string
  result_type: string // 'score' | 'pass_fail' | 'classification' | 'metrics'
  score: number | null
  passed: number | null // 0 or 1
  details_json: string | null
  evaluator_config_snapshot_json: string
  cost_usd: number | null
  duration_ms: number | null
  created_at: Generated<number>
}

export type EvalResult = Selectable<EvalResultTable>
export type NewEvalResult = Insertable<EvalResultTable>

// ============================================================================
// Improvement Suggestions (AI-generated from eval results)
// ============================================================================

export interface ImprovementSuggestionTable {
  id: Generated<string>
  agent_id: string
  eval_run_ids: string // JSON array of eval_run IDs
  category: string // 'soul' | 'tools' | 'model' | 'memory' | 'general'
  title: string
  description: string
  priority: Generated<string> // 'low' | 'medium' | 'high'
  status: Generated<string> // 'pending' | 'accepted' | 'dismissed' | 'applied'
  applied_by: string | null
  applied_at: number | null
  dismissed_at: number | null
  judge_model: string | null
  cost_usd: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type ImprovementSuggestion = Selectable<ImprovementSuggestionTable>
export type NewImprovementSuggestion = Insertable<ImprovementSuggestionTable>
export type ImprovementSuggestionUpdate = Updateable<ImprovementSuggestionTable>

// ============================================================================
// Eval Settings (singleton configuration)
// ============================================================================

export interface EvalSettingsTable {
  id: string // always 'default'
  judge_model: string | null
  max_daily_evals: Generated<number>
  sample_rate_default: Generated<number>
  sample_rate_high_volume_threshold: Generated<number>
  sample_rate_high_volume: Generated<number>
  eval_cost_budget_usd: number | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type EvalSettings = Selectable<EvalSettingsTable>
export type EvalSettingsUpdate = Updateable<EvalSettingsTable>
