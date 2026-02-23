# Task ID: 109

**Title:** Capability Enforcement Layer

**Status:** done

**Dependencies:** 108 ✓

**Priority:** medium

**Description:** Implement the logic to enforce manual per-repository capabilities for agents using Kysely, ensuring verification before token issuance.

**Details:**

Implement the `CapabilityService` to enforce granular access controls defined in the `agent_repo_capabilities` table using Kysely repositories.

Key Requirements:
- **No Org-Level Defaults:** Access must be explicitly granted per repository.
- **Schema Usage:** Query the `agent_repo_capabilities` table defined in `packages/database/migrations` and typed in `packages/database/src/types.ts`.
- **Location:** Implement the service in `apps/web/server/services/capability.ts`.
- **Integration:** 
  - Modify the Credential Provider implemented in Task 108 to inject the capability check.
  - Before issuing a token, invoke `CapabilityService.verifyCapability(agentId, repoId, requiredCapability)`.
- **Audit Logging:** 
  - Log successful access grants and denied attempts to the `audit_logs` table.
  - Include metadata: `agentId`, `repoId`, `capability`, and `result`.

File Structure References:
- `packages/database/src/types.ts` (Database Types)
- `packages/database/migrations` (Schema definitions)
- `apps/web/server/services/capability.ts` (New Service)
- `apps/web/server/services/credential-provider.ts` (Integration point - provisional name based on Task 108)

**Test Strategy:**

Create unit tests for `CapabilityService` verifying that missing rows in `agent_repo_capabilities` result in denial. Create integration tests mocking the database to ensure the credential provider calls the verification step and logs to the audit table correctly before issuing a token.

## Subtasks

### 109.1. Implement CapabilityService with Kysely

**Status:** done  
**Dependencies:** None  

Create the `CapabilityService` class in `apps/web/server/services/capability.ts` with a `verifyCapability` method that queries the `agent_repo_capabilities` table using Kysely.

**Details:**

The method should accept `agentId`, `repoId`, and `CapabilityType` (from `packages/database/src/types.ts`). It returns a boolean or throws an error if the record does not exist. Ensure no organizational fallbacks are used.

### 109.2. Integrate with Credential Provider

**Status:** done  
**Dependencies:** 109.1  

Update the token issuance logic to enforce capability checks.

**Details:**

Modify the Credential Provider (from Task 108) to call `CapabilityService.verifyCapability` before requesting an installation token. Handle 'Access Denied' errors gracefully.

### 109.3. Implement Audit Logging

**Status:** done  
**Dependencies:** 109.2  

Add audit logging for capability checks (both allowed and denied).

**Details:**

Record events to the `audit_logs` table via Kysely. Log 'CAPABILITY_CHECK_PASS' and 'CAPABILITY_CHECK_FAIL' events with relevant metadata (agent ID, repo ID, requested capability).
