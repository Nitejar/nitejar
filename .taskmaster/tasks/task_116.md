# Task ID: 116

**Title:** Implement Human Response Parsing for Merge Approval

**Status:** done

**Dependencies:** 114 ✓

**Priority:** high

**Description:** Enhance the Telegram webhook handler to support reply context, enabling the AI agent to interpret human responses naturally. Instead of a rigid keyword parser, the system will forward reply metadata (original message ID, reply text) to the agent, allowing it to understand approvals or feedback in context.

**Details:**

1. Modify `packages/integrations/src/telegram/webhook.ts` (or create if missing) to extract `reply_to_message` details from incoming Telegram updates.
2. Ensure the payload forwarded to the agent includes the text of the reply and the ID of the message being replied to.
3. Verify that the agent's context window or input mechanism can receive this metadata to correlate the reply with the original approval prompt.
4. Remove the requirement for a strict boolean parser; rely on the agent's LLM capabilities to determine intent.

**Test Strategy:**

Simulate a Telegram webhook event containing a reply object. Verify that the extracted data passed to the agent includes the reply text and the `reply_to_message` ID. Ensure the agent receives this as part of the user input stream.

## Subtasks

### 116.1. Remove Strict Parsing Requirement

**Status:** done  
**Dependencies:** None  

Discard the plan for a dedicated regex-based parser utility (`parseApprovalResponse`). This logic will be handled by the agent's LLM inference instead.

**Details:**

Mark previous plans for `parser.ts` as obsolete. No code implementation needed for this step, just architectural alignment.

### 116.2. Update Webhook Handler for Reply Metadata

**Status:** done  
**Dependencies:** None  

Modify the webhook handler to detect and extract reply context from Telegram payloads.

**Details:**

In `packages/integrations/src/telegram/webhook.ts`, inspect the `message` object. If `reply_to_message` exists, extract its `message_id` and include it in the event payload sent to the agent/runtime. Ensure the reply text is treated as the primary user input.

### 116.3. Verify Agent Context Integration

**Status:** done  
**Dependencies:** 116.2  

Ensure the agent receives the reply metadata in a format it can process.

**Details:**

Trace the flow from the webhook to the agent's input handler. Ensure the `reply_to_message` ID is available in the agent's observation or context, allowing it to link 'Yes' or 'Merge it' back to the original proposal.
