# Store translations and the seller task queue

Date: 2026-10-21.

The owner asked for this after Estori's own app became multilingual. The request, verbatim:

> "lets plan how to bring translation to stores as well. The translations should run against their credits. I imagine a queue system that serves not only for translation but also for other processing tasks like content creation and other kind of tasks scheduled. Create the plan and implement this in a different branch, make sure to have some translations completed and this should have its own option in the sidebar."

The owner was asleep and asked for autonomous work. Every decision below the request is the coordinator's, and section 12 lists them for review.

## 1. Intent

A seller's store should reach shoppers in their own language without the seller rewriting it.

**Success means:**
- The seller turns on Spanish or Portuguese for a store.
- Estori translates the store's text in the background and charges the seller's AI credits for it.
- A shopper whose browser prefers Spanish sees the store in Spanish: pages, products, the cart and checkout.
- The shopper can switch languages from a small switcher.
- The seller can see and correct every translation.

The work runs on a **task queue** built for more than translation. Content creation and scheduled work are named next, so the queue is generic from the start: kinds of tasks, scheduling, progress, retries and credits per task. Translation is its first kind.

## 2. Scope

**In:**
- **The task queue:**
  - a D1 table of tasks;
  - one runner per seller (a Durable Object);
  - a kind registry;
  - progress, retries, pause, cancel and resume;
  - scheduling by time;
  - a sweep on the existing cron;
  - credits per step.
- **Store translation:**
  - extraction of a store's text;
  - the translation task;
  - stored translations with seller edits;
  - serving translated stores on live and preview hosts;
  - the language switcher;
  - Estori's own shopper pages (checkout, store messages) in the shopper's language.
- **Seller app:** a "Translations" item in the sidebar and its page, translated into Spanish and Portuguese like the rest of the app.
- **Automatic upkeep:** new text in a published store is translated after publishing, when the seller allows it.

**Out, for follow-ups:**
- **More task kinds:** content creation and recurring schedules. The queue is ready for them.
- **Languages beyond English, Spanish and Portuguese (Brazil).** Adding one means adding Estori's checkout text for it and adding it to the list.
- **Text that a store loads from its own database or API at runtime** (App SQLite rows, server JSON). Only text present in the store's built files and its `estori-store.json` is translated.
- **Shopper emails** in the shopper's language. They are seller-written templates and stay as written.
- **Language in the URL path** (`/es/...`) and per-language indexing. This round uses `?lang=` with `hreflang` links.
- **Text inside images.**

## 3. Languages

- **Store languages:** `en`, `es` and `pt-BR`, the same three as Estori's app (`shared/i18n/locales.ts`), with the same varieties: Latin American Spanish with "tú", Brazilian Portuguese with "você".
- **Source language:** each store has one, the language it is written in.
  - It defaults to the seller's own app language, because a seller using Estori in Spanish most likely writes in Spanish.
  - The seller can change it.
- **Targets:** the other languages. The seller turns each on or off.

## 4. What gets translated

Text is read from what shoppers are served: the built deployment of the live store, plus the active draft's deployment so text about to be published is ready too.

| Source | Text |
|---|---|
| HTML assets (`*.html`) | Text nodes, except inside `script`, `style`, `noscript`, `code`, `pre` and `template`. Attributes `alt`, `title`, `placeholder`, `aria-label`, and `value` on submit or button inputs. `<title>`, `meta[name=description]`, `og:title`, `og:description` |
| JS assets and server modules | String literals and template-literal text that read as words a person reads: letters, and a space or a capital start. Skip URLs, paths, selectors, identifiers in camel, snake or kebab case, and import specifiers. HTML inside a string is parsed for its text |
| `estori-store.json` | Product names, descriptions and variant names. Not the brand name |

**Normalization and limits:**
- Text is normalized by trimming and collapsing whitespace, and keyed by a SHA-256 of the normalized text.
- Text with no letters, or longer than 5,000 characters, is skipped.
- A store yields at most 5,000 texts; past that, the extraction says so.
- Parsing uses the libraries already in the project: `htmlparser2` for HTML and `acorn` for JS.

