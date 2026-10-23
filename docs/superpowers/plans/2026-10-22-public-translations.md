# Public Spanish and Portuguese translations

## Goal and scope
Translate the current public Estori site into neutral Latin American Spanish and Brazilian Portuguese, preserving the concise, direct English voice and existing design. User authorized autonomous work after committing Discover and creating PR #33. Work is isolated on codex/public-spanish-portuguese, based on Discover commit d787c385.

## Architecture
Keep src/content/marketing/en.json as the canonical shared source (also consumed by Worker metadata). Add matching Spanish and Portuguese marketing catalogs, flatten these into the existing lazy-loaded English-key i18n catalog, and translate at render time through t/useI18n. Module-level source arrays remain canonical; display fields translate when rendered. Never mutate content, intercept DOM text, or change identifiers, URLs, product names, or user content. No locale-prefixed routing in this change. The existing locale selector, persistence, and document language remain authoritative.

## Work and ownership
- Native-quality marketing catalogs: independent Spanish and Portuguese tasks, exact shape/placeholder parity and glossary rules.
- Render wiring: public header/footer, home and shared marketing UI; subscription to locale where memoization or animation depends on it.
- Pricing, solution/platform/industry/creator/contact/blog pages: translate visible text, metadata, FAQ and accessibility text, preserve route/data identifiers and behaviors.
- Additional public copy catalog: cover source data outside marketing JSON and curated Discover descriptions/categories. Preserve original item names, downloaded demo content, and legal bodies; localized legal links identify English documents.
- Verification: catalog shape/key/placeholder checks; locale-switch rendering tests, English regression checks, prices stay USD; browser desktop/mobile smoke checks in both languages. Run root typecheck/lint/full tests/build and review changes before completion.

## Decisions
- Spanish uses tú, Portuguese uses você; button labels use infinitives. Follow shared/i18n/glossary.md.
- No production deployment, live payment, or remote seed. Translations affect public visualization and existing locale infrastructure only.
- No approval checkpoint is needed: user explicitly requested autonomous execution.

## Progress
- [x] Commit/push Discover and open/attach PR #33.
- [x] Create separate translation branch.
- [x] Translate catalogs and additional public copy.
- [x] Wire public pages and reactive locale changes.
- [x] Verify both languages and fix review findings.
- [x] Prepare translation work for commit on its separate branch.

## Verification results
- Root typecheck and production build passed; root lint has no errors (six existing Fast Refresh warnings).
- Full Workers suite: 569 files, 5,083 passing tests, two skipped. Used a temporary serial Workers configuration to avoid the local port exhaustion seen with default parallelism; the same suite and Workers runtime were exercised.
- Catalog structure, placeholder/rich-tag/plural parity, brands and source-key coverage checked for both languages.
- Added live calculator locale-switch coverage with edited inputs retained, localized pricing and blog-fee checks, contact-error rendering and sign-in-return confirmation checks.
- Independent review fixed untranslated feature requests, contact failures, sign-in-return messages and duplicated English-document markers. Industry structured data now follows the selected browser language.
- Browser: Spanish home/pricing and mobile navigation; Portuguese pricing/community mobile and premium Discover modal. Verified 390px layouts without horizontal overflow and preserved original template names/demo content. Restored English and normal viewport afterward.
- No production deployment, remote data changes or live payments.
