# Store Translations and Seller Task Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers turn on Spanish or Portuguese for a store. Estori translates the store's text as a queued background task charged to their AI credits, and serves shoppers the store in their language.

**Architecture:**
- **Task queue:** a generic seller task queue. Tasks live in a D1 table, a per-seller `TaskRunner` Durable Object runs them one bounded step per alarm, and a registry holds the kinds.
- **The first kind, `store.translate`:**
  - It reads a store's built deployment through a new SpaceDO RPC.
  - It extracts the text a shopper reads, using `htmlparser2` for HTML, `acorn` for JS and the store manifest.
  - It translates missing texts in batches with the cheapest Flash model, metered like the Think agent.
  - It stores the results in D1.
- **Serving:** the Worker translates store HTML with `HTMLRewriter` on the way out, injects a versioned overlay script for text added by scripts plus a language switcher, and serves Estori's own shopper pages in the shopper's language.

**Tech Stack:**
- Cloudflare Workers, D1/drizzle, Durable Objects with alarms, HTMLRewriter
- Hono controllers
- the AI SDK (`@ai-sdk/openai` through Estori's AI Gateway)
- React 19, TanStack Query, Kumo, and the app's `t()` i18n

**Spec:** `docs/superpowers/specs/2026-10-21-store-translations-design.md`

## Global Constraints

**Working setup**
- **Your worktree:** you work in your own isolated git worktree. The branch is `feat/store-translations`, stacked on `feat/i18n`.
  - **Start:** run `git reset --hard feat/store-translations`, then `bun install`.
  - **Before your final commit:** run `git rebase feat/store-translations`.
  - **Finish:** `git merge-base --is-ancestor feat/store-translations HEAD && git branch -f feat/store-translations HEAD`.
  - Never check out `feat/store-translations` itself, and never push.
- **Never commit:** `.dev.vars`, `bun.lockb`, `.superpowers/`, `.playwright-mcp/`, `src/routes/landing/LandingPage.tsx`, local `wrangler.jsonc` overrides, or `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`. Stage only the files you changed.

**Code and copy**
- No `any` and no emojis.
- Commit subjects are lowercase. The trailer is `Co-Authored-By: <your model> <noreply@anthropic.com>`.
- Seller-facing and shopper-facing copy names no AI provider and no supplier (`src/routes/copy-rules.ts`). "AI credits" is the term.
- Every new seller-app string goes through `t()`, `tn()` or `<T>` from `@/lib/i18n`, with Spanish (`es`, tú) and Brazilian Portuguese (`pt-BR`, você) entries in `shared/i18n/catalogs/*.json`. Run `bun run i18n:extract`, follow `shared/i18n/glossary.md`, and add new files to `COVERED` in `src/i18n-coverage.test.ts`.
- **Store languages** are exactly `LOCALES` from `shared/i18n/locales.ts`: `en`, `es` and `pt-BR`.

**Translation numbers** (all in `shared/types/store-translations.ts`)
- Model: `google-ai-studio/gemini-3.6-flash`, exported as `TASK_MODEL_ID`.
- Batches: `TRANSLATION_BATCH_MAX_TEXTS = 40` and `TRANSLATION_BATCH_MAX_CHARS = 12_000`.
- Texts: skip any text over `MAX_TEXT_CHARS = 5_000`, and stop at `MAX_STORE_TEXTS = 5_000` per store.

**Task queue numbers** (all in `shared/types/tasks.ts`)
- `MAX_UNFINISHED_TASKS = 50`.
- `TASK_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000]`.
- `TASK_MAX_FAILURES = 5`.
- `TASK_LEASE_MS = 120_000`.

**Credits**
- Use source `'task'`.
- The use key is `task:<taskId>:<step>:<call>`.

**Serving**
- Cookie `estori_lang`, valid one year. Query parameter `lang`.
- Per-isolate cache of `30_000` ms.
- Overlay path `/__estori/i18n.js`.
- Pause flag `store-translations-paused`.
- Seller page path `/translations`.
- The page polls every `3_000` ms while a task is queued or running.

**Patterns to follow**
- The `CatalogOrderRunner` pattern (`worker/services/catalog/CatalogOrderRunner.ts`): RPC methods only store state and arm the alarm, the work runs in `alarm()`, and the logic is a pure function tested with fakes.
- The emails page slice for a new seller page: `shared/types` → `src/api-types.ts` → `api-client` → `queryKeys.account.*` → hooks → page → `protectedPage` route → worker route, controller, service and tests.
- Don't kill processes you didn't start. Don't dispatch subagents.

## Review Focus

1. **HTML that isn't simple text**:
   - entities (`&amp;`, `&nbsp;`);
   - text split by inline tags (`Hello <b>world</b>`);
   - text split across HTMLRewriter chunks;
   - `<script>` and `<style>` contents.

   The page must render the same markup with translated text. Never broken HTML, entities shown literally, or translated code. *(Task 6: rewrite tests.)*
2. **A shopper who switches language with items in the cart, or mid-checkout.** The cart, checkout, prices and receipt keep working. Only words change, and money stays US dollars. *(Tasks 6 and 7.)*
3. **A seller who runs out of credits in the middle of a task.** The task pauses, not fails. The translations so far are kept, a done batch is never charged again, and resuming continues where it stopped. *(Tasks 1 and 2.)*
4. **Two quick clicks on Translate, or a publish while a task runs.** These create no duplicate task and no double charge. *(Tasks 1 and 8.)*
5. **A store with no translatable text, a store never deployed, or a cold SpaceDO.** There is a clear page state, a task that finishes with 0 texts, and no crash. *(Tasks 3, 5 and 8.)*

---

### Task 1: The task queue

**Files:**
- Create: `shared/types/tasks.ts`, `worker/database/services/TaskService.ts`, `worker/services/tasks/{kinds.ts,runner.ts,TaskRunner.ts,scheduler.ts,meter.ts}`
- Create tests: `worker/services/tasks/runner.test.ts`, `worker/database/services/TaskService.sql.test.ts`, `worker/services/tasks/runner-wiring.test.ts`
- Modify:
  - `worker/database/schema.ts`, plus the migration from `bun run db:generate` (next free number after the i18n branch's migrations)
  - `worker/database/index.ts`
  - `worker/index.ts`, for the export and the `scheduled` fan-out
  - `worker/types/env.d.ts`
  - `wrangler.jsonc`, `wrangler.estori.jsonc` and `wrangler.estori-staging.jsonc`: binding `TASK_RUNNER`, class `TaskRunner`, migration tag `v8`, `new_sqlite_classes`
  - `src/api-types.ts`

**Interfaces:**
- Produces, in `shared/types/tasks.ts`:
  - `TASK_STATUSES`, `TaskStatus`
  - `TASK_KINDS = ['store.translate'] as const`, `TaskKind`
  - `TaskPauseReason = 'credits' | 'daily-limit' | 'seller'`
  - `TaskProgress { done: number; total: number; skipped: number }`
  - `TaskView`, a discriminated union on `kind`. Its `'store.translate'` member has `payload: { locale: Locale }`. Common fields: `id`, `appId`, `status`, `progress`, `creditsUsed`, `pauseReason`, `lastError`, `runAt`, `createdAt`, `startedAt` and `finishedAt`, with ISO strings for dates.
  - the constants listed in Global Constraints.
- Produces, in `worker/services/tasks/kinds.ts`:
  - `ModelCall { model: string; usage: StepUsage | null }`
  - `TaskStepResult { progress: TaskProgress; finished: boolean; calls: ModelCall[] }`
  - `TaskKindHandler<P> { kind: TaskKind; parsePayload(raw: unknown): P | null; step(ctx: TaskStepContext, payload: P): Promise<TaskStepResult>; onFinished?(ctx: TaskStepContext, payload: P): Promise<void> }`
  - `TaskStepContext { env: Env; task: TaskRecord; now: number }`
  - `registerTaskKind` and `taskKind(kind)`
- Produces, in `worker/services/tasks/meter.ts`:
  - `MeterGate = { ok: true } | { ok: false; reason: 'credits' | 'daily-limit'; resumeAt: number | null }`
  - `TaskMeter { gate(userId: string): Promise<MeterGate>; charge(input: { userId: string; taskId: string; step: number; calls: ModelCall[] }): Promise<number> }`
  - `unmeteredTaskMeter`
- Produces, in `TaskService`:
  - `enqueue({ userId, appId, kind, payload, dedupeKey, runAt? }) → { task: TaskRecord; created: boolean } | { refused: 'limit' }`
  - `claimNext(userId, now, leaseMs)`, which atomically picks a due `queued` task or a `running` task with an expired lease
  - `saveStep(id, { progress, credits, steps }, now)`
  - `finish(id, now)`
  - `recordFailure(id, message, now) → 'retry' | 'failed'`
  - `pause(id, reason)`
  - `defer(id, runAt, reason)`
  - `resume(id, userId)`
  - `cancel(id, userId)`
  - `nextRunAt(userId)`
  - `listForUser(userId, { appId?, limit })`
  - `dueUserIds(now, limit)`
  - `pausedUserIds(reason)`
  - `TaskRecord` has the columns of spec section 6, plus `steps` (integer).
- Produces, in `runner.ts`: `runTaskTick(deps: { store: TaskStore; meter: TaskMeter; kinds: (kind: TaskKind) => TaskKindHandler<unknown> | null; env: Env }, userId: string, now: number): Promise<{ nextAlarmAt: number | null }>`. `TaskStore` is the subset of `TaskService` the runner uses, so a fake implements it.
- Produces, in `scheduler.ts`:
  - `wakeTaskRunner(env, userId): Promise<void>`, which never throws
  - `runTaskSchedule(cron, env)`, which runs on `*/15 * * * *` and wakes `dueUserIds`
- Produces, on `TaskRunner`: RPC `wake(userId: string)`.

- [ ] **Step 1: Write the failing runner tests.** `runner.test.ts` uses a fake store, a fake meter and a fake kind. The tests are:
  - `runs one step of the next due task and saves its progress`
  - `finishes a task whose step says finished and calls onFinished once`
  - `charges the meter with the step's calls under task:<id>:<step>`
  - `retries a throwing step with the first backoff, and fails it after 5 failures with the error kept`
  - `pauses with reason credits when the meter gate refuses without resumeAt`
  - `defers to resumeAt with reason daily-limit when the gate refuses with resumeAt`
  - `skips canceled tasks and arms the next alarm at the earliest run_at`
  - `returns nextAlarmAt null when nothing is queued`
  - `an unknown kind or unparsable payload fails the task without retrying`
- [ ] **Step 2: Write the failing real-D1 tests** in `TaskService.sql.test.ts`, using `migratedD1` and `envWith` from `worker/database/test-support/real-d1.ts`. The tests are:
  - `enqueue with the same dedupeKey while unfinished returns created false`
  - `refuses past MAX_UNFINISHED_TASKS`
  - `claimNext takes the earliest due task, honours the lease, and reclaims an expired lease`
  - `cancel and resume only touch the caller's own tasks`
  - `dueUserIds lists sellers with due work and no live lease`
- [ ] **Step 3: Run both tests.** Expected: FAIL, because the modules are not defined.
- [ ] **Step 4: Implement** the schema, migration, service, kinds, meter, runner, the `TaskRunner` DO and the scheduler. The DO stores `userId` under `'userId'`. Its `alarm()` calls `runTaskTick` with `taskMeterFromEnv(env)` once Task 2 provides it (`unmeteredTaskMeter` until then), and arms `nextAlarmAt`. On a throw it logs and re-arms after 60 s.
- [ ] **Step 5: Wiring test.** `runner-wiring.test.ts` reads sources as raw text, like `worker/services/catalog/runner-wiring.test.ts`. It checks:
  - the export is in `worker/index.ts`;
  - the binding and `v8` are in all three wrangler files;
  - the `scheduled` handler calls `runTaskSchedule(controller.cron, env)`.

  Update `worker/services/posthog/entry-wiring.test.ts` and `scripts/estori-config.test.ts` only where they pin the lists you extended.
- [ ] **Step 6: Run** the three test files, `bun run typecheck` and `npx eslint` on the changed files. Expected: PASS.
- [ ] **Step 7: Commit** `feat(tasks): a seller task queue with one runner per seller`.

### Task 2: Metering and the task model

**Files:**
- Create: `worker/services/tasks/task-meter.ts`, `worker/services/tasks/task-model.ts`, `worker/services/store-translations/estimate.ts`, with tests beside each.
- Modify:
  - `shared/types/billing.ts`, adding `'task'` to `CREDIT_USE_SOURCES`
  - `worker/services/billing/jobs.ts`, so the daily job resumes credit-paused tasks
  - `worker/services/tasks/TaskRunner.ts`, to use the real meter

**Interfaces:**
- Consumes `TaskMeter`, `ModelCall` and `TaskService.pausedUserIds`/`resume` from Task 1. It also consumes, from `worker/services/billing`:
  - `checkCreditsBeforeTurn`
  - `chargeStep`
  - `loadTurnAccount`
  - `meteringDepsFromEnv`
  - `stepCredits`
  - `stepUsageFrom`
- Consumes `THINK_MODELS` and `resolveThinkModel` from `worker/agents/think/model-config.ts`.
- Produces:
  - `taskMeterFromEnv(env: Env): TaskMeter`
  - `createTaskModel(env: Env): TaskModel`, where `TaskModel { generate<T>(input: { system: string; prompt: string; schema: ZodType<T>; maxOutputTokens: number }): Promise<{ object: T; call: ModelCall }> }`
  - `estimateTranslationCredits(chars: number, texts: number): number`
  - `resumeCreditPausedTasks(env: Env): Promise<number>`
  - `TASK_MODEL_ID` in `shared/types/store-translations.ts`

- [ ] **Step 1: Write the failing tests.** `task-meter.test.ts` uses fake billing deps and covers:
  - **billing on:**
    - `gate refuses with credits when checkCreditsBeforeTurn refuses`
    - `charge records one use per call with key task:<id>:<step>:<n> and source task`
    - `charge sums stepCredits for the model prices`
  - **billing off:**
    - `gate refuses with daily-limit and resumeAt at the next UTC midnight when the daily allowance is spent`
    - `charge counts calls against the daily allowance the way the Think agent's daily mode does`

  `estimate.test.ts` covers:
  - `estimates zero for zero characters`
  - `grows with characters and batches`
  - `matches stepCredits for a single batch of known size`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Billing off** mirrors `ThinkAgent.beforeTurn`'s `'daily'` mode (`worker/agents/think/ThinkAgent.ts:302-330`, and its step recording near :399-409). Extract a shared helper instead of copying, if the code allows.
  - **`createTaskModel`** builds the provider the way `ThinkAgent.getModel` does: `createOpenAI` with the gateway configuration from `worker/agents/think/gateway-auth.ts`, then `provider.chat(modelName)`. It uses platform keys only, never a seller's own keys, and calls the AI SDK's `generateObject`, taking `usage` through `stepUsageFrom`.
  - **The estimate** assumes 4 characters per token, plus 30% for the target language, plus a 600-token prompt per batch of `TRANSLATION_BATCH_MAX_TEXTS`.
  - **Resuming credit-paused tasks:** the daily billing job calls `resumeCreditPausedTasks`. For each seller with credit-paused tasks whose gate now passes, it resumes them and wakes the runner.
- [ ] **Step 4: Run** the tests plus the existing billing tests (`worker/services/billing`). Then run typecheck and eslint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): tasks use ai credits like the agent and pause when they run out`.

### Task 3: Reading a store's text

**Files:**
- Create: `worker/services/store-translations/extract.ts` and `extract.test.ts`, `shared/types/store-translations.ts` (the constants and `StoreTextKind`).
- Modify:
  - `space/src/space/durable-object.ts`, adding RPC `getDeploymentTexts(branch: string): Promise<DeploymentTexts | null>`
  - `space/src/index.ts`, exporting `DeploymentTexts`
  - a space test beside the deploy-engine tests

**Interfaces:**
- Produces:
  - `DeploymentTexts { branch: string; commitHash: string; files: { path: string; kind: 'html' | 'script'; text: string }[]; manifest: string | null }`
    - It is read from the stored `deployments` row: `assets` (text `.html`, `.htm`, `.js` and `.mjs` only, skipping binary) and `modules` (server JS).
    - `branch` can be `live`.
  - `normalizeText(raw: string): string`
  - `textHash(normalized: string): Promise<string>`, the SHA-256 hex
  - `extractStoreTexts(sources: DeploymentTexts[]): Promise<{ texts: ExtractedText[]; truncated: boolean }>`, where `ExtractedText { hash: string; text: string; kind: StoreTextKind }`, de-duplicated by hash in first-seen order.

- [ ] **Step 1: Write the failing extraction tests.** Each one has exact expected arrays:
  - `takes text nodes and alt/title/placeholder/aria-label/meta description and og tags from html`
  - `ignores script, style, noscript, code, pre and template contents`
  - `decodes entities and collapses whitespace`
  - `takes sentence-like string literals and template text from scripts, and html inside strings`
  - `skips urls, paths, selectors, camelCase/snake_case/kebab-case identifiers and import specifiers`
  - `takes product names, descriptions and variant names but not the brand from the manifest`
  - `skips texts over MAX_TEXT_CHARS and stops at MAX_STORE_TEXTS with truncated true`
  - `returns no texts for an empty deployment`
- [ ] **Step 2: Write the failing SpaceDO test.** `getDeploymentTexts returns html and js text for a branch and null for a branch never deployed`. Follow the existing space tests' harness, and run them from the repo root.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - **HTML:** use `htmlparser2`'s `Parser` with `decodeEntities: true`.
  - **Scripts:** use `acorn`'s tokenizer (`ecmaVersion: 'latest'`, `sourceType: 'module'`, falling back to `'script'`).
    - Take string and template tokens.
    - A string "reads as words" when it has a letter and either a space between words or starts with a capital followed by lower-case letters.
    - Skip specifiers that directly follow `import`, `from` or `require(`.
    - Run a string containing `<` through the HTML extractor.
  - **The manifest:** read it with `parseStoreManifest` from `worker/services/store-payments/manifest.ts`.
- [ ] **Step 5: Run** the tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 6: Commit** `feat(store-translations): read the text a store shows shoppers`.

### Task 4: Translation storage

**Files:**
- Create: `worker/database/services/StoreTranslationService.ts` and `StoreTranslationService.sql.test.ts`, `worker/services/store-translations/texts.ts` and `texts.test.ts`.
- Modify: `worker/database/schema.ts` plus a migration (`store_translation_settings`, `store_translations` with an extra `machine_text` column so a seller can revert, and `store_texts`), `worker/database/index.ts`, and `shared/types/store-translations.ts`.

**Interfaces:**
- Produces types in `shared/types/store-translations.ts`:
  - `StoreTranslationSettings`:
    ```ts
    {
      sourceLocale: Locale;
      targets: Partial<Record<Locale, { enabled: boolean; ready: boolean }>>;
      matchBrowser: boolean;
      showSwitcher: boolean;
      autoTranslate: boolean;
      version: number;
    }
    ```
    Defaults: `matchBrowser`, `showSwitcher` and `autoTranslate` are true. `sourceLocale` is the owner's saved app locale, or `en`.
  - `StoreTranslationRow { hash: string; source: string; text: string | null; origin: 'machine' | 'seller' | null; machineText: string | null }`
- Produces on `StoreTranslationService`:
  - `settingsOf(appId)`, which returns defaults when there is no row
  - `saveSettings(appId, patch)`, which bumps `version`
  - `replaceTexts(appId, texts, now)`
  - `missingTexts(appId, locale, limit)`
  - `counts(appId)`, giving per locale `{ total, translated, edited }`
  - `upsertMachine(appId, locale, rows)`, which never overwrites `origin='seller'` and bumps the version
  - `setSellerText(appId, locale, hash, text)`
  - `revertToMachine(appId, locale, hash)`
  - `markReady(appId, locale)`
  - `listRows(appId, locale, { query, cursor, limit })`
  - `dictionary(appId, locale): Promise<Map<string, string>>`
- Produces in `texts.ts`: `refreshStoreTexts(env, appId): Promise<{ count: number; truncated: boolean; deployed: boolean }>`. It reads the `live` deployment (when the store is live) and the active draft's branch through SpaceDO, then extracts and replaces.

- [ ] **Step 1: Write the failing real-D1 tests.**
  - `settingsOf gives defaults with the owner's locale as source`
  - `saveSettings bumps version`
  - `upsertMachine keeps a seller edit and stores machine_text`
  - `revertToMachine restores the machine text`
  - `missingTexts lists only untranslated texts for the locale, oldest first`
  - `counts per locale`
  - `listRows filters by query in source or translation`
- [ ] **Step 2: Write the failing `texts.test.ts`** with a fake SpaceDO stub:
  - `refreshStoreTexts unions live and draft texts`
  - `a store never deployed gives deployed false and no texts`
  - `a cold SpaceDO error is reported, not thrown past the caller`
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Find the active draft's branch with the same SpaceDO calls the drafts controller uses (`worker/api/controllers/drafts/controller.ts`), and type the stub structurally like the other SpaceDO stubs.
- [ ] **Step 5: Run** the tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 6: Commit** `feat(store-translations): store texts, translations and settings`.

### Task 5: The translation task

**Files:**
- Create: `worker/services/store-translations/{prompt.ts,translate-kind.ts}` with tests.
- Modify: `worker/services/tasks/kinds.ts` (register `store.translate`).

**Interfaces:**
- Consumes:
  - `TaskKindHandler`, `TaskStepContext` (Task 1)
  - `createTaskModel` (Task 2)
  - `StoreTranslationService`, `refreshStoreTexts` (Task 4)
- Produces:
  - `storeTranslateKind: TaskKindHandler<{ appId: string; locale: Locale }>`
  - `translationDedupeKey(appId, locale)`, which returns `store.translate:<appId>:<locale>`
  - `buildTranslationPrompt(source: Locale, target: Locale, items: { id: string; text: string }[]): { system: string; prompt: string }`
  - `checkTranslation(source: string, translated: string): string | null`, which returns a problem when `{placeholders}`, tags or URLs differ

- [ ] **Step 1: Write the failing tests**, with a fake `TaskModel` and a fake service:
  - `the first step refreshes texts and sets total to the missing count`
  - `each step translates one batch of at most 40 texts or 12,000 characters and saves it`
  - `a batch missing ids or breaking placeholders retries once naming the problem, then counts the rest as skipped`
  - `finishes when nothing is missing, marks the language ready and bumps the version`
  - `a store with no texts finishes at once with total 0`
  - `seller edits are never sent or overwritten`
  - `the prompt names the variety (Latin American Spanish with tú; Brazilian Portuguese with você) and keeps brand and product names, numbers, prices, urls and markup`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The schema is `z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) })`. Ids are short indexes, not hashes. `maxOutputTokens` is about twice the batch's estimated tokens.
- [ ] **Step 4: Run** the tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store-translations): translate a store's missing text in batches`.

### Task 6: Serving translated stores

**Files:**
- Create: `worker/services/store-translations/{language.ts,serve-context.ts,rewrite.ts,overlay-script.ts,switcher.ts}` with tests.
- Modify:
  - `worker/api/handlers/live-store.ts`
  - `worker/api/handlers/space-preview.ts`
  - `worker/api/handlers/store-platform.ts`, adding `GET i18n.js` and translating the `store` JSON

**Interfaces:**
- Consumes `StoreTranslationService.settingsOf` and `dictionary` (Task 4).
- Produces:
  - `resolveShopperLanguage(request: Request, ctx: StoreLanguageContext): { locale: Locale; setCookie: boolean }`. It applies the spec's order: `?lang=`, then cookie, then `Accept-Language` when `matchBrowser`, then source. Only the source or ready targets count.
  - `loadStoreLanguageContext(env, appId): Promise<StoreLanguageContext>`, where `StoreLanguageContext { appId; settings; ready: Locale[]; dictionary(locale): Promise<Map<string,string>> }`. It is cached per isolate for 30 s and keyed by version.
  - `translateStoreHtml(response: Response, input: { locale; ctx; basePath: string; pageUrl: URL }): Promise<Response>`
  - `overlayScript(locale: Locale, entries: [string, string][]): string`
  - `translateManifest(manifest, dict)`

- [ ] **Step 1: Write the failing tests.**
  - **`language.test.ts`:**
    - `lang query wins and sets the cookie`
    - `cookie next`
    - `accept-language only when matchBrowser`
    - `an unready or unknown language falls back to source`
  - **`rewrite.test.ts`** (Review Focus 1), each with exact output HTML:
    - `translates text nodes and the listed attributes and sets html lang`
    - `keeps markup around inline tags and leaves untranslated text as is`
    - `handles text split across chunks`
    - `never touches script or style contents`
    - `decoded entities match their dictionary keys and the output stays valid html`
    - `adds hreflang links, Content-Language, Vary and the switcher only when a language is ready`
    - `injects the overlay script with the base path on preview`
  - **`overlay-script.test.ts`:** run the script in a test DOM. Use the shared mounted-test helper if one exists on the branch; otherwise use `htmlparser2`-free string checks of the generated script and a tiny fake `MutationObserver`. Tests:
    - `translates text added later`
    - `leaves unknown text`
  - **`store-platform`:**
    - `store JSON returns translated product names and variant names`
    - `i18n.js is versioned and cacheable`
    - `prices are unchanged` (Review Focus 2)
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The rewriter buffers each text node until `lastInTextNode`, then normalizes and looks it up. It replaces the node while keeping the leading and trailing whitespace, and escapes the translation as HTML text.
  - The switcher is plain HTML and CSS with a `<details>` element, so it needs no script. It lists the languages by their own names (English, Español, Português) and uses links `?lang=xx`.
  - Content in the source language with a ready target still gets the hreflang links and the switcher.
- [ ] **Step 4: Run** the tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store-translations): serve stores in the shopper's language`.

