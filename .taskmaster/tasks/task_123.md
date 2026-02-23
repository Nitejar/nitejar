# Task ID: 123

**Title:** End-to-End Workflow Integration Test

**Status:** done

**Dependencies:** 119 ✓, 118 ✓, 121 ✓, 122 ✓

**Priority:** medium

**Description:** Verify the technical execution of the approval workflow: Agent messages Telegram -> Webhook injects reply -> Agent invokes merge tool. Focus on transport and context injection.

**Details:**

The E2E test validates the technical plumbing of the conversation loop rather than the LLM's reasoning capabilities. We assume the LLM will decide to merge given the correct context; this test ensures the context is correctly constructed and tools are invokable.

1. **Setup**: Configure a test harness with mocked GitHub and Telegram services.
2. **Notification Transport**: Trigger the agent to send a message. Verify the Telegram mock receives the correct payload.
3. **Webhook Injection**: Simulate an incoming Telegram webhook payload (e.g., user replying to the previous message).
4. **Context Loop**: Verify the webhook payload is correctly transformed and injected into the Agent's conversation history/context.
5. **Tool Execution**: Verify the agent can successfully invoke the `merge_pr` tool given a mocked 'approved' state, ensuring the tool execution path functions correctly.

**Test Strategy:**

Use the integration test harness to validate the I/O boundaries.
1. **Mock GitHub**: Stub `create_pr` and `merge_pr` to return success without hitting real API.
2. **Mock Telegram**: Capture outgoing HTTP requests from Agent to Telegram API. Inject incoming JSON payloads representing webhooks.
3. **Assertions**: 
   - Verify outgoing Telegram HTTP request contains expected chat_id.
   - Verify incoming webhook is parsed and added to Agent memory.
   - Verify `merge_pr` tool function is called.

## Subtasks

### 123.1. Create Test Harness for Telegram-Agent Loop

**Status:** done  
**Dependencies:** None  

Set up a test script that can instantiate an Agent, mock the Telegram connector (input/output), and mock GitHub tool calls.

**Details:**

Use existing testing libraries. Ensure the agent's memory/context can be primed with the 'history' of the conversation.

### 123.2. Validate Transport: Agent to Telegram

**Status:** done  
**Dependencies:** 123.1  

Verify the agent's outgoing message correctly hits the mocked Telegram API endpoint.

**Details:**

Trigger a send_message action. Assert the mock received a POST request with the correct structure (chat_id, text). Do not validate specific prompt text, just the schema compliance.

### 123.3. Validate Transport: Webhook to Agent Context

**Status:** done  
**Dependencies:** 123.2  

Simulate an incoming Telegram webhook and verify it appears in the Agent's running context.

**Details:**

POST a standard Telegram update JSON to the webhook handler. Check the Agent's internal state/memory to confirm the message was parsed and appended to history.

### 123.4. Verify Merge Tool Invocation

**Status:** done  
**Dependencies:** 123.3  

Force the agent to invoke the merge tool and verify the mock GitHub client receives the call.

**Details:**

Skip the 'reasoning' phase validation. Manually invoke the tool or prime the agent with a 'MERGE NOW' directive to ensure the `merge_pr` function executes and calls the GitHub mock.
