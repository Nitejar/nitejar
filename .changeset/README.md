# Changesets In Nitejar

Use changesets to record version bumps and changelog entries for publishable packages.

## Packages covered

- `@nitejar/cli`
- `@nitejar/plugin-sdk`
- `create-nitejar-plugin`

## Add a changeset

```bash
pnpm changeset
```

Choose package(s), bump type, and a concise release note.

## Local release prep

```bash
pnpm changeset:status
pnpm changeset:version
```

`changeset:version` updates package versions and `CHANGELOG.md` entries from pending changesets.

## CI behavior

The `.github/workflows/changesets.yml` workflow runs on `main` and opens/updates a
`chore: version packages` PR whenever unreleased changesets exist.
