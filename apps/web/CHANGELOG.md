# @nitejar/web

## 0.0.1

### Patch Changes

- [#15](https://github.com/Nitejar/nitejar/pull/15) [`0cf1409`](https://github.com/Nitejar/nitejar/commit/0cf14097836c5edbee021b656518db9c59e225e2) Thanks [@joshmatz](https://github.com/joshmatz)! - Improve auth and post-login UX reliability, and make passive-memory costs auditable in traces.
  - Detect stale auth cookies in app layout, force sign-out, and redirect to login with a clear invalid-session error.
  - Pass server session user info into the sidebar and reduce post-login "Account" flashes by retrying session hydration once before fallback.
  - Replace the sidebar placeholder glyph with the Nitejar icon in desktop and mobile headers.
  - Default passive-memory extract/refine calls to the free model (`arcee-ai/trinity-large-preview:free`) unless overridden by env.
  - Record passive-memory inference metadata (`attempt_kind`, `attempt_index`, `model_span_id`) and expose passive-memory call receipts in TraceView, including token/cost details.