### Task 7: Estori's shopper pages in the shopper's language

**Files:**
- Modify:
  - `worker/services/store-payments/pay-page.ts`
  - `worker/services/store-payments/store-script.ts`, which becomes `storeScript(locale)`
  - `worker/api/handlers/plain-page.ts`
  - `shared/types/store-payments.ts` (`STORE_CHECKOUT_MESSAGES` are translated per locale with `translate(locale, …)` from `shared/i18n/translate.ts`)
  - `worker/api/handlers/store-platform.ts` and `live-store.ts`, to pass the resolved locale
  - `shared/i18n/catalogs/*.json`
- Tests go beside each file.

**Interfaces:**
- Consumes `resolveShopperLanguage` and `loadStoreLanguageContext` (Task 6).
- Every one of these takes `locale: Locale`:
  - `payPageHtml(...)`
  - `plainPage(...)`
  - `storeScript(locale)`

- [ ] **Step 1: Write the failing tests:**
  - `pay page in es has lang es, Spanish copy, product names from the dictionary, USD prices written es-419, and Stripe locale es`
  - `pt-BR likewise`
  - `en is unchanged`
  - `store.js messages follow the locale`
  - `plain pages follow the locale`
  - `a Spanish-source store with no targets serves its checkout in Spanish`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Mark the shopper strings so the i18n extractor finds them (`msg('…')` or `translate(locale, '…')`, as the extractor supports on this branch). Add the `es` and `pt-BR` catalog entries.
