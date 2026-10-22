# Solution page layouts

**Goal:** Reformat the five `/solutions/*` pages with audience-specific sections and a reusable use-case carousel, using the supplied reference's visual hierarchy with Estori styling.

**Scope:** Brands, resellers, digital products, subscriptions and communities. Keep platform pages and public navigation intact. Use the user's approved Estori examples; no invented testimonials or performance claims. Consolidate repeated landing-page blocks. Preserve SEO metadata, early-access handling and existing deep links. Clearly distinguish available features from future concepts.

## Implementation

- [x] Centralize audience copy in `src/content/marketing/en.json`; define typed page/art configuration in `src/content/solution-landings.ts`.
- [x] Add code-native illustrative store panels and an asymmetric four-card benefit grid, reusing bundled images.
- [x] Add `SolutionCarousel`: native horizontal scroll/snap, touch support, accessible previous/next buttons, keyboard navigation and slide announcements; no autoplay.
- [x] Build `SolutionLandingPage` with hero, problem strip, benefit grid, three-step flow, example carousel, compact future-feature links where needed, CTA and existing FAQs. Route all five solution pages through it; retain existing anchor targets and early-access actions.
- [x] Verify content/statuses, meaningful rendered carousel semantics, updated route/SEO guards, keyboard and button navigation, swipe/scroll behavior, mobile overflow, typecheck/lint/build and browser previews.

The reference is https://www.vori.com/produce-markets. It informs layout only; its copy, images and customer quotes are not reused. Do not commit this new work unless the user requests it.


## Verification

- 50 focused tests passed across audience copy, rendered layout/carousel semantics, route/SEO guards, assistants, positioning rules, platform content and public page metadata.
- Root typecheck and production build passed. Lint passed with the same six existing Fast Refresh warnings.
- Browser checked all five audience routes, visible early-access/coming-soon labels and the digital early-access sign-in prompt without submitting a request.
- Carousel verified with arrow buttons, keyboard End, native mobile horizontal scrolling, disabled end controls and responsive resize. No page-level horizontal overflow; loaded images showed no failures.
- Independent read-only review found one missing AI-discovery detail link; it was restored and its regression test passed. Review confirmed no remaining findings.
- Previews saved to `/tmp/estori-solution-brands-hero.png`, `/tmp/estori-solution-benefit-grid.png`, `/tmp/estori-solution-use-case-carousel.png` and `/tmp/estori-solution-community-mobile.png`.
- New changes remain uncommitted; no deployment or production mutations.

## Step-animation follow-up

The shared three-step flow uses `AnimatedSolutionSteps`: left-to-right bars and progressive words, with complete instructions available to screen readers. At the user's request, Replay was removed and the sequence now loops: four seconds per step followed by a 2.5-second reading pause. Animation and timers pause offscreen; reduced motion shows all instructions immediately. Sixteen focused tests and root typecheck/lint passed (six existing lint warnings). Browser checks observed progressive filling and a return to step one with later steps reset. Preview: `/solutions/resellers#steps`.
