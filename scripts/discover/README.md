# Discover catalog

The curated public catalog is separate from the existing authenticated app marketplace. It contains 48 original artifacts in eight categories: three stores and three animated components per category. Source builders live in `stores/` and `components/`.

## Populate local storage

From the repository root, after local Cloudflare setup:

```sh
bun scripts/discover/seed.ts --config wrangler.jsonc --persist-to .wrangler/state
```

Use the **same Wrangler config and persistence directory as the running Vite Cloudflare plugin**. JSON and JSONC configs are supported. The config must bind `DB` and `TEMPLATES_BUCKET`; the script applies local D1 migrations, uploads/hash-verifies assets, then publishes the entries. It refuses `--remote`. No credentials or local config belong in git.

The current development preview uses:

```sh
bun scripts/discover/seed.ts --config .superpowers/wrangler.local.json --persist-to .wrangler/state
```

That local config is intentionally untracked. For another checkout, use its configured Wrangler file instead.

The seed is repeatable: stable entries are upserted and immutable content versions are reused. Each current entry has five R2 objects: cover, interactive preview, source bundle, downloadable ZIP and manifest. Changed artifacts create a new content version while preserving purchase snapshots.

## Preview and purchase behavior

Anonymous visitors can list/search/filter topics and open sandboxed previews. Full accounts can download free sources or purchase premium sources through the existing Stripe integration. Default local prices are $29 per premium store and $9 per premium component. Fulfillment verifies the paid Stripe session, purchaser, entry, amount and immutable version. Public media routes never serve private source assets.

Public previews expose the client runtime needed to render them. Entitlement protection applies to the downloadable source package, not secrecy of client-side code. Store templates include demo products, cart controls and artwork; payments and fulfillment must be connected before operating a real store. Components include dependency-free reusable modules and setup instructions.

## Verification

```sh
bunx vitest run worker/services/discover/catalog.test.ts src/routes/discover/public.test.tsx scripts/discover/components/components.test.ts
bun test scripts/discover/stores/stores.test.ts
bun run typecheck
bun run lint
bun run build
```

Production deployment and remote publication are separate release steps. The local seeder intentionally does not perform them.
