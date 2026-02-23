# GitHub Integration Setup

This guide covers the recommended manifest-first setup for GitHub in Nitejar.

## Important Concept

GitHub App access has two independent dimensions:

1. **Repository selection**: which repos the app can see.
2. **Permissions/events**: what the app can do in those repos.

Selecting `nitejar/nitejar` during installation is not enough by itself.  
If permissions are metadata-only, token minting for repo contents/PR actions will fail.

GitHub has two different screens that are often confused:

1. **Owner registration screen (editable permissions/events)**  
   `Settings (or Org Settings) -> Developer settings -> GitHub Apps -> <app> -> Permissions & events`
2. **Installed app screen (read-only permissions, repo selection, approval)**  
   `Installed GitHub Apps -> Configure`

If you only see the installed app screen, you can approve/update installation permissions and repo access, but you cannot change the app's requested permissions/events there.

## Recommended Flow (Manifest)

### Step 1: Create the GitHub Plugin Instance in Nitejar

1. Open `Admin -> Plugins`.
2. Choose `GitHub`.
3. Keep auth method as `Manifest (Recommended)`.
4. Create/open the GitHub plugin instance and open its detail page.

### Step 2: Choose Manifest Scope Before Registration

In the **App Registration** card:

1. Select a **Manifest Permission Preset**.
   - `Robust (Recommended)`: `metadata:read`, `contents:write`, `issues:write`, `pull_requests:write`, `actions:read`, `checks:read`, `workflows:write`, `discussions:write`.
   - `Minimal`: `metadata:read` only.
2. Review the requested events list shown in UI.
3. Confirm the scope acknowledgement checkbox.
4. Click **Register GitHub App**.

Nitejar persists this preset before redirecting to GitHub so registration and runtime settings stay aligned.

### Step 3: Complete GitHub Registration

GitHub receives the manifest and creates the app with the requested permissions/events.  
After callback, Nitejar validates the created app's actual permissions/events against the selected preset.

If validation fails, Nitejar will stop setup and show exactly which permissions/events are missing.

### Step 4: Install the App on Repositories

1. In GitHub App settings, install the app to your account/org.
2. Choose `All repositories` or select specific repos (for example `nitejar/nitejar`).
3. Approve requested permissions.

### Step 5: Sync Installations in Nitejar

1. Back in the Nitejar plugin instance page, click **Sync from GitHub**.
2. Confirm installation and repository rows appear under **Installations**.

### Step 6: Assign Agent Capabilities

1. Add agent/repo assignments.
2. Grant only needed capabilities (`read_repo`, `open_pr`, etc.).

Without capability grants, token minting is denied even when the app is correctly installed.

## Keeping an Existing App Up To Date

You do not need to delete/recreate a plugin instance to inspect drift.

1. Open the plugin instance's **App Registration** card.
2. Use **Refresh Status** to pull current app + installation permissions from GitHub.
3. Compare `Expected` vs `Current` scope in the UI.
4. If drift is detected, change desired preset in **Runtime Settings**.
5. Update the GitHub App in **Developer settings -> GitHub Apps -> Permissions & events**.
6. Open **Installed GitHub Apps** and approve updated permissions on installations.
7. Run **Refresh Status** again until it reports `In Sync`.

Note: GitHub does not provide a direct API to mutate existing app permissions/events.  
Nitejar can detect and compare drift, but applying permission changes is still performed in GitHub UI.

## Manual App Credentials Flow

Nitejar also supports manual GitHub App credentials setup, but the manifest flow is preferred because:

- It reduces configuration drift.
- It keeps requested scope explicit in the plugin instance UI.
- It performs validation on callback.

## Troubleshooting

### "The permissions requested are not granted"

This means the app/installation is under-scoped relative to what the agent requested.

Fix:

1. Open **Developer settings -> GitHub Apps -> <app> -> Permissions & events**.
2. Add required repository permissions (usually at least `Contents: Read` for clone).
3. Save changes.
4. Open **Installed GitHub Apps** and re-approve updated permissions.
5. Run **Sync from GitHub** in Nitejar.

### "GitHub app was created but is under-scoped for preset ..."

The manifest callback validation found missing permissions/events.

Fix:

1. Re-run registration from Nitejar with the intended preset.
2. Confirm the requested scopes/events in the registration card.
3. Complete callback again.

### "Resource not accessible by integration"

- App is not installed on the repo, or
- App lacks required scope for the operation.

Check both repository selection and permissions/events.

### Webhook verification failed

- Ensure `webhookSecret` in Nitejar matches GitHub App webhook secret.
- Ensure webhook URL is `https://<base-url>/api/webhooks/plugins/github/<plugin-instance-id>`.

## Security Notes

- GitHub private keys and webhook secrets are sensitive and should be rotated periodically.
- In production, set `ENCRYPTION_KEY` so plugin instance secrets are encrypted at rest.
