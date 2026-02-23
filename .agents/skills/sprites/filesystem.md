# Filesystem Operations

Read, write, and manage files on sprites.

## Read a file

`GET /v1/sprites/{name}/fs/read`

Query params: `path` (required), `workingDir` (required)

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/read?path=.bashrc&workingDir=/home/user"
```

## Write a file

`PUT /v1/sprites/{name}/fs/write`

Query params: `path` (required), `workingDir` (required), `mode` (optional, e.g. '0644'), `mkdir` (optional, create parent dirs)

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  --data-binary "file contents here" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/write?path=test.txt&workingDir=/home/user&mkdir=true"
```

## List directory

`GET /v1/sprites/{name}/fs/list`

Query params: `path` (required), `workingDir` (required)

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/list?path=.&workingDir=/home/user" | jq .
```

## Delete file or directory

`DELETE /v1/sprites/{name}/fs/delete`

Request body: `path`, `workingDir`, `recursive`, `asRoot`

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"test.txt","workingDir":"/home/user","recursive":false,"asRoot":false}' \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/delete"
```

## Rename/move file or directory

`POST /v1/sprites/{name}/fs/rename`

Request body: `source`, `dest`, `workingDir`, `asRoot`

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"old.txt","dest":"new.txt","workingDir":"/home/user","asRoot":false}' \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/rename"
```

## Copy file or directory

`POST /v1/sprites/{name}/fs/copy`

Request body: `source`, `dest`, `workingDir`, `recursive`, `preserveAttrs`, `asRoot`

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"file.txt","dest":"file-copy.txt","workingDir":"/home/user","recursive":false,"preserveAttrs":false,"asRoot":false}' \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/copy"
```

## Change file mode (chmod)

`POST /v1/sprites/{name}/fs/chmod`

Request body: `path`, `workingDir`, `mode`, `recursive`, `asRoot`

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"script.sh","workingDir":"/home/user","mode":"0755","recursive":false,"asRoot":false}' \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/chmod"
```

## Change file owner (chown)

`POST /v1/sprites/{name}/fs/chown`

Request body: `path`, `workingDir`, `uid`, `gid`, `recursive`, `asRoot`

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"file.txt","workingDir":"/home/user","uid":1000,"gid":1000,"recursive":false,"asRoot":true}' \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/chown"
```

## Watch filesystem (WebSocket)

`WSS /v1/sprites/{name}/fs/watch`

Connect via WebSocket to watch for filesystem changes.

```bash
websocat "wss://api.sprites.dev/v1/sprites/$SPRITE_NAME/fs/watch" \
  -H "Authorization: Bearer $SPRITES_TOKEN"
```

Send watch config:

```json
{ "type": "watch", "paths": ["/home/user"], "recursive": true, "workingDir": "/home/user" }
```

Receive events:

```json
{
  "type": "event",
  "path": "/home/user/file.txt",
  "event": "modify",
  "timestamp": "...",
  "size": 123,
  "isDir": false
}
```
