import { downloadAttachmentTool } from './attachments'
import { bashTool } from './bash'
import {
  createDirectoryTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  useSkillTool,
  writeFileTool,
} from './filesystem'
import { configureGitHubCredentialsTool } from './github'
import { addMemoryTool, removeMemoryTool, updateMemoryTool } from './memory'
import { refreshNetworkPolicyTool } from './network-policy'
import { runTodoTool } from './run-todo'
import { cancelScheduledTool, listScheduleTool, scheduleCheckTool } from './schedule'
import {
  createRoutineTool,
  listRoutinesTool,
  updateRoutineTool,
  pauseRoutineTool,
  deleteRoutineTool,
  runRoutineNowTool,
} from './routines'
import {
  createEphemeralSandboxTool,
  deleteSandboxTool,
  listSandboxesTool,
  switchSandboxTool,
} from './sandboxes'
import { getSelfConfigTool } from './self-config'
import {
  createServiceTool,
  getSpriteUrlTool,
  listServicesTool,
  manageServiceTool,
} from './services'
import {
  checkBackgroundTaskTool,
  listBackgroundTasksTool,
  startBackgroundTaskTool,
  stopBackgroundTaskTool,
} from './background-tasks'
import { extractUrlTool, webSearchTool } from './web'
import { generateImageTool, synthesizeSpeechTool, transcribeAudioTool } from './media'
import { queryActivityTool } from './activity-log'
import { listRunsTool, getRunTool } from './run-history'
import {
  collectionDescribeTool,
  defineCollectionTool,
  collectionGetTool,
  collectionInsertTool,
  collectionQueryTool,
  collectionSearchTool,
  collectionUpsertTool,
} from './collections'
import { listCredentialsTool, secureHttpRequestTool } from './credentials'
import {
  createAgentTool,
  deleteAgentTool,
  getAgentConfigTool,
  getAgentSoulTool,
  listAgentsTool,
  setAgentStatusTool,
  updateAgentConfigTool,
  updateAgentSoulTool,
} from './platform-control'
import type { ToolHandler } from '../types'

export const toolHandlers: Record<string, ToolHandler> = {
  refresh_network_policy: refreshNetworkPolicyTool,
  configure_github_credentials: configureGitHubCredentialsTool,
  add_memory: addMemoryTool,
  remove_memory: removeMemoryTool,
  update_memory: updateMemoryTool,
  bash: bashTool,
  read_file: readFileTool,
  write_file: writeFileTool,
  list_directory: listDirectoryTool,
  create_directory: createDirectoryTool,
  edit_file: editFileTool,
  use_skill: useSkillTool,
  create_service: createServiceTool,
  list_services: listServicesTool,
  manage_service: manageServiceTool,
  get_sprite_url: getSpriteUrlTool,
  get_self_config: getSelfConfigTool,
  list_sandboxes: listSandboxesTool,
  switch_sandbox: switchSandboxTool,
  create_ephemeral_sandbox: createEphemeralSandboxTool,
  delete_sandbox: deleteSandboxTool,
  schedule_check: scheduleCheckTool,
  list_schedule: listScheduleTool,
  cancel_scheduled: cancelScheduledTool,
  create_routine: createRoutineTool,
  list_routines: listRoutinesTool,
  update_routine: updateRoutineTool,
  pause_routine: pauseRoutineTool,
  delete_routine: deleteRoutineTool,
  run_routine_now: runRoutineNowTool,
  define_collection: defineCollectionTool,
  collection_describe: collectionDescribeTool,
  collection_query: collectionQueryTool,
  collection_search: collectionSearchTool,
  collection_get: collectionGetTool,
  collection_insert: collectionInsertTool,
  collection_upsert: collectionUpsertTool,
  list_credentials: listCredentialsTool,
  secure_http_request: secureHttpRequestTool,
  list_agents: listAgentsTool,
  get_agent_config: getAgentConfigTool,
  get_agent_soul: getAgentSoulTool,
  create_agent: createAgentTool,
  set_agent_status: setAgentStatusTool,
  delete_agent: deleteAgentTool,
  update_agent_config: updateAgentConfigTool,
  update_agent_soul: updateAgentSoulTool,
  start_background_task: startBackgroundTaskTool,
  check_background_task: checkBackgroundTaskTool,
  list_background_tasks: listBackgroundTasksTool,
  stop_background_task: stopBackgroundTaskTool,
  run_todo: runTodoTool,
  web_search: webSearchTool,
  extract_url: extractUrlTool,
  generate_image: generateImageTool,
  transcribe_audio: transcribeAudioTool,
  synthesize_speech: synthesizeSpeechTool,
  download_attachment: downloadAttachmentTool,
  query_activity: queryActivityTool,
  // Intentionally disabled: private agent DMs are off while we stabilize
  // public-channel inter-agent communication and routing receipts.
  list_runs: listRunsTool,
  get_run: getRunTool,
}
