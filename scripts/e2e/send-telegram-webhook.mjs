#!/usr/bin/env node

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

async function main() {
  const args = parseArgs(process.argv)

  const pluginInstanceId = getRequired(args, 'plugin-instance-id')
  const chatId = Number(getRequired(args, 'chat-id'))
  const text = getRequired(args, 'text')

  const threadId = args['thread-id'] ? Number(args['thread-id']) : undefined
  const senderId = Number(args['sender-id'] ?? '42000001')
  const senderName = args['sender-name'] ?? 'E2E'
  const senderUsername = args['sender-username'] ?? 'e2e'
  const server = args.server ?? 'http://localhost:3000'
  const updateId = Number(args['update-id'] ?? `${Date.now()}`.slice(0, 10))
  const messageId = Number(args['message-id'] ?? `${Date.now()}`.slice(-7))
  const ts = Math.floor(Date.now() / 1000)

  const payload = {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: ts,
      text,
      chat: { id: chatId, type: 'supergroup' },
      from: {
        id: senderId,
        is_bot: false,
        first_name: senderName,
        username: senderUsername,
      },
      ...(threadId ? { message_thread_id: threadId } : {}),
    },
  }

  const response = await fetch(`${server}/api/webhooks/plugins/telegram/${pluginInstanceId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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
      pluginInstanceId,
      updateId,
      messageId,
      body,
    })
  )
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
