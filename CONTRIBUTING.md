# Contributing to Nitejar

Thank you for your interest in contributing to Nitejar!

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/nitejar.git
   cd nitejar
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running the Development Server

```bash
pnpm dev
```

### Running Tests

```bash
pnpm test
```

### Linting and Type Checking

```bash
pnpm lint
pnpm typecheck
```

Linting is type-aware and includes `__tests__` across packages. If you add tests in a package, ensure it has a `tsconfig.eslint.json` that includes `__tests__` (and the package extends `@nitejar/eslint-config/library-with-tests`).

### Formatting Code

```bash
pnpm format
```

## Release Notes and Changelogs (Changesets)

We use [Changesets](https://github.com/changesets/changesets) to generate consistent package changelogs and version bumps.

### When to add a changeset

Add a changeset for any user-facing change in a publishable package:

- `@nitejar/cli`
- `@nitejar/plugin-sdk`
- `create-nitejar-plugin`

Typical examples: behavior changes, CLI flags, bug fixes, public API updates, scaffold output changes.

### Create a changeset

```bash
pnpm changeset
```

Choose impacted package(s), select bump type (`patch`, `minor`, `major`), and write a short summary.

### Useful commands

```bash
pnpm changeset:status
pnpm changeset:version
```

`changeset:version` updates package versions and writes `CHANGELOG.md` entries from pending `.changeset/*.md` files.

### CI release flow

- On `main`, the `Changesets` workflow opens/updates a `chore: version packages` PR when pending changesets exist.
- Merging that PR applies version bumps + changelog updates.
- Runtime bundle release + npm publish still run through the release workflow (`.github/workflows/release.yml`).

### Maintainer setup for npm publish (OIDC)

`@nitejar/cli` publish uses npm Trusted Publishing (OIDC), not an `NPM_TOKEN` secret.

One-time setup in npm for the package:

1. Open package settings for `@nitejar/cli`.
2. Enable Trusted Publishing for GitHub Actions.
3. Allow repository `nitejar/nitejar`.
4. Allow workflow `.github/workflows/release.yml`.

After that, `npm publish --provenance` in GitHub Actions works using the workflow identity.

## Project Structure

- `apps/` - Application packages
  - `web/` - Next.js web application
- `packages/` - Shared packages
  - `core/` - Core types and interfaces
  - `config/` - Configuration utilities
  - `connectors-github/` - GitHub integration
  - `runner-sandbox/` - Runner implementation
  - `typescript-config/` - Shared TypeScript configurations
  - `eslint-config/` - Shared ESLint configurations

## Submitting Changes

1. Ensure all tests pass: `pnpm test`
2. Ensure linting passes: `pnpm lint`
3. Ensure type checking passes: `pnpm typecheck`
4. Commit using Conventional Commits with required scope: `<type>(<scope>): <summary>`
   - Example: `feat(marketing): add shared OG endpoint`
   - Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `revert`
5. Push to your fork
6. Open a Pull Request

## Code Style

- We use Prettier for code formatting
- We use ESLint for linting
- TypeScript strict mode is enabled
- Follow existing patterns in the codebase

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
