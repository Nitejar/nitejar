# Telegram Integration Setup

This guide walks through setting up a Telegram bot to work with Nitejar.

## Prerequisites

- A Telegram account
- Nitejar deployed and accessible via HTTPS

## Step 1: Create a Bot with BotFather

1. Open Telegram and search for `@BotFather`
2. Start a chat and send `/newbot`
3. Follow the prompts:
   - Enter a display name for your bot (e.g., "My Nitejar")
   - Enter a username for your bot (must end in `bot`, e.g., `my_nitejar_bot`)
4. BotFather will give you a **bot token** - save this securely

```
Done! Congratulations on your new bot. You will find it at t.me/my_nitejar_bot.
Use this token to access the HTTP API:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

## Step 2: Create Telegram Plugin Instance in Nitejar

1. Go to your Nitejar admin UI: `https://your-domain/admin`
2. Navigate to **Plugins**
3. In **Connected Plugin Instances**, create a Telegram instance:
   - **Type**: `telegram`
   - **Name**: A friendly name (e.g., "My Telegram Bot")
   - **Config**: `{"botToken": "YOUR_BOT_TOKEN_HERE"}`
4. Open the plugin instance detail page
5. Note the plugin instance ID from the URL (e.g., `/admin/plugins/instances/abc123`)

## Step 3: Configure Webhook URL

Tell Telegram where to send messages by setting the webhook URL.

### Option A: Via BotFather (Simplest)

1. In your BotFather chat, send `/setwebhook`
2. Select your bot
3. Enter your webhook URL:
   ```
   https://your-domain/api/webhooks/plugins/telegram/PLUGIN_INSTANCE_ID
   ```

### Option B: Via Telegram API (More Control)

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain/api/webhooks/plugins/telegram/PLUGIN_INSTANCE_ID",
    "allowed_updates": ["message"]
  }'
```

### Verify Webhook

Check that your webhook is set correctly:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Expected response:

```json
{
  "ok": true,
  "result": {
    "url": "https://your-domain/api/webhooks/plugins/telegram/...",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Step 4: Test the Integration

1. Open Telegram and find your bot (search for `@your_bot_username`)
2. Send a message like "Hello!"
3. Check the Nitejar admin UI:
   - Go to **Inbox** to see the work item created
   - Check **Jobs** to see if an agent picked it up

## Troubleshooting

### Webhook not receiving messages

- Ensure your domain uses HTTPS (Telegram requires this)
- Check that the plugin instance ID in the webhook URL is correct
- Verify the webhook is set: `curl https://api.telegram.org/botTOKEN/getWebhookInfo`

### Bot not responding

- Check if an agent is created and assigned to handle Telegram work items
- Look at the Jobs page in admin UI for errors
- Check server logs for any exceptions

### "Unauthorized" errors

- Verify the bot token is correct in the plugin instance config
- Make sure there are no extra spaces or characters in the token

## Bot Commands (Optional)

You can set up command hints in BotFather:

1. Send `/setcommands` to BotFather
2. Select your bot
3. Enter commands:
   ```
   start - Start interacting with the bot
   help - Get help information
   status - Check bot status
   ```

## Security Notes

- Never share your bot token publicly
- The token is stored encrypted in Nitejar's database
- Consider using `webhook_secret` for additional verification (not yet implemented)
- Restrict who can message your bot if needed (BotFather > `/setjoingroups`)
