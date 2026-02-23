# Fly.io Deployment

Fly.io is the recommended deployment platform for Nitejar. It offers persistent volumes for SQLite, global edge deployment, and simple scaling.

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account (`fly auth login`)

## Quick Deploy

```bash
# Create the app
fly apps create nitejar

# Create a volume for SQLite persistence
fly volumes create nitejar_data --size 1 --region ord

# Set secrets
fly secrets set ENCRYPTION_KEY="$(openssl rand -hex 32)"
fly secrets set SPRITES_TOKEN="your-sprites-token"

# Deploy
fly deploy
```

## fly.toml

Create a `fly.toml` in the project root:

```toml
app = "nitejar"
primary_region = "ord"

[build]

[env]
  NODE_ENV = "production"
  DATABASE_URL = "/app/data/nitejar.db"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false  # Keep running for webhooks
  auto_start_machines = true
  min_machines_running = 1

[mounts]
  source = "nitejar_data"
  destination = "/app/data"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

## Scaling

### Single Instance (SQLite)

For most use cases, a single instance with SQLite is sufficient:

```bash
fly scale count 1
```

### Multiple Instances (Postgres)

For high availability, use Fly Postgres:

```bash
# Create Postgres cluster
fly postgres create --name nitejar-db

# Attach to your app
fly postgres attach nitejar-db

# Scale app to multiple instances
fly scale count 2
```

## Updating

```bash
fly deploy
```

## Monitoring

```bash
# View logs
fly logs

# SSH into the machine
fly ssh console

# Check status
fly status
```

## Troubleshooting

### Volume Issues

If the volume isn't mounting correctly:

```bash
# List volumes
fly volumes list

# Check machine status
fly machines list
```

### Database Migrations

Migrations run automatically on startup. To run manually:

```bash
fly ssh console -C "cd /app && node packages/database/src/migrate.js"
```

### Secrets

```bash
# List secrets (names only)
fly secrets list

# Update a secret
fly secrets set KEY=value

# Unset a secret
fly secrets unset KEY
```