- [ ] **Step 4: Run** the tests, the catalog and coverage tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store-translations): checkout and store messages in the shopper's language`.

### Task 8: The translations API, flag and publish hook

**Files:**
- Create: `worker/api/routes/translationRoutes.ts`, `worker/api/controllers/storeTranslations/{controller.ts,controller.sql.test.ts,routes-wiring.test.ts}`, `worker/api/controllers/tasks/{controller.ts,controller.sql.test.ts}`.
- Modify:
  - `worker/api/routes/index.ts`
  - `shared/types/feature-flags.ts` and its test (`store-translations-paused`, kind `pause`, `clientVisible: true`)
  - `worker/api/controllers/liveStores/controller.ts`, for the publish hook
  - `shared/types/store-translations.ts`
  - `src/api-types.ts`
  - `src/lib/api-client.ts`

**Interfaces (routes, all `AuthConfig.ownerOnly` for `:id`, or `authenticated`):**
- `GET /api/translations/stores` → `StoreTranslationStoreSummary[]`: the seller's stores deployed at least once, with `title` and per-language status.
- `GET /api/stores/:id/translations` → `StoreTranslationOverview`:
  - `settings`
  - `languages: StoreLanguageStatus[]`, each with `{ locale, enabled, ready, total, translated, edited, left, estimateCredits, task: TaskView | null }`
  - `extractedAt`, `truncated` and `deployed`
  - `creditsLeft: number | null`, which is null when billing is off
  - `previewUrl` and `liveUrl`

  It refreshes texts when `extractedAt` is older than the store's last deploy.
