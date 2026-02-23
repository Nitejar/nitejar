# Task ID: 105

**Title:** GitHub App Credential Management Service

**Status:** done

**Dependencies:** 104 ✓

**Priority:** high

**Description:** Implement the configuration persistence layer for the GitHub App integration, extending the existing integration types to support secure storage of App credentials and configuration settings.

**Details:**

Update the GitHub integration schema and implement helper functions to manage configuration within `packages/integrations`. This implementation replaces the need for a separate `GithubCredentialService` in the backend package by leveraging the existing Integration store and encryption patterns.

Specific requirements:
- Modify `packages/integrations/src/github/types.ts` to extend the config schema.
- Add fields: `appId`, `clientId`, `clientSecret`, `webhookSecret`, `privateKey`, `permissions` (preset object), and `tokenTTL`.
- Ensure `privateKey`, `clientSecret`, and `webhookSecret` are identified or handled as `sensitiveFields` to ensure `encryptConfig` and `decryptConfig` logic is applied during persistence in `apps/web` admin actions and the integrations router.
- Create helper functions in `packages/integrations/src/github/index.ts` (or `config.ts`) to read and write the configuration via the `Integration` store/service.
- Ensure types align with `packages/integrations/src/index.ts` definition of `IntegrationDefinition`.

**Test Strategy:**

Unit test the schema validation in `packages/integrations`. Verify that helper functions correctly handle the `sensitiveFields` by mocking the encryption utilities and checking that `privateKey` is encrypted before storage and decrypted upon retrieval. Verify type compatibility with the main Integration store.

## Subtasks

### 105.1. Update GitHub Integration Schema

**Status:** done  
**Dependencies:** None  

Extend `GitHubIntegrationConfig` in `packages/integrations/src/github/types.ts` to include `appId`, `clientId`, `clientSecret`, `webhookSecret`, `privateKey`, `permissions`, and `tokenTTL`.

**Details:**

Define the Zod schema or TypeScript interfaces required. Ensure sensitive fields are marked or documented for encryption middleware.

### 105.2. Implement Configuration Helper Functions

**Status:** done  
**Dependencies:** 105.1  

Create functions to retrieve and save GitHub App configuration within `packages/integrations/src/github`.

**Details:**

Implement `getGitHubAppConfig` and `saveGitHubAppConfig` (or similar) that interact with the generic Integration store. Ensure these helpers handle the distinction between raw and encrypted values if not handled automatically by the store.
