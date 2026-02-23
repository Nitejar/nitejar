# Nitejar Installer/Runtime Pre-Release Runbook

## Scope
This runbook validates the public installer/runtime flow before first public rollout and for subsequent release candidates.

## Preconditions
- A release manifest and platform runtime bundles exist for:
  - `darwin-arm64`
  - `darwin-x64`
  - `linux-x64`
  - `linux-arm64`
- `@nitejar/cli` candidate version is published to npm (or available via local pack for dry-runs).
- npm Trusted Publishing is configured for `@nitejar/cli` with repository `nitejar/nitejar` and workflow `.github/workflows/release.yml`.

## 1) Clean-machine install
1. Run `npx @nitejar/cli up`.
2. Verify service health at `http://localhost:3000/`.
3. Verify runtime/data layout:
   - `~/.nitejar/data/nitejar.db`
   - `~/.nitejar/config/env`
   - `~/.nitejar/runtime/current`
   - `~/.nitejar/receipts/migrations/*.json`
4. Run `npx @nitejar/cli status --json` and confirm `running=true`.
5. Run `npx @nitejar/cli down` and confirm process exits.

## 2) Upgrade scenario
1. Start an older runtime (`npx @nitejar/cli up --version <old>`).
2. Upgrade (`npx @nitejar/cli up --version <new>`).
3. Confirm daemon restarts on the new version (`status --json`).
4. Confirm new migration receipt exists and reports success.

## 3) Failure injection checks
1. Checksum mismatch:
   - Tamper manifest checksum for selected artifact.
   - Confirm `up` hard-fails before extraction.
2. Migration lock contention:
   - Hold `~/.nitejar/run/migrate.lock`.
   - Confirm `migrate`/`up` returns actionable lock error.
3. Health failure:
   - Force runtime to fail health check.
   - Confirm startup fails with explicit log path.

## 4) Log and receipt verification
1. Run `npx @nitejar/cli logs --lines 200`.
2. Run `npx @nitejar/cli logs --follow` and verify live output.
3. Open latest migration receipt and confirm fields:
   - `migrationStatus`
   - `cutoverStatus`
   - `startedAt` / `finishedAt`

## 5) Sign-off
Release is approved only when:
1. Automated CI and release smoke checks are green.
2. This runbook has been executed successfully for the candidate.
3. Any failures are captured with logs and receipts in the release notes.
