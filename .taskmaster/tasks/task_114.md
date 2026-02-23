# Task ID: 114

**Title:** Configure Telegram Bot and Basic Messaging Service

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Configure the existing Telegram integration located in `packages/integrations/src/telegram` to handle messaging and webhooks. Avoid introducing external libraries like `telegraf` or creating redundant service classes. Focus on enhancing the existing client to support approval workflows.

**Details:**

1. Analyze `packages/integrations/src/telegram/client.ts` and verify existing `sendMessage` implementation.
2. Ensure the Telegram webhook is correctly configured and wired into the application's main entry point (likely `packages/agent/src/index.ts` or similar).
3. Add helper methods to `TelegramClient` in `client.ts` specifically for sending approval prompts (e.g., `sendApprovalRequest(chatId, context)`).
4. Verify configuration loading for `TELEGRAM_BOT_TOKEN` and webhook secrets in the existing integration config.
5. Ensure the integration handles incoming webhook events and routes them appropriately.

**Test Strategy:**

Unit test the `TelegramClient` methods by mocking the underlying HTTP requests. Integration test by triggering a webhook event locally and verifying the response, or by sending a test message to a known Chat ID using the configured client.

## Subtasks

### 114.1. Verify Telegram Client Implementation

**Status:** done  
**Dependencies:** None  

Review `packages/integrations/src/telegram/client.ts`. Ensure `sendMessage` exists and uses the native Telegram Bot API via fetch/axios. Refactor if necessary to ensure types are correct.

**Details:**

Check specifically for the POST /sendMessage endpoint usage.

### 114.2. Implement Approval Prompt Helper

**Status:** done  
**Dependencies:** 114.1  

Add a method `sendApprovalPrompt` to `TelegramClient`. This should format a message asking for user approval (e.g., for a PR merge) and potentially include inline keyboard buttons if supported/needed, or standard text instructions.

**Details:**

Method signature: `sendApprovalPrompt(chatId: string, message: string): Promise<void>`.

### 114.3. Wire Webhook and Config

**Status:** done  
**Dependencies:** None  

Ensure the Telegram webhook endpoint is registered in the main application router and validates the secret token. Ensure `TELEGRAM_BOT_TOKEN` is loaded from environment variables into the integration config.

**Details:**

Verify `packages/integrations/src/telegram/index.ts` (or equivalent export) exports the webhook handler.
