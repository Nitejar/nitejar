# Command Execution

Execute commands on sprites. Two approaches:

- **HTTP POST** - Simple, synchronous, no reconnect. Good for quick commands.
- **WebSocket Sessions** - Persistent, reconnectable, streams output. Good for long-running commands.

---

## HTTP POST (Simple)

`POST /v1/sprites/{name}/exec`

Query params: `cmd` (required, repeatable), `path`, `stdin`, `env`, `dir`

Commands use query parameters. For commands with arguments, repeat `cmd=`:

```bash
# Simple command
curl -s -X POST -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec?cmd=whoami"

# Command with arguments (repeat cmd= for each arg)
curl -s -X POST -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec?cmd=ls&cmd=-la"

# With working directory
curl -s -X POST -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec?cmd=ls&cmd=-la&dir=/home/sprite"
```

---

## WebSocket Sessions

Sessions persist across disconnections. Start a command, disconnect, reconnect later to resume output.

### Execute Command (WebSocket)

`WSS /v1/sprites/{name}/exec`

Query params:

- `cmd` (required) - Command to execute (repeat for args)
- `id` - Session ID to attach to existing session
- `tty` - Enable TTY mode (default: false)
- `stdin` - Enable stdin (TTY default: true, non-TTY default: false)
- `cols`, `rows` - Terminal size (default: 80x24)
- `max_run_after_disconnect` - TTY default: `0` (forever), non-TTY default: `10s`
- `env` - Environment variables as `KEY=VALUE` (repeatable)

```javascript
import { SpritesClient } from "@fly/sprites"

const client = new SpritesClient(process.env.SPRITES_TOKEN)
const sprite = client.sprite(process.env.SPRITE_NAME)

// Start a session (TTY mode keeps running after disconnect)
const cmd = sprite.createSession("python", [
  "-c",
  "import time; print('Running...', flush=True); time.sleep(30)",
])

cmd.stdout.on("data", (chunk) => {
  process.stdout.write(chunk)
})

// Session keeps running even if we disconnect
```

### Server Messages

**SessionInfoMessage** - Sent when connected:

```json
{
  "type": "session_info",
  "session_id": 1847,
  "command": "bash",
  "created": 1767609000,
  "cols": 120,
  "rows": 40,
  "is_owner": true,
  "tty": true
}
```

**ExitMessage** - Sent when command exits:

```json
{
  "type": "exit",
  "exit_code": 0
}
```

**PortNotificationMessage** - Sent when a port is opened:

```json
{
  "type": "port_opened",
  "port": 3000,
  "address": "https://my-sprite.sprites.dev:3000",
  "pid": 1847
}
```

### Client Messages

**ResizeMessage** - Resize terminal:

```json
{
  "type": "resize",
  "cols": 180,
  "rows": 50
}
```

---

## List Sessions

`GET /v1/sprites/{name}/exec`

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec" | jq .
```

```javascript
const sessions = await sprite.listSessions()
console.log(JSON.stringify(sessions, null, 2))
```

Response:

```json
[
  {
    "id": 1847,
    "command": "bash",
    "created": "2026-01-05T10:30:00Z",
    "is_active": true,
    "last_activity": "2026-01-05T10:35:00Z",
    "tty": true,
    "workdir": "/home/sprite/myproject",
    "bytes_per_second": 125.5
  }
]
```

---

## Attach to Session

`WSS /v1/sprites/{name}/exec/{session_id}`

Reconnect to a running session to resume streaming output:

```javascript
// Find running session
const sessions = await sprite.listSessions()
const targetSession = sessions.find((s) => s.command.includes("python"))

if (targetSession) {
  console.log(`Attaching to session ${targetSession.id}...`)

  // Attach - receives buffered output from before we connected
  const cmd = sprite.spawn("", [], { sessionId: targetSession.id, tty: true })

  cmd.stdout.on("data", (chunk) => {
    process.stdout.write(chunk)
  })
}
```

```bash
websocat "wss://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec/$SESSION_ID" \
  -H "Authorization: Bearer $SPRITES_TOKEN"
```

---

## Kill Session

`POST /v1/sprites/{name}/exec/{session_id}/kill`

Query params:

- `signal` - Signal to send (default: `SIGTERM`)
- `timeout` - Timeout waiting for exit (default: `10s`)

```bash
curl -s -X POST -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec/$SESSION_ID/kill"
```

```javascript
const response = await fetch(`${client.baseURL}/v1/sprites/${spriteName}/exec/${sessionId}/kill`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
})
```

Returns streaming NDJSON with kill progress:

```json
{"type":"signal","message":"Signaling SIGTERM to process group 1847","pid":1847,"signal":"SIGTERM"}
{"type":"exited","message":"Process exited"}
{"type":"complete","exit_code":0}
```

Event types: `signal`, `timeout`, `exited`, `killed`, `error`, `complete`
