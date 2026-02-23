# Task ID: 166

**Title:** Telegram: Accept images and include in agent context

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Handle Telegram photo uploads by fetching the file and attaching it to the work item context so the agent can see images when the model supports vision.

**Details:**

1. Extend Telegram webhook parsing to detect photo/document images and capture file_id/file_unique_id + caption.
2. Fetch Telegram file URL or bytes via Bot API using stored bot token.
3. Store image metadata/URL in work item or message context (no heavy blob storage required initially).
4. Update prompt builder to include image attachments in the user message for vision-capable models; if model lacks vision, include a short notice and skip images.
5. Add safe guards for file size limits and unsupported mime types.
6. Add integration tests with mocked Telegram API responses (CI-safe, no network).

**Test Strategy:**

1. Post a mocked Telegram webhook with a photo + caption.
2. Verify image metadata is persisted on the work item.
3. Verify prompt builder includes image attachments for vision models.
4. Verify non-vision models skip images with a notice.
5. Ensure CI tests use mocked Telegram API calls.