- `PUT /api/stores/:id/translations/settings` takes a settings patch.
- `POST /api/stores/:id/translations/:locale/run` enqueues, dedupes and wakes the runner. It returns `{ task, created }`, or 409 or 429 with a translated message.
- `GET /api/stores/:id/translations/:locale/texts?query&cursor` returns rows.
- `PUT …/texts/:hash` saves a seller edit. `DELETE …/texts/:hash` reverts it.
- `GET /api/tasks?appId=` returns `TaskView[]`.
- `POST /api/tasks/:id/cancel` and `POST /api/tasks/:id/resume`.
- Every route answers 503 when `store-translations-paused` is on.
- The publish hook: after a successful publish, when `autoTranslate` is on, it enqueues `store.translate` for each ready and enabled language and wakes the runner. It never fails the publish.

- [ ] **Step 1: Write the failing real-D1 controller tests:**
  - `overview for a never-deployed store says deployed false`
  - `run twice returns created false the second time` (Review Focus 4)
  - `another seller gets 403`
  - `paused flag answers 503`
  - `seller edit then revert`
  - `tasks list is scoped to the seller`
  - `publish enqueues for ready languages only when autoTranslate`
- [ ] **Step 2: Write the wiring test** for the routes and their registration, following `worker/api/controllers/shopperEmails/routes-wiring.test.ts`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Write the controllers and routes and the api-client methods. The controllers' seller messages use `msg()` or `translate`, as the branch supports.
- [ ] **Step 5: Run** the tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 6: Commit** `feat(store-translations): the translations api, its pause flag and translating on publish`.

