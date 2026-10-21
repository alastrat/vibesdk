# Hand-off: app in Spanish and Portuguese, and store translations

Date: 2026-10-21. Branch `release/i18n-store-translations` is `feat/store-translations` with `feat/i18n` merged in.

The owner deployed this branch to production as is, partly translated, because of the remaining AI budget. Production lets sellers whose browser is Spanish or Portuguese see the app partly translated. That was the owner's choice.

This document is for the next agent, for example Codex. It lists what is done, what is left, and how to verify it.

## Read first

- **Specs:**
  - `docs/superpowers/specs/2026-10-21-app-i18n-design.md`
  - `docs/superpowers/specs/2026-10-21-store-translations-design.md`

  Each has a decisions table in its last section.
- **Plans:**
  - `docs/superpowers/plans/2026-10-21-app-i18n.md`, 13 tasks.
  - `docs/superpowers/plans/2026-10-21-store-translations.md`, 11 tasks.

  Each has Global Constraints and a Review Focus.
- **Project rules:** `CLAUDE.md`. No `any`, no emojis, DRY, lowercase commit subjects.
- **Glossary:** `shared/i18n/glossary.md`. Spanish is Latin American with "tú", Mexican usage where words differ. Portuguese is Brazilian with "você". Estori, Basic, Pro and Premium stay as they are.

## How the i18n system works, briefly

- The code keeps English text wrapped in `t('…')`, `tn(one, other, count)`, `<T text="…">` or `msg('…')`, from `@/lib/i18n`. Server code uses `translate(locale, …)` or `serverT(locale)`.
- The catalogs are `shared/i18n/catalogs/{es,pt-BR}.json`, keyed by the English text.
- `bun run i18n:extract` adds new keys, and `--prune` removes unused ones. Fill in every `es` and `pt-BR` value.
- `src/i18n-coverage.test.ts` holds `COVERED`. Every file listed there must have no English outside `t()`. Add each file you translate.
- Never call `t()` at module level. Text built in `useMemo`/`memo` must depend on the locale.
- Mounted React tests use `src/test-support/mounted.ts`.

## Store translations (plan complete; one fix pass left)

All ten tasks are built and reviewed:
- the per-seller task queue (Durable Object `TaskRunner`, D1 `tasks`);
- metering through AI credits;
- text extraction;
- storage;
- the `store.translate` kind;
- serving with HTMLRewriter, the overlay and the switcher;
- the shopper pages;
- the API, with the `store-translations-paused` flag and a publish hook;
- the Translations page, in the sidebar after Emails;
- the editor.

A live check on localhost translated a store into es and pt-BR for 2 credits each and kept a seller edit across a re-run.

### The final review's fix pass (not done yet)

Do each item test-first.

1. **Untouched stores never get a guessed language.**
   - `batchWithSettings` creates the settings row with the owner's app locale. Any first settings save, such as a toggle, then raises `version` above 1, and `shopperLanguage` (`worker/services/store-translations/serve-context.ts`) serves checkout in that guessed language.
   - Server: refuse with a 400 ("Choose your store's language first.") any patch on an untouched store (`version <= UNTOUCHED_SETTINGS_VERSION`) that doesn't name `sourceLocale`. That includes the save inside `run`.
   - UI (`src/routes/translations/`): disable the settings switches and the language switches behind a "Your store is written in" select plus Confirm, until it is saved.
   - Regression test: an owner who uses the app in Spanish and turns a switch on without confirming leaves checkout English.
2. **Untouched stores keep their URLs.**
   - `store.js` (`worker/services/store-payments/store-script.ts`) adds `lang=` to requests, and `servePayPage` (`worker/api/handlers/store-platform.ts`) carries `lang` on return paths. Today both happen even when the store offers only one language, so every store's checkout returns to `/thanks?lang=en`.
   - Do both only when the store offers more than one language.
   - Test an untouched store end to end: `store.js`, the `/pay` link, and the return paths all unchanged.
