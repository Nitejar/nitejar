# Deployment Guide

Nitejar can be deployed anywhere Docker runs. This guide covers deployment options from simple single-server setups to production-ready configurations.

## Quick Start (Docker)

```bash
# Build the image
docker build -t nitejar .

# Run with SQLite (data persisted in volume)
docker run -d \
  --name nitejar \
  -p 3000:3000 \
  -v nitejar-data:/app/data \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  nitejar
```

## Environment Variables

### Required

| Variable         | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY` | 64-character hex key for encrypting secrets. Generate with: `openssl rand -hex 32` |

### Database

| Variable       | Description                | Default                         |
| -------------- | -------------------------- | ------------------------------- |
| `DATABASE_URL` | Database connection string | `/app/data/nitejar.db` (SQLite) |

For Postgres:

```
DATABASE_URL=postgres://user:password@host:5432/database
```

### Sprites (Agent Execution)

Configure the Sprites API key in **Settings > Capabilities > Tool Execution** after first boot.

### Integrations

#### Telegram

Configure via the admin UI. Required config:

- `botToken`: Get from @BotFather

#### GitHub

Configure via the admin UI. Required config:

- For GitHub App: `appId`, `privateKey`
- Optional: `webhookSecret` for signature verification

## Database Options

### SQLite (Simple)

Best for: Single-server deployments, getting started quickly

```bash
# SQLite is the default - just mount a volume for persistence
docker run -v nitejar-data:/app/data nitejar
```

### Postgres (Production)

Best for: High availability, multiple instances, larger scale

```bash
docker run \
  -e DATABASE_URL="postgres://user:pass@host:5432/nitejar" \
  nitejar
```

## Deployment Platforms

### Fly.io

See [fly.md](./fly.md) for Fly.io-specific instructions.

### Docker Compose

See [docker-compose.md](./docker-compose.md) for a complete example.

### Kubernetes

See [kubernetes.md](./kubernetes.md) for Kubernetes manifests.

## Post-Deployment Setup

1. **Access the admin UI**: Navigate to `https://your-domain/admin`

2. **Create a plugin instance**:
   - Go to Plugins
   - Install/enable the plugin in the catalog
   - Configure credentials on the connected plugin instance

3. **Create an agent**:
   - Go to Agents → Create Agent
   - Give it a name
   - The sprite will be provisioned automatically on first job

4. **Set up webhooks**:
   - Telegram: Use BotFather to set webhook URL to `https://your-domain/api/webhooks/plugins/telegram/{plugin-instance-id}`
   - GitHub: Configure webhook in repo/org settings to `https://your-domain/api/webhooks/plugins/github/{plugin-instance-id}`

## Security Checklist

- [ ] Set `ENCRYPTION_KEY` (required for secret storage)
- [ ] Use HTTPS in production
- [ ] Configure webhook secrets for GitHub/Telegram
- [ ] Restrict admin UI access (consider adding auth)
- [ ] Use Postgres for production deployments
- [ ] Back up the database regularly
