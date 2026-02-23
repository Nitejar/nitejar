---
'@nitejar/cli': patch
---

Auto-rebuild `better-sqlite3` during migration preflight when the packaged native module ABI
doesn't match the current Node runtime, preventing startup failures after runtime install/update.
