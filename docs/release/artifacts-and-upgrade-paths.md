# Release Artifacts And Upgrade Paths

Nitejar publishes three different public release artifacts. They belong to the same release, but they are not the same thing and they are not consumed the same way.

## 1. Runtime bundles + manifest

These are the platform tarballs plus `manifest.json` attached to the GitHub Release.

They are used by:

- `npx @nitejar/cli up`
- `npx @nitejar/cli up --version <version>`

The CLI reads `manifest.json`, picks the matching platform artifact, verifies the checksum, extracts the runtime, runs migrations, and starts the app.

Where to verify:

- GitHub Release assets include:
  - `nitejar-runtime-darwin-arm64.tar.gz`
  - `nitejar-runtime-darwin-x64.tar.gz`
  - `nitejar-runtime-linux-arm64.tar.gz`
  - `nitejar-runtime-linux-x64.tar.gz`
  - `manifest.json`

## 2. npm CLI package

This is `@nitejar/cli` on npm.

It is the installer and updater wrapper. It is not the full runtime payload by itself. Users can invoke it with `npx`, or install it globally and then run `nitejar up`.

Where to verify:

- npm shows the published `@nitejar/cli` version matching the release candidate

## 3. GHCR Docker image

This is the container image at `ghcr.io/nitejar/nitejar`.

It is used by Docker deployments, for example:

```bash
docker run -d \
  --name nitejar \
  -p 3000:3000 \
  -v nitejar-data:/app/data \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/nitejar/nitejar:latest
```

Docker users do not use the CLI runtime tarballs. They pull the image directly from GHCR.

Where to verify:

- GHCR tags include:
  - `latest`
  - the release version tag, for example `v0.3.1`
  - the normalized semver tag, for example `0.3.1`
  - the `major.minor` alias, for example `0.3`

## Canonical mental model

- CLI path: `npx @nitejar/cli up` -> `manifest.json` -> runtime tarball
- Docker path: `docker pull ghcr.io/nitejar/nitejar:<tag>` -> container image
- npm path: `@nitejar/cli` publishes the updater command itself

If a release is healthy, all three receipts exist.
