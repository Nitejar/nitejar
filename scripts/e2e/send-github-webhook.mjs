#!/usr/bin/env node

import { execSync } from 'node:child_process'
import crypto from 'node:crypto'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = value
    i++
  }
  return args
}

function getRequired(args, key) {
  const value = args[key]
  if (!value) fail(`Missing required arg: --${key}`)
  return value
}

function readWebhookSecret(dbPath, pluginInstanceId) {
  const query = `SELECT json_extract(config_json,'$.webhookSecret') FROM plugin_instances WHERE id='${pluginInstanceId}';`
  const output = execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf8' }).trim()
  if (!output) fail(`No webhook secret found for plugin instance ${pluginInstanceId}`)
  return output
}

async function main() {
  const args = parseArgs(process.argv)

  const pluginInstanceId = getRequired(args, 'plugin-instance-id')
  const issueNumber = Number(getRequired(args, 'issue-number'))
  const commentId = Number(getRequired(args, 'comment-id'))
  const text = getRequired(args, 'text')

  const owner = args.owner ?? 'nitejar'
  const repo = args.repo ?? 'nitejar'
  const installationId = Number(args['installation-id'] ?? '108277033')
  const senderLogin = args['sender-login'] ?? 'matrix-user'
  const senderId = Number(args['sender-id'] ?? '700001')
  const event = args.event ?? 'issue_comment'
  const server = args.server ?? 'http://localhost:3000'
  const dbPath = args.db ?? 'packages/database/data/nitejar.db'
  const delivery = args.delivery ?? `gh-e2e-${Math.floor(Date.now() / 1000)}-${commentId}`

  const secret = readWebhookSecret(dbPath, pluginInstanceId)
  const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`

  const payload = {
    action: 'created',
    repository: { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner } },
    issue: {
      number: issueNumber,
      title: `E2E issue #${issueNumber}`,
      body: 'E2E webhook validation',
      state: 'open',
      html_url: issueUrl,
      user: { login: senderLogin, id: senderId },
    },
    comment: {
      id: commentId,
      body: text,
      html_url: `${issueUrl}#issuecomment-${commentId}`,
      created_at: new Date().toISOString(),
      user: { login: senderLogin, id: senderId },
    },
    sender: { type: 'User', login: senderLogin, id: senderId },
    installation: { id: installationId },
  }

  const raw = JSON.stringify(payload)
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`

  const response = await fetch(`${server}/api/webhooks/plugins/github/${pluginInstanceId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': signature,
    },
    body: raw,
  })

  const bodyText = await response.text()
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = bodyText
  }

  console.log(
    JSON.stringify({
      status: response.status,
      delivery,
      pluginInstanceId,
      issueNumber,
      commentId,
      body,
    })
  )
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
