# Task ID: 115

**Title:** Implement Telegram Approval Prompt Logic

**Status:** done

**Dependencies:** 114 ✓

**Priority:** medium

**Description:** Expose a functional tool or transport mechanism to allow the agent to send free-form text messages via the existing Telegram integration. The focus is strictly on the transport layer and tool definition, enabling the agent to send arbitrary strings to the configured chat without predefined templates.

**Details:**

1. Verify `TelegramClient` in `packages/integrations/src/telegram/client.ts` supports sending raw text messages.
2. Create or expose a tool definition (e.g., `send_telegram_message`) accessible to the Agent.
3. The tool should accept a single `message` string argument.
4. The tool must retrieve the target `chatId` internally from the application configuration or environment variables (e.g., `TELEGRAM_CHAT_ID`), ensuring security and simplicity for the agent.
5. Ensure the tool calls `TelegramClient.sendMessage` correctly.
6. Note: Do not implement prompt generation logic, specific wording, or approval templates; the agent will determine the content dynamically.

**Test Strategy:**

Unit test the tool definition to ensure it correctly delegates to `TelegramClient.sendMessage` with the provided string and configured chat ID. Perform a manual or integration verification by invoking the tool with a test string (e.g., 'Connectivity check') to confirm delivery to the target Telegram chat.

## Subtasks

### 115.1. Implement Telegram Send Message Tool

**Status:** done  
**Dependencies:** None  

Define and register the tool interface (e.g., `send_telegram_message`) that wraps the existing `TelegramClient`. Ensure it accepts a string input and handles the async dispatch.

**Details:**

Function signature: `(message: string) => Promise<void>`. Implementation should import `TelegramClient` from `packages/integrations`, load config, and execute the send.

### 115.2. Verify Message Transport End-to-End

**Status:** done  
**Dependencies:** 115.1  

Validate that the integration actually connects to the Telegram API and delivers messages.

**Details:**

Execute the new tool with a payload like 'System connectivity test'. Verify receipt in the configured Telegram channel. Ensure no exceptions are thrown for valid network requests.
