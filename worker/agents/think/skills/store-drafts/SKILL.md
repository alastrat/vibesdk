---
name: store-drafts
description: Drafts are versions of the store, each with its own preview. Load it when the seller asks for a quick fix to the live store, wants to try another direction, mentions drafts, or asks to bring the live store's changes into a draft.
---

# Store drafts

A store has up to five drafts, counting Main. One is being edited at a time: your edits go to it and the preview shows
it. Publishing sends one draft to the live store, and only the seller publishes, with the Publish button. You can't
publish, so when asked, tell the seller to use Publish; the draft switcher shows which draft is ready.

Talk about drafts, versions and the live store. Never say branch, merge, commit or git to the seller.

`create_draft`, `switch_draft` and `bring_in_live_changes` change which draft your edits reach, and each says: "Call
this on its own, never in the same step as file edits." A file edit in the same step can land in either draft.

## Quick fixes

If you're editing Main and it has unpublished changes, start a quick fix from the live store for a small change (a
typo, a price, a phone number), so the change goes out alone. If you're already editing another draft, make the change
in that draft: never start a new draft unless the seller asks or you're on Main. `list_drafts` shows which draft you
are editing and where each draft started.

1. `create_draft` with `from: "live"` and a short name such as "Typo fix".
2. Make the change and `deploy_space`.
3. Tell the seller to check the preview and publish it. Main keeps its own work.

A quick fix starts from the live store, so it needs a published store. Before the first publish, edit Main.

## Other directions and other drafts

When the seller wants to try another direction, `create_draft` with `from: "main"` copies Main, so Main stays as it
is. `list_drafts` shows the drafts and which one you are editing; `switch_draft` moves your edits to another draft by
its name. `deploy_space` only deploys the draft you are editing, so switch first to work on another.

## Bringing in the live store's changes

When a draft is behind the live store (for example Main after a quick fix was published) and the seller asks, call
`bring_in_live_changes`. Never call it on your own. It works on the draft being edited, or on the draft named in
`draft`, which it switches to first.

- **up-to-date, fast-forward or merged:** done, and the preview rebuilt. Tell the seller. If `next` says the build
  failed, fix it and `deploy_space` again, or `cancel_bringing_in_live_changes` and tell the seller what blocked it.
- **conflicts:** the result lists the live store's changes in `liveChanges`, and up to three kinds of files:
  - `files` have conflict markers. Each conflict has a line starting `<<<<<<<` followed by a name, this draft's
    version, a line `=======`, the live store's version, then a line starting `>>>>>>>` followed by a code. Keep the
    intent of both: this draft's work and the live fix. Remove all three marker lines. Never repeat the names or codes
    on those lines to the seller.
  - `deletedByDraft` are files this draft deleted and the live store changed. The file holds the live store's version
    for now. Decide whether to keep it or delete it.
  - `deletedByLive` are files the live store deleted and this draft changed. The file holds this draft's version for
    now. Decide whether to keep it or delete it.

  Then `deploy_space`. While any marker stands, `deploy_space` refuses and says which file still has one. If the
  build fails, fix it and deploy again. If you can't get a clean build, call `cancel_bringing_in_live_changes` and
  tell the seller what blocked it.
- **binary-changed-on-both-sides:** nothing was brought in. The `files` (images, fonts) changed in this draft and in
  the live store and can't be combined. Tell the seller which files they are and that they should replace them in one
  version first. Don't try again until they have.

Finish or cancel within the same turn: an unfinished one is cancelled when your turn ends, and the draft goes back
to how it was. Never call `ask_questions` while bringing in live changes; decide, or cancel and tell the seller.
