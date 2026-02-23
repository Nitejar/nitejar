# M6 — SaaS (Closed Source)

**Goal:** Multi-tenant hosted version for paying customers.

**Dependencies:** M5 complete (core platform fully featured)

**Note:** This milestone is closed source. The features here are for the hosted SaaS version only.

## Open-Core Boundary

### Stays Open Source

- Single-tenant self-host deploy
- Core APIs and schemas
- Runner interfaces (Sprite protocol)
- Skill framework
- All M1-M5 features

### SaaS Only (Closed Source)

- Multi-tenant architecture
- Billing and quotas
- Managed Sprite infrastructure
- Enterprise features (SSO, audit, etc.)

## Features

### 1. Multi-Tenant Architecture

**What it does:** Isolate tenants (organizations) completely.

**Tenant isolation:**

- Separate database schemas or row-level security
- Separate Sprite pools
- Separate API keys and secrets
- No data leakage between tenants

**Organization management:**

- Create/delete organizations
- Organization settings
- Member management (invite, remove, roles)

**RBAC (Role-Based Access Control):**

- **Owner:** Full control, billing
- **Admin:** Manage members, integrations, agents
- **Member:** Use agents, view work items
- **Viewer:** Read-only access

**Implementation:**

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tenant_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  role TEXT NOT NULL, -- owner, admin, member, viewer
  invited_at TIMESTAMP DEFAULT NOW(),
  joined_at TIMESTAMP
);

-- Add tenant_id to all existing tables
ALTER TABLE agents ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE integrations ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
-- etc.
```

### 2. Billing and Quotas

**What it does:** Usage-based billing with plan tiers.

**Plan tiers:**

1. **Free:**
   - 1 agent
   - 100 jobs/month
   - Community support
   - Nitejar branding

2. **Pro ($X/month):**
   - 5 agents
   - 1,000 jobs/month
   - Email support
   - Custom agent names

3. **Team ($X/month):**
   - 20 agents
   - 10,000 jobs/month
   - Priority support
   - Team features
   - SSO

4. **Enterprise (custom):**
   - Unlimited agents
   - Unlimited jobs
   - Dedicated support
   - SLA
   - Custom deployment options

**Usage tracking:**

- Jobs executed
- Sprite compute hours
- API calls
- Storage used

**Quota enforcement:**

- Soft limit: Warning at 80%
- Hard limit: Block at 100%
- Overage options: Auto-upgrade or block

**Billing integration:**

- Stripe for payments
- Usage-based billing
- Invoicing
- Payment methods management

**Implementation:**

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  plan TEXT NOT NULL,
  status TEXT NOT NULL, -- active, canceled, past_due
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP
);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  metric TEXT NOT NULL, -- jobs, compute_hours, api_calls
  value INTEGER NOT NULL,
  recorded_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Managed Sprites

**What it does:** Provision and manage Sprites for SaaS customers.

**Sprite management:**

- Auto-provision Sprite when agent created
- Scale Sprites based on demand
- Cleanup idle Sprites after timeout
- Per-tenant resource limits

**Infrastructure:**

- Fly.io Machines for Sprites
- Auto-scaling based on queue depth
- Geographic distribution (optional)
- Dedicated vs shared Sprite pools

**Monitoring:**

- Sprite health checks
- Resource usage tracking
- Performance metrics
- Alerting on issues

**Cost optimization:**

- Idle timeout (stop after X minutes)
- Wake-on-demand
- Right-sizing based on usage patterns

### 4. Enterprise Features

**What it does:** Features for large organizations.

**SSO/SAML:**

- SAML 2.0 integration
- Okta, Azure AD, OneLogin support
- JIT provisioning
- Role mapping from IdP

**Advanced Audit:**

- Detailed audit log of all actions
- Log retention (configurable: 90 days, 1 year, etc.)
- Export to SIEM
- Compliance reports

**Data Retention:**

- Configurable retention policies
- Auto-delete old data
- Export before deletion
- Compliance (GDPR, SOC2)

**Additional:**

- Dedicated support channel
- Custom SLA
- On-call support
- Deployment options (dedicated, VPC)

## Admin Dashboard (SaaS)

### Tenant Management

- List all tenants
- View tenant details
- Manage plans
- Usage analytics

### Billing Dashboard

- Revenue metrics
- Subscription analytics
- Failed payments
- Churn tracking

### Infrastructure

- Sprite pool status
- Resource utilization
- Cost breakdown
- Scaling controls

### Support

- Ticket management
- Customer health scores
- Usage alerts

## Exit Criteria

- [ ] Multi-tenant architecture implemented
- [ ] Tenant isolation verified (security audit)
- [ ] RBAC working (owner, admin, member, viewer)
- [ ] Organization management (create, invite, roles)
- [ ] Plan tiers defined and implemented
- [ ] Stripe billing integration working
- [ ] Usage tracking accurate
- [ ] Quota enforcement working
- [ ] Managed Sprite provisioning working
- [ ] Sprite auto-scaling working
- [ ] Idle Sprite cleanup working
- [ ] SSO/SAML integration working
- [ ] Audit logging implemented
- [ ] Data retention policies working
- [ ] Hosted tenant can connect GitHub org and run agents
- [ ] Billing works correctly (subscriptions, invoices)
- [ ] Tenant isolation verified (no cross-tenant data access)
