# Task ID: 106

**Title:** GitHub App Manifest Flow Implementation

**Status:** done

**Dependencies:** 105 ✓

**Priority:** high

**Description:** Implement the backend logic to generate a GitHub App manifest and handle the code exchange to complete the App registration.

**Details:**

Implement the GitHub App Manifest flow within the `apps/web` tRPC router system. This involves creating a new `github` router if one does not exist and exposing procedures for generating the app manifest and exchanging the returned code for credentials.

Key Implementation Points:
1.  **Router Location**: Implement in `apps/web/server/routers/github.ts` (or create if missing).
2.  **Manifest Generation**: Create a `getManifest` procedure (public or protected based on admin needs) that returns the JSON required by GitHub. 
    - **Webhook URL**: Must point to `${APP_URL}/api/github/webhook` (where `APP_URL` is the configured base URL env var, fallback to `NEXTAUTH_URL` if needed).
    - **Permissions**: Do not hardcode. Retrieve the desired permission set (e.g., 'minimal' vs 'robust') from the integration configuration or input arguments.
3.  **Code Exchange**: Create an `exchangeCode` procedure that accepts the `code` from GitHub's redirect. It must call `POST https://api.github.com/app-manifests-conversions/{code}` to retrieve the App ID, Client ID, Client Secret, Webhook Secret, and Private Key (PEM).
4.  **Credential Storage**: Store the credentials in the `Integration` table for the GitHub provider. Use `encryptConfig` (from `packages/integrations`) to secure sensitive fields like `clientSecret`, `webhookSecret`, and `privateKey`.
    - **TTL**: Include `tokenTTL` in the stored configuration.
5.  **Wiring**: Ensure the `github` router is merged into the main `appRouter` in `apps/web/server/routers/_app.ts`.

**Test Strategy:**

Unit test the tRPC procedures using mocked inputs. Mock the `fetch` call to GitHub's conversion endpoint to return sample credentials. Verify that `exchangeCode` calls `encryptConfig` and persists the encrypted data correctly to the database mock. Verify the generated manifest contains the correct webhook URL (`/api/github/webhook`) derived from the base URL environment variable.

## Subtasks

### 106.1. Create GitHub tRPC Router Scaffold

**Status:** done  
**Dependencies:** None  

Initialize `apps/web/server/routers/github.ts` and register it in `_app.ts`. Ensure basic connectivity.

**Details:**

Create the file, define a basic router using `router({})`, and import/mount it in `apps/web/server/routers/_app.ts` under the `github` namespace.

### 106.2. Implement getManifest Procedure

**Status:** done  
**Dependencies:** 106.1  

Create the procedure to return the GitHub App Manifest JSON configuration with dynamic permission presets.

**Details:**

The `getManifest` query should return an object matching the GitHub App Manifest spec.
- **Url**: Use env var for base URL + `/api/github/webhook`.
- **Permissions**: logic to select between 'minimal' (metadata read) or 'robust' (contents/pull_requests/issues write) based on input or stored config.

### 106.3. Implement exchangeCode Procedure

**Status:** done  
**Dependencies:** 106.1, 106.2  

Create the mutation to exchange the code for credentials and store them.

**Details:**

Implement `exchangeCode` taking a `code` string. Perform the HTTP POST to GitHub. On success, take the response body, run sensitive fields through `encryptConfig`, and update the GitHub integration record. Include `tokenTTL` in the stored settings.