### Task 9: The Translations page and sidebar item

**Files:**
- Create: `src/routes/translations/{translations.tsx,language-card.tsx,task-activity.tsx,translations-format.ts,translations-guard.test.ts}` and `src/hooks/use-store-translations.ts`.
- Modify:
  - `src/components/layout/app-sidebar.tsx`: both the collapsed and expanded items, after Emails, with `id="translations-link"`, `TranslateIcon` and `useFlag('store-translations-paused')`
  - `src/routes.tsx`: `{ path: 'translations', Component: protectedPage(TranslationsPage) }`
  - `src/lib/query-keys.ts`, under `queryKeys.account`
  - `src/i18n-coverage.test.ts`
  - the catalogs
  - the sidebar guard tests that count items

**Interfaces:** consumes the Task 8 API.

- [ ] **Step 1: Write the failing guard and format tests.**
  - The page source names no AI provider or supplier (`copy-rules`).
  - The sidebar has `translations-link` twice, after `emails-link`, and is gated by the flag.
  - `translations-format.ts` maps each status to its label and variant (Off, Not translated, Translating, Ready, Paused, Failed).
  - The estimate wording is "About {credits} credits", using `formatCredits` with the locale.
- [ ] **Step 2: Write the failing mounted test**, using the shared mounted helper and a mocked api-client:
  - `shows the store picker, the settings, one card per target language`
  - `Translate opens a confirm with the estimate and starts a task`
  - `polls while a task is running and stops when it is done`
  - `renders in Spanish under es`
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement the page.**
  - **The store picker:** a `Select`. Remember the chosen store in `localStorage`, guarded with try/catch.
  - **A settings card** with four `Switch`es and a source language `Select`.
  - **One language card per target:** its status badge, a progress meter, "{left} texts left", Translate (with a confirm dialog showing the estimate), Preview (a link opening `liveUrl` or `previewUrl` with `?lang=`), and an on/off switch.
  - **Activity:** the store's tasks with a progress bar, credits used, relative times (`dateFnsLocale`), and Cancel, Resume and Retry. It uses `refetchInterval: 3_000` while any task is queued or running.
  - **Empty states:** "Publish or preview your store first" for a store never deployed, and "No text to translate".
  - The page follows the app's existing card and layout components (see the emails page). It must fit 375 px.