## 5. The translation task

- **Starting.** The seller starts a task for one store and one target language. Each language is its own task, so they progress and fail independently.
- **What a task translates.** It translates only texts that have no translation in that language yet. Seller edits are never overwritten.
- **Batching.**
  - Each step sends one batch, at most 40 texts or 12,000 characters, to the model.
  - The response is structured output: the same ids with their translations.
  - Each batch is written as it lands, so a stopped task resumes where it left off.
- **The model instructions:**
  - Keep brand and product names, numbers, prices, URLs, emoji and HTML entities as they are.
  - Keep `{placeholders}` and any inline markup.
  - Match the tone of a store talking to its shoppers.
  - Use the language variety in section 3.
- **Model.** The cheapest current Flash model in `THINK_MODELS`, called through Estori's gateway the way the Think agent calls models, so token usage is known.
- **Bad output.** A batch whose answer is missing ids or drops placeholders retries once with the problem named. After that, the texts it could not translate stay in the source language and are counted as skipped.
- **Readiness.** A language is **ready**, meaning shoppers can be served it, once its first task finishes. Turning a language off stops serving it and keeps its translations.

## 6. The task queue

**Tasks** (D1 `tasks`):
- **Columns:** `id`, `user_id`, `app_id` (nullable), `kind`, `status`, `payload` (JSON), `progress` (JSON: done, total, skipped), `credits_used`, `attempts`, `last_error`, `pause_reason`, `run_at`, `lease_until`, `dedupe_key`, `created_at`, `started_at`, `finished_at`.
- **Statuses:** `queued`, `running`, `paused`, `done`, `failed` and `canceled`.
- **Dedupe:** a seller can't queue the same work twice. `dedupe_key` is unique among unfinished tasks, for example one translation task per store and language.
- **Limit:** a seller can have at most 50 unfinished tasks.

**Kinds:**
- Each kind is a registered handler with a stable id (`store.translate`), a label for the seller, and a `step` function.
- `step` does one bounded piece of work (one model call, at most a few seconds of other work) and returns the new progress and whether the task is finished.
- A step must be safe to repeat.

**Running:**
- **One runner per seller.** It is a Durable Object named after the seller, and it works one step at a time.
- **Why per seller:**
  - credits are spent in order, so a seller can't overspend through parallel tasks;
  - one seller's large job can't starve another's;
  - work starts immediately, with no polling delay.
- **Waking:** queuing or resuming a task wakes the seller's runner.
- **Each alarm:**
  1. Claim the seller's next due task with a short lease.
  2. Run one step.
  3. Save its progress, then release.
  4. Arm again at once if more work is due, or at the next scheduled `run_at`, or not at all.
- **Failures:** a failed step retries with backoff: 30 seconds, 2 minutes, 10 minutes, 30 minutes, then 2 hours. After 5 failures in a row the task is `failed`, with the error the seller sees and a Retry button.
- **The sweep:** the 15-minute cron finds sellers with due tasks and no live lease and wakes their runners, so a lost alarm loses nothing.

**Scheduling:**
- A task can be queued for a later time (`run_at`), which also drives retries.
- Recurring schedules are a follow-up. A kind can queue its own next run.

**Pause, cancel and resume:**
- The seller can cancel an unfinished task, and resume a paused or failed one.
- A task pauses itself when credits run out (section 7).

## 7. Credits

Tasks are metered exactly as the Think agent's turns are, so a translation costs what the same tokens would cost in a build.

- **Billing on** (the `billing` flag, a paid plan, or `BILLING`):
  - Each model call is charged from its token usage with the model's prices (`stepCredits`).
  - It is recorded through `chargeStep` with a new source, `task`. The use key is `task:<taskId>:<step>:<call>`, so a repeated step is never charged twice.
  - Before each step the runner checks the balance (`checkCreditsBeforeTurn`).
  - With no credits left, the task pauses with the reason "out of credits".
  - The daily billing job resumes credit-paused tasks once the seller has credits again, such as a new period or a purchase.
