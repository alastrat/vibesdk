# Workspace styling and account settings

## Intent
Refine the approved workspace/store preview using Estori's current public-site typography and palette, with Whop-inspired navigation, compact tables, charts, account menu, and a searchable settings modal. Keep Kumo as the UI component foundation.

## Completed handoff
The previous preview, localized 404, and public translations are published in PR #34, stacked on PR #33. This next iteration lives on `codex/workspace-account-settings`.

## Proposed approach
Reuse installed Kumo DropdownMenu, Dialog, Table, Input, Button and selection controls. Use DM Sans, Estori blue/navy, neutral surfaces, restrained borders, and compact spacing. Place a reusable avatar menu at the top right of both workspace and store views. Remove the duplicate account control from the store rail.

Use existing Recharts for accessible interactive line/area charts with thin gridlines, readable ticks, tooltips, date controls, and honest empty states. Switching to visx would add dependencies and bespoke interaction work without being necessary for the requested visual result. Whop's implementation library has not been verified.

Alternatives considered: copying Whop's full account taxonomy would introduce irrelevant controls; replacing the existing chart stack would increase implementation and maintenance work. Adapt the visual patterns to Estori's existing services instead.

## Account menu and modal
Menu: identity and profile, settings, help/support, language, legal links, sign out, and system/light/dark appearance. Only show service-backed destinations relevant to Estori. Do not invent a wallet, resolution center, invitations, or notification controls without working supporting services.

Settings modal: searchable left navigation, content header, close action, responsive navigation, accessible focus management, and these sections:
- Profile: display name, username, bio, timezone; validated edits with pending/error/success states.
- Appearance and language: system/light/dark and English/Spanish/Brazilian Portuguese using existing preferences.
- Connected accounts: existing identity linking/unlinking rules and providers.
- Security: active sessions and relevant existing security controls; explicit confirmation for destructive actions.
- Billing and credits: existing plan/usage data and links into supported billing/payment flows, preserving billing invariants.
- Privacy: existing analytics preference and Global Privacy Control enforcement.

Use existing apiClient methods and TanStack Query with user-scoped keys and cache invalidation for real account mode. Do not expose personal account data to unauthenticated preview visitors. Mock data remains clearly identified. Never display a success message for an unsaved setting.

## Approved scope
The user approved applying this to the authenticated app and saving real account settings using existing Estori services. The public landing pages stay in their public layout. Store dashboards use owner-scoped data and preserve builder/payment/order workflows.

## Implementation sequence
1. Settle the two decisions above, then record final scope and a focused implementation plan.
2. Shared appearance tokens/font and top-right Kumo account menu in workspace/store views.
3. Kumo settings modal and supported settings integrations with validation, loading/error handling, and shared cache updates.
4. Kumo table styling and interactive Recharts charts with consistent formatting and sample/empty-state behavior.
5. Localize new user-facing strings in English, Spanish, and Brazilian Portuguese.
6. Verify keyboard/focus behavior, mobile layout, appearance modes, locale changes, persistence, account changes/logout, and relevant settings failures. Run typecheck, lint, focused tests, and build. Review the diff for unintended app rollout or secret/local configuration changes.

## Verification boundaries
Browser checks must not revoke the user's sessions, disconnect providers, create API keys, purchase credits, or make other consequential changes simply to demonstrate the UI. Test those state transitions with mocked services and meaningful integration/unit checks. Existing local HTTPS files and secrets remain untracked.
