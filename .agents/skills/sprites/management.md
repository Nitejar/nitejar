# Sprite Management

Create, delete, list, and get sprite details.

## List all sprites

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites" | jq .
```

## Get sprite details

```bash
curl -s -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME" | jq .
```

## Create a sprite

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-sprite"}' \
  "https://api.sprites.dev/v1/sprites" | jq .
```

## Delete a sprite

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  "https://api.sprites.dev/v1/sprites/$SPRITE_NAME"
```