3. **Spanish variety.** In `worker/services/store-translations/prompt.ts`, Spanish becomes "neutral Latin American Spanish, using Mexican vocabulary where words differ, with tú; no voseo, no regional idioms". A live run produced the Argentine "poner la pava". Change the prompt, not `LOCALE_AI_NAMES`, and assert it in `prompt.test.ts`.
4. **The see-through dialog.** The Translate confirm dialog panel is transparent in the browser, so page text shows through. `src/components/ui/dialog.tsx` already has `bg-kumo-base`. Find the cause, for example portal theme scoping, and fix it in the shared component. The billing and order dialogs use it too.
5. **Overlay version.** Make `/__estori/i18n.js?v=` cover re-extraction by adding `extracted_at` to `v`. Don't bump `version` in `replaceTexts`: `version > 1` means "the seller touched this store".
6. **Top-ups on a ready language.** When the language is already ready, a task that ends with skipped texts finishes as done with a skipped count, not failed. The relevant code is `worker/services/store-translations/translate-kind.ts`.
7. **Buying credits resumes paused tasks.** On a credit purchase or plan change, resume the seller's credit-paused tasks and wake the runner (`resumePausedTasks`, quiet check). Never fail the billing event.
8. **Serving memory.**
   - Serving reads only translations of texts the store still has: join on the current `store_texts`.
   - Bound the per-isolate dictionary cache (`serve-context.ts`) by total characters, about 8 MB.
9. **Dialog dismiss.** If the seller dismisses the Translate dialog during the store-language save, don't send the run.
10. **Glossary note.** Fix the `shared/i18n/glossary.md` note that mentions the removed bare status keys ("Ready", "Done"…).
11. **Duplicates from the merge (DRY).**
    - `worker/utils/server-translate.ts` (`translateFor`) duplicates `worker/services/i18n/server-t.ts` (`serverT`): make one delegate to the other.
    - `STRIPE_LOCALES` exists in both `shared/types/stripe.ts` and `src/lib/stripe/stripe-js.ts`: keep the shared one.

Owner decision, not code: when a translation step's first model call succeeds and its retry fails, the first call isn't charged.

## App in Spanish and Portuguese (plan tasks 1-6 done, 7 needs a fix round, 8-13 left)

**Done:** the core, the extraction tooling, the language preference, the shell and home, sign-in and sign-up, settings, billing and checkout, and the chat and editor (task 7, reviewed).

**Task 7 fix round, still open:**
- `src/routes/chat/utils/handle-websocket-message.ts` uses the server's English as the reset row's tool name. Always use `name: 'conversation_reset'`.
- Add `VERBS` entries in `src/routes/chat/utils/tool-display.ts`, in en, es and pt-BR, for:
  - `list_drafts`, `create_draft`, `switch_draft`
  - `bring_in_live_changes`, `cancel_bringing_in_live_changes`
  - `search_catalog`, `get_catalog_product`
  - `get_payments_setup`

  Add a guard test that every tool `ThinkAgent.getTools()` registers has a `VERBS` key.
- The resume message `RESUME_BUILD_MESSAGE` shows as an English bubble from the seller. Keep sending English to the assistant, but render `t('Continue where you left off.')` in `UserMessage` (`src/routes/chat/components/messages.tsx`).
- The debug panel (`src/routes/chat/components/debug-panel.tsx`) is shown to every seller, so translate its chrome: the toggle, header, tabs, buttons and support flow. Log lines stay raw. Remove its `!` exclusion from `COVERED`.
- Wording:
  - "Application" becomes "app".
  - "Redefinir conversa" becomes "Limpar conversa".
  - The "No se pudo leer {count} archivos" group error uses `tn`.
  - Drop any "Inténtalo de nuevo" or "Tente novamente" the English lacks.

