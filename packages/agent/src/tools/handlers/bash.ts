import type Anthropic from '@anthropic-ai/sdk'
import { spriteExec } from '@nitejar/sprites'
import { CWD_MARKER, formatExecResultWithCwd } from '../helpers'
import type { ToolHandler } from '../types'

export const bashDefinition: Anthropic.Tool = {
  name: 'bash',
  description:
    'Execute a bash command on the sprite. Use this for running commands, installing packages, running scripts, etc.',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (optional)',
      },
      timeout: {
        type: 'integer',
        description:
          'Timeout in seconds (default: 300, max: 600). Increase for long-running operations like large package installs.',
      },
    },
    required: ['command'],
  },
}

export const bashTool: ToolHandler = async (input, context) => {
  const command = input.command as string
  const requestedCwd =
    typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined
  const timeoutSec =
    typeof input.timeout === 'number' ? Math.max(10, Math.min(input.timeout, 600)) : undefined
  // Capture cwd and preserve the original exit code.
  // Use (exit N) in a subshell to set $? without killing the session shell.
  const cwdCapture = `__nitejar_ec=$?; echo "${CWD_MARKER}$(pwd)"; (exit $__nitejar_ec)`
  const commandWithEnv = [
    'export CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 NPM_CONFIG_YES=true',
    'if [ -f ~/.nitejar/env ]; then . ~/.nitejar/env; fi',
    command,
    cwdCapture,
  ].join('\n')
  const execOptions = {
    ...(requestedCwd
      ? { cwd: requestedCwd }
      : !context.session && context.cwd
        ? { cwd: context.cwd }
        : {}),
    ...(timeoutSec ? { timeout: timeoutSec * 1000 } : {}),
    session: context.session,
  }
  // Use session if available for stateful execution (cd persists, etc.)
  const result = await spriteExec(context.spriteName, commandWithEnv, execOptions)
  return formatExecResultWithCwd(result)
}
