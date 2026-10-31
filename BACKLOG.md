# Backlog

## Verify a real OpenAI–Azure comparison

**Problem:** `test/streaming.test.js` covers mocked providers, so real account access, Azure API-version compatibility, and provider usage events remain unverified.

**Goal:** Run one cross-provider comparison and a cancellation check against provisioned models without changing the public API.

**Acceptance:** Both panels stream real text independently, report provider usage and duration, and finish successfully. Clearing a second comparison cancels both upstream requests. Record the tested model IDs, Azure API version, and results in the completing commit or issue; never record keys or sensitive prompts.

**Blocker:** Valid OpenAI credentials with model access, an Azure deployment and credentials, and authorization for the paid test requests.
