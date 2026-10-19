# Staging Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `estori-staging` on `staging.estori.app`, private and with its own data, deployed automatically from `main`.

**Architecture:**
- **New config:** a Wrangler config that mirrors production's.
- **Two small Worker changes:** a key gate, and an email recipient allowlist. Both do nothing unless their variable is set.
- **Workflows:** a reusable deploy workflow shared by production and staging.
- **Cloudflare resources:** created with the deploy token.

**Tech Stack:** Cloudflare Workers, D1, KV, R2, Wrangler 4, GitHub Actions, vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-18-staging-environment-design.md`

## Global Constraints

- No `any`, and no emojis.
- Commit subjects are lowercase after the type.
- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `.dev.vars`, `bun.lockb`, `.superpowers/`, `.playwright-mcp/`, the LandingPage tone change, the `wrangler.jsonc` local overrides, or the untracked shopper order access spec.
- Never print secret values.
- Production behavior must not change: the gate and the guard do nothing when their variables are unset.
- Don't merge the PR; the owner merges.

## Review Focus

- **A locked staging still receives Stripe webhooks:** the webhook path is exempt, and its signature check still applies.
- **Previews load inside the app's iframe:** the preview host is exempt, since a cookie on `staging.estori.app` isn't sent there.
- **The unlock cookie can't be forged from the key's digest alone:** it's `HttpOnly` and compared in constant time.
- **A blocked email in the outbox is `suppressed`, not retried forever.**
- **The production deploy workflow behaves exactly as before after the refactor:** the same gate, environment, secrets and smoke checks.

---

### Task 1: Email recipient allowlist
**Files:**
- Create `worker/services/email/recipient-allowlist.ts` and its test.
- Modify `worker/services/email/sender.ts` (wrap when `EMAIL_RECIPIENT_ALLOWLIST` is set) and `worker/services/email/send-errors.ts` (`E_STAGING_BLOCKED` maps to `suppressed`), with tests.
- Modify `worker/types/env.d.ts`.

**Steps:**
- [ ] Write failing tests:
  - addresses and `@domain` entries, case-insensitive;
  - unset allows everyone;
  - a blocked send throws `E_STAGING_BLOCKED` and never calls the binding;
  - the classifier maps the code to `suppressed`.
- [ ] Implement, run the tests, and commit.

### Task 2: Staging key gate
**Files:**
- Create `worker/services/staging-gate.ts` and its test.
- Modify `worker/index.ts` so the gate runs first in `fetch`.
- Modify `worker/types/env.d.ts`.

**Steps:**
- [ ] Write failing tests:
  - unset passes everything;
  - set locks pages (HTML) and APIs (401 JSON);
  - the right header passes;
  - the cookie set by `POST /__staging` passes, and a wrong key gets 401;
  - the webhook and the preview host pass;
  - gated responses carry `X-Robots-Tag`.
- [ ] Implement, run the tests, and commit.

### Task 3: Staging config and smoke checks
**Files:**
- Create `wrangler.estori-staging.jsonc`.
- Modify `scripts/estori-smoke.ts` (`ESTORI_WORKER_NAME` and `ESTORI_STAGING_GATE_KEY`) and its test.

**Steps:**
- [ ] Write the failing smoke test for the gate header.
- [ ] Implement the smoke change and the config, run the tests, and commit.

### Task 4: Deploy workflows
**Files:**
- Create `.github/workflows/deploy-estori-reusable.yml` and `.github/workflows/deploy-estori-staging.yml`.
- Modify `.github/workflows/deploy-estori.yml` to call the reusable workflow.

**Steps:**
- [ ] Check the YAML parses, and diff the production job against the old one for the same steps, environment, secrets and smoke checks.
- [ ] Commit.

### Task 5: Resources, secrets and first deploy
- [ ] Create the D1 database `estori-db-staging`, the KV namespace and the R2 bucket `estori-assets-staging`, and put their IDs in the config. Commit.
- [ ] Set the Worker's secrets and variables from `.dev.vars`, with a new `JWT_SECRET` and `STAGING_GATE_KEY` saved only in `.dev.vars`.
- [ ] Deploy from this branch with `WRANGLER_CONFIG_PATH=wrangler.estori-staging.jsonc bun scripts/deploy.ts`.
- [ ] Create the two Stripe test-mode webhook endpoints, set their secrets, and redeploy the secrets.
- [ ] Create the `staging` GitHub environment, with its secrets and variables.
- [ ] Run the smoke checks, and check the locked page, the unlocked app, a webhook delivery and the email guard.

### Task 6: CI steps, review and PR
- [ ] Run eslint, typecheck, build, bundle check and the sharded suite.
- [ ] Run a fresh review of the branch and fix its findings.
- [ ] Open the PR into `main`, and don't merge it.
