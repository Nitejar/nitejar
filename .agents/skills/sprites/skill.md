# Sprites Management Skill

Manage Sprites (persistent Linux VMs) via the Sprites API.

## Prerequisites

Set `SPRITES_TOKEN` in `apps/web/.env`.

## Quick Reference

```bash
# Set token for commands
export SPRITES_TOKEN="your-token-here"
export SPRITE_NAME="nitejar-fa61a8b7-8dd7-4182-ab74-aeb4e940e095"
```

Base URL: `https://api.sprites.dev/v1`

## API Reference

- [Sprite Management](management.md) - Create, delete, list, get sprites
- [Command Execution](exec.md) - Run commands on sprites
- [Filesystem Operations](filesystem.md) - Read, write, copy, delete files

## Sprite Status Values

- `cold` - VM not running (will start on first request)
- `warming` - VM is starting up
- `warm` / `running` - VM is ready
- `stopping` - VM is shutting down

## Agent Sprite Naming

Nitejar agents use: `nitejar-{agent_id}`

Example: Agent `fa61a8b7-8dd7-4182-ab74-aeb4e940e095` → Sprite `nitejar-fa61a8b7-8dd7-4182-ab74-aeb4e940e095`

## Troubleshooting

### Verify token works

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites" | jq '.sprites | length'
```

### Check sprite status

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME" | jq '{name, status, url}'
```

### Test command execution

```bash
curl -s -X POST -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/exec?cmd=echo&cmd=hello"
```

## SDK Usage Note

The `@fly/sprites` SDK's `exec()` method uses WebSocket and passes commands directly to the system (not through a shell). To run shell commands with pipes/redirects, wrap in `bash -c`:

```typescript
// This fails: sprite.exec("ls -la")
// This works: sprite.exec("bash", { args: ["-c", "ls -la"] })
```

Our `packages/sprites/src/exec.ts` handles this automatically.
