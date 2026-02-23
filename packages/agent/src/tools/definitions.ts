import type Anthropic from '@anthropic-ai/sdk'
import type { EditToolMode } from '../types'

import { bashDefinition } from './handlers/bash'
import { configureGitHubCredentialsDefinition } from './handlers/github'
import { refreshNetworkPolicyDefinition } from './handlers/network-policy'
import { memoryDefinitions } from './handlers/memory'
import {
  filesystemDefinitions,
  hashlineReadFileDefinition,
  hashlineEditFileDefinition,
} from './handlers/filesystem'
import { serviceDefinitions } from './handlers/services'
import { getSelfConfigDefinition } from './handlers/self-config'
import { scheduleDefinitions } from './handlers/schedule'
import { runTodoDefinition } from './handlers/run-todo'
import { backgroundTaskDefinitions } from './handlers/background-tasks'
import { sandboxDefinitions } from './handlers/sandboxes'
import { webDefinitions } from './handlers/web'
import {
  generateImageDefinition,
  synthesizeSpeechDefinition,
  transcribeAudioDefinition,
} from './handlers/media'
import { downloadAttachmentDefinition } from './handlers/attachments'
import { queryActivityDefinition } from './handlers/activity-log'
import { runHistoryDefinitions } from './handlers/run-history'
import { routineDefinitions } from './handlers/routines'
import { collectionDefinitions } from './handlers/collections'
import { credentialDefinitions } from './handlers/credentials'
import { platformControlDefinitions } from './handlers/platform-control'

const baseToolDefinitions: Anthropic.Tool[] = [
  bashDefinition,
  configureGitHubCredentialsDefinition,
  refreshNetworkPolicyDefinition,
  ...memoryDefinitions,
  ...filesystemDefinitions,
  ...serviceDefinitions,
  getSelfConfigDefinition,
  ...sandboxDefinitions,
  ...scheduleDefinitions,
  ...routineDefinitions,
  ...collectionDefinitions,
  ...credentialDefinitions,
  runTodoDefinition,
  ...backgroundTaskDefinitions,
  ...webDefinitions,
  generateImageDefinition,
  transcribeAudioDefinition,
  synthesizeSpeechDefinition,
  downloadAttachmentDefinition,
  queryActivityDefinition,
  ...platformControlDefinitions,
  // Intentionally disabled: private agent DMs are off while we stabilize
  // public-channel inter-agent communication and routing receipts.
  ...runHistoryDefinitions,
]

export function getToolDefinitions(opts?: { editToolMode?: EditToolMode }): Anthropic.Tool[] {
  const editToolMode = opts?.editToolMode ?? 'hashline'
  if (editToolMode === 'replace') {
    return baseToolDefinitions
  }

  return baseToolDefinitions.map((tool) => {
    if (tool.name === 'read_file') return hashlineReadFileDefinition
    if (tool.name === 'edit_file') return hashlineEditFileDefinition
    return tool
  })
}

export const toolDefinitions: Anthropic.Tool[] = getToolDefinitions({ editToolMode: 'hashline' })
