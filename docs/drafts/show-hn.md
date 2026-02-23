# Show HN: Nitejar – Self-hosted agent fleet manager (Apache-2.0)

I've been building Nitejar, a self-hosted platform for running a fleet of AI agents that plug into Telegram, GitHub, webhooks, and other channels.

The thesis: most people are using AI agents in real-time (pair programming, chat). The next step is agents that operate autonomously on events. A PR opened, a message received, a ticket created. LLMs are genuinely good at the everyday calls: triaging a bug report, summarizing a product request channel, routing a support ticket, drafting a changelog from merged PRs. LLMs can handle the decisions. The part that's actually hard is everything around it: how do you give an agent the right context, connect it to the right channels, set boundaries on what it can do, and see what it's doing?

That's what Nitejar is. You create agents, give them identities and skills, plug them into channels, set budgets, and let them work. Multiple agents can share a channel. Each one triages independently, responds when relevant, stays silent when not. Every decision shows up in an activity timeline.

What's in the box:
- Agent builder (identity, personality, model, skills, plugins, budget limits)
- Plugin system (GitHub, Telegram, webhooks, custom)
- Skill packs (reusable knowledge/workflow bundles)
- Cost tracking with per-agent breakdowns and budget controls
- Eval pipelines for measuring agent quality
- Multi-agent collaboration (agents in the same channel self-coordinate)
- Sandbox code execution (agents get their own dev environments when granted permission)
- Full activity timeline with per-run, per-step, per-cost detail

Stack: Next.js, SQLite, Sprites for sandboxes. Self-hosted, Apache-2.0. You need an OpenRouter API key for model access. Local model support isn't there yet but it's on the roadmap.

https://github.com/nitejar/nitejar

I'm a solo builder on this. Happy to answer questions about the architecture, the multi-agent coordination model, or the general thesis that agent building needs to escape the IDE.