- **Billing off** (production today): calls count against the same daily allowance the agent uses when billing is off, and a task pauses when it runs out and resumes the next day.
- **Estimates.** Before starting, the seller sees an estimate from the characters to translate and the model's prices, and with billing on, the credits they have left.
  - The estimate reads "About 1,200 credits".
  - Actual use is shown on the task as it runs.

## 8. Serving translated stores

**The shopper's language**, in order:
1. `?lang=xx`, which also sets a cookie (`estori_lang`, one year).
2. The cookie.
3. The browser's `Accept-Language`, when the store matches browser languages (on by default).
4. The store's source language.

Only the source and **ready** languages can be chosen.

**HTML pages** (live store and preview, in the Worker, after the store's response):
- When the language isn't the source, an `HTMLRewriter` replaces each text node and each attribute in section 4 with its translation, and sets `<html lang>`.
- Text with no translation stays as written.
- Every page of a store with a ready language gets:
  - `hreflang` alternate links (`?lang=`);
  - `Content-Language`;
  - `Vary: Cookie, Accept-Language`;
  - the language switcher.

**Text added by scripts:**
- Pages in a translated language load `/__estori/i18n.js?lang=xx&v=<version>`.
- It is a small Estori script with that language's translations inside. It translates text and attributes that the store's scripts add or change later, through a `MutationObserver`.
- It is versioned, so browsers cache it until the translations change.

**Store data and Estori's pages:**
- `/__estori/store` returns product names, descriptions and variant names in the shopper's language.
- `/__estori/store.js` messages, the checkout page (`/__estori/pay`), and the plain pages ("This store isn't open right now") use Estori's own Spanish and Portuguese text from the app's catalogs.
- Stripe's card form gets the matching `locale`.
- Money stays in US dollars, written the shopper's way (`formatUsd` with the locale).

**The switcher:**
- It is small, fixed at the bottom-left, and lists the store's ready languages by their own names: English, Español, Português.
- Each language is a link that sets `?lang=`.
- The seller can hide it.
- It is accessible: a labelled button and a list.

**Performance:** settings and translations are cached per isolate for 30 seconds, like store hosts. A version number on the store's settings changes whenever translations change.

## 9. Seller app

**Sidebar:**
- "Translations" goes after Emails, with the `TranslateIcon`, at `/translations`.
- It is shown to signed-in sellers.
- It is hidden, and the API refuses, when the new pause flag `store-translations-paused` is on.

**Page:**
1. **Store picker.** It lists the seller's stores that have been deployed at least once.
2. **Settings for the chosen store:**
   - store language (source);
   - "Match the shopper's browser language";
   - "Show a language switcher";
   - "Translate new text when I publish".
3. **One card per target language:**
   - status: Off, Not translated, Translating, Ready, Paused or Failed;
   - percent translated and texts left;
   - an estimate and a Translate button that confirms the estimate;
   - Preview, which opens the store with `?lang=`;
   - an on/off switch.
4. **Activity.** The store's tasks with progress bars, credits used, times, and Cancel, Resume and Retry. It refreshes every 3 seconds while a task is running.
5. **Translations editor.** For each language, a searchable list of source text and translation, each editable.
   - A seller edit is marked "Edited by you".
   - The next task never changes it.
   - A seller can return it to the machine translation.

**Copy:**
- Seller-facing copy names no AI provider. "AI credits" is the existing term.
- Every new string is in Spanish and Portuguese in the app catalogs, and the page is in the coverage list.

**Publishing hook:** when a store is published and "Translate new text when I publish" is on, Estori queues a translation task for each ready language. It translates only new text.

## 10. Data

- **`tasks`:** section 6.
- **`store_translation_settings`:**
  - `app_id` (PK), `source_locale`, `targets` (JSON: locale to enabled and ready flags), `match_browser`, `show_switcher` and `auto_translate`;
  - `version`, which goes up on any change to settings or translations;
  - `updated_at`.
- **`store_translations`:**
  - `app_id`, `locale`, `source_hash`, `source_text`, `text`, `origin` (`machine` or `seller`) and `updated_at`;
  - primary key `(app_id, locale, source_hash)`.
- **`store_texts`:** the last extraction per store.
  - `app_id`, `source_hash`, `source_text`, `kind` (page, script or product) and `seen_at`;
  - it is replaced by each extraction;
  - "texts left" and estimates read from it.
- **SpaceDO** gains one read-only RPC that returns a deployment's text assets, server modules and store manifest for a branch, `live` included. It reads the stored deployment row, so it works after a cold start.

## 11. Quality

**Tests, in the project's patterns:**
- pure functions with fakes: queue stepping, extraction, batching, language choice, HTML rewriting and estimates;
- real-D1 tests for the services;
- wiring tests for the runner, configs, routes and cron;
- a mounted test of the page.

**The task runner Durable Object** follows `CatalogOrderRunner`:
- RPC methods only store state and arm the alarm;
- the work runs in `alarm()`;
- the logic is a pure step function.

**Live check:** a real local store is translated into Spanish and Portuguese with real model calls and billing on for the test account. That shows:
- credits charged;
- the store served in both languages, with the switcher;
- a seller edit that survives a re-run;
- the page at phone and desktop widths in all three app languages.

## 12. Decisions

| Decision | Why | If wrong |
|---|---|---|
| Store languages are `en`, `es` and `pt-BR` only | Estori's own checkout text exists in those, so nothing a shopper sees is half-translated; Mexico and Brazil are the next markets | add a language with its checkout text |
| Translate what the store serves (built HTML, JS and the store manifest), at serve time, keyed by the text itself, rather than rewriting the store's code | works for every existing store without touching its code or risking a broken build; seller edits live in one place | have the agent build stores with a message file and translate that |
| Server-side `HTMLRewriter` plus a small script for text added by scripts | no flash of the original language on page load, and text rendered later is still translated | script-only or server-only |
| Language from `?lang=`, then a cookie, then the browser, then the source; no `/es/` paths | store routers know nothing of language prefixes; parameter URLs work with `hreflang` | add path prefixes with a router shim |
| One task runner per seller, a Durable Object, with tasks in D1 | credits spent in order, fairness between sellers, an immediate start; D1 lets the app and the sweep read tasks | Cloudflare Queues or Workflows |
| No Cloudflare Queues or Workflows | none exist in the project; a Durable Object needs no new account resource, so deploys need no owner step for it | move the runner onto Queues later |
| Tasks are metered like the agent: credits with billing on, the daily allowance with billing off | translation is AI work and the owner asked that it use credits; one rule for all AI work | charge credits even with billing off |
| A task pauses when credits run out and resumes when there are credits again | no surprise failures, and nothing is lost | fail the task |
| Translate new text after publishing is on by default once a language is on | otherwise newly published text shows untranslated to shoppers | default it off |
| A language is served only after its first task finishes | shoppers never get a half-translated store | serve as translations land |
| The switcher is shown by default, bottom-left | shoppers need a visible way to change language | let sellers place it |
| The brand name is never translated, and product names keep proper nouns | names are the seller's brand | let sellers mark more terms |
| Seller edits always win over machine translations | the seller owns their store's words | add an "overwrite my edits" option |
| A new pause flag, `store-translations-paused` | the owner can stop translation in production at once, like other features | none |
| Estimates come from characters and model prices | the seller sees roughly what a task costs before it runs | show a range |
| The work runs in agents' own worktrees on `feat/store-translations`, stacked on `feat/i18n` | this session may not write into a second worktree, and its screens use the app's `t()` | rebase onto the finished `feat/i18n` before review |