- [ ] **Step 5: Run** the tests, i18n extract, the catalog and coverage tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 6: Commit** `feat(store-translations): the translations page in the sidebar`.

### Task 10: The translations editor

**Files:**
- Create: `src/routes/translations/translation-editor.tsx` and its test.
- Modify: `translations.tsx` and the catalogs.

- [ ] **Step 1: Write the failing mounted tests:**
  - `lists source and translation with search`
  - `saving an edit marks it Edited by you`
  - `revert returns the machine text`
  - `paging loads more`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Show one tab per enabled target.
  - Search is debounced.
  - Each row has the source (read-only), an auto-growing textarea, Save (on blur or with a button) and "Use the automatic translation".
  - Paging uses `useInfiniteQuery` with the cursor.
- [ ] **Step 4: Run** the tests, the catalog and coverage tests, typecheck and eslint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store-translations): sellers can review and correct translations`.

### Task 11: Live check, CI and the pull request (controller)

- [ ] **Step 1: Rebase.** Rebase `feat/store-translations` onto the current `feat/i18n` and resolve the catalogs by merging both key sets. Then run `bun run i18n:extract`.
- [ ] **Step 2: Live check on localhost** with billing on for a local test account:
  - Turn on Spanish and Portuguese for a real local store and run both tasks with real model calls.
  - Record the credits charged.
  - View the live and preview store with `?lang=es`, `?lang=pt-BR` and a Spanish `Accept-Language`, checking the switcher, the cart and checkout.
  - Edit one translation and re-run; the edit survives.
  - Check the page at 375 px and 1280 px in en, es and pt-BR.
  - Save screenshots for the report.
- [ ] **Step 3: CI steps.** Run `bun run lint`, `bun run typecheck`, `bun run test` (sharded), `bun run build` and `bun run bundle:check`.
- [ ] **Step 4: Final whole-branch review** on the most capable model, then one fix pass and a scoped re-review.
- [ ] **Step 5: Open the pull request.** Push the branch and open a PR into `feat/i18n` (stacked), not merged, listing the owner steps:
  - create the PostHog flag `store-translations-paused` at 0%;
  - production deploy runs the D1 migrations and the `v8` Durable Object migration;
  - nothing else is needed, because no new account resources are used.