**Task 8: publishing, drafts and editor dialogs.** Cover:
- `src/components/live-store/`, `src/components/drafts/`, `src/components/publishing/` (`UseSiteButton`, `SiteReuseBar`, `PublishDialog`);
- `config-modal.tsx`, `github-export-modal.tsx`, `byok-api-keys-modal.tsx`, the vault and secrets components, `src/components/payments/`;
- `src/features/presentation/`, `src/features/general/`, `config-card.tsx`, the agent and behavior mode toggles, `confirm-button.tsx`;
- `use-github-export.ts`, `use-publishing.ts`, `use-app.ts`, `limits-context.tsx:84`.

**Task 9: discover, orders, emails, catalog and the remaining seller pages.**
- Pages: `src/routes/{discover,orders,emails,catalog,payments}/`, `AppCard.tsx`.
- Specific spots:
  - `DiscoverStrip.tsx:39` hard-codes "Free".
  - `paid-listing-display.ts` builds English sentences around prices.
  - `discover/site.tsx:43` compares to an English constant; use `isMessage`.
  - The status maps in `order-format.ts` and `email-format.ts`, and `PayoutFrequency.tsx`.
- Find what's left with `rg -l "<" src/routes src/components` against `COVERED`.

**Task 10: server messages.**
- Use a request-scoped locale: the saved locale, then `Accept-Language`.
- `api-client` sends `Accept-Language: getLocale()` on every request.
- Mark messages with `msg()`, translate them in `createErrorResponse` at the response boundary, and add an AST guard. Admin controllers are exempt.
- Durable Object broadcasts (`phase_*`, `generation_*`, deployment and GitHub export) have no request, so use the session's saved locale.
- Wrap the capture-failure reasons in `worker/agents/think/reference-service.ts` with `msg()`.

**Task 11: seller emails.** 19 templates in the recipient's saved locale. `billing-templates.ts:30` needs a locale-aware date with the year.

**Task 12: AI replies in the seller's language.** Add one system-prompt line: "Reply to the seller in ${LOCALE_AI_NAMES[locale]}".

**Task 13: walkthrough, CI and final review.**
- Walk through es and pt-BR at 1280 px and 375 px.
- Do a fluent-speaker pass on both catalogs, covering tone, consistency and length.
- Check the chat header buttons at 375 px.

## How to verify

Run from the repo root:
- `bun run lint` should show 0 errors. Six warnings already exist.
- `bun run typecheck`.
- `bun run test`, sharded. On macOS, local ports run out: shards can fail with `EADDRNOTAVAIL`. Re-run the failed shard on its own, or as smaller shards (`--shard=1,2,17,18/32`), after `netstat -an | grep -c TIME_WAIT` drops under about 1,500.
- `bun run build` and `bun run bundle:check`.

Focused suites for this work:
- `shared/i18n/`, `src/i18n-coverage.test.ts`, `src/lib/i18n/`
- `worker/services/tasks/`, `worker/services/store-translations/`
- `worker/database/services/TaskService.sql.test.ts`, `worker/database/services/StoreTranslationService.sql.test.ts`
- `worker/api/controllers/storeTranslations/`, `worker/api/controllers/tasks/`
- `worker/api/handlers/` (store platform, live store, pay page), `src/routes/translations/`, `src/routes/chat/`, `src/routes/settings/`

**Live check:**
1. `npm run dev -- --port 8100 --strictPort`. Local `.dev.vars` sets `BILLING_USER_IDS` for the local creator account.
2. Open `/translations`, pick a deployed store, and translate to Español.
3. Check the credits.
4. Open `http://<slug>.stores.localhost:8100/?lang=es`.

## Owner steps for production

- Create the PostHog flag `store-translations-paused` at 0%. Without it, the kill switch can't be flipped.
- Add `task_finished` `credits_used` to the PostHog AI-cost insight and the "AI cost over budget" alert.
- The D1 migrations 0031–0034 and the Durable Object migration `v8` (`TaskRunner`) are applied by the deploy.
- Have the lawyer review the Spanish and Portuguese subscription agreement wording (`shared/i18n/catalogs`, the keys starting "I agree to the" and "{plan} renews").
