---
'@nitejar/cli': patch
---

Improve `nitejar up` startup output to always print the actual local URL and show configured `APP_BASE_URL` separately when it differs. Also harden `--port auto` startup retries to move to the next port after an in-use collision.
