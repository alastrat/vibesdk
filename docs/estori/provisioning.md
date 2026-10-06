# Provision Estori production resources

Run once, logged in to the Estori account (`wrangler whoami` lists Estori).

## Create resources
```bash
./node_modules/.bin/wrangler d1 create estori-db
./node_modules/.bin/wrangler kv namespace create estori-store
./node_modules/.bin/wrangler r2 bucket create estori-assets
```
R2 must be enabled for the account first (R2 → Overview → Purchase/enable, free tier).

Artifacts needs no command: the `estori-production` namespace is created automatically with the first repository. The AI Gateway `estori-gateway` already exists.

Users pick the build model (Gemini 3.6 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5 or Claude Opus 5.5). When its provider fails, the chat offers switching to the other provider's model, with the credits per step (`ENABLE_THINK_MODEL_FALLBACK` in `wrangler.estori.jsonc`). Both provider keys live only in the gateway: AI Gateway → `estori-gateway` → Provider Keys. If either stored key is removed, set `ENABLE_THINK_MODEL_FALLBACK` to `"false"` so the chat stops offering a model that would fail with 401.

The D1 and KV IDs go into `wrangler.estori.jsonc` (see the implementation plan, Task 7).

## Worker secrets set once (after the first deploy)
```bash
./node_modules/.bin/wrangler secret put JWT_SECRET --config wrangler.estori.jsonc
./node_modules/.bin/wrangler secret put ARTIFACTS_API_TOKEN --config wrangler.estori.jsonc
```
Use the same `JWT_SECRET` value stored in the GitHub `production` environment. Never regenerate it: a new value signs everyone out.

All other runtime values reach the Worker through the deploy (`scripts/deploy.ts` uploads them from CI env): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `CLOUDFLARE_AI_GATEWAY_URL`, `GOOGLE_AI_STUDIO_API_KEY`, `ENABLE_ARTIFACTS`. Do not add dashboard variables with these names; they collide with the uploaded secrets.

## Releasing
```bash
git push origin <commit>:refs/heads/estori-live
```
Then approve the `production` environment in the GitHub Actions run.

## Rollback
```bash
./node_modules/.bin/wrangler rollback --name estori-production
```
D1 migrations are forward-only. Every migration must work with the previous Worker version.
