/**
 * A store's drafts: named versions of it, each backed by a git branch in the workspace. Sellers name drafts; branch
 * names are generated from the id, so nothing a seller types reaches git.
 */

export const MAIN_DRAFT_ID = "main"
export const MAIN_DRAFT_NAME = "Main"
export const MAIN_BRANCH = "main"
/** Drafts per store, counting Main. Mirrored in shared/types/drafts.ts. */
export const DRAFT_LIMIT = 5
export const DRAFT_NAME_MAX_LENGTH = 40
/** Durable storage key holding the checked-out draft's branch, which a cold start rebuilds the workspace from. */
export const ACTIVE_BRANCH_KEY = "drafts:activeBranch"

const DRAFT_ID_LENGTH = 8
const DRAFT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
/** 252 = 36 * 7: bytes below it map onto the alphabet evenly. */
const UNBIASED_BYTE_LIMIT = 252

export const DRAFTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    branch TEXT NOT NULL UNIQUE,
    started_from TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

export type DraftStart = "main" | "live"

export interface DraftRecord {
  id: string
  name: string
  branch: string
  startedFrom: DraftStart
  createdAt: number
  updatedAt: number
}

/** One draft as the seller sees it. */
export interface DraftSummary {
  id: string
  name: string
  startedFrom: DraftStart
  updatedAt: number
  /** Checked out: the chat edits it and the preview shows it. */
  active: boolean
  /** Its latest version is what the live store serves. */
  live: boolean
  /** The live store was last published from it. */
  publishedFromHere: boolean
  /** It has changes the live store doesn't. */
  unpublishedChanges: boolean
  /** The live store has changes it doesn't. */
  behindLive: boolean
  /** The AI is bringing the live store's changes into it. */
  bringingInLiveChanges: boolean
}

export interface DraftsSnapshot {
  drafts: DraftSummary[]
  activeDraftId: string
  /** The store has been published at least once. */
  published: boolean
  limit: number
}

export interface ActiveDraft {
  id: string
  name: string
  branch: string
}

export type ActivateDraftResult = { draft: ActiveDraft; previewStale: boolean } | { error: string }
export type CreateDraftResult = { id: string; name: string } | { error: string }
export type PublishDraftResult =
  | { commitHash: string; storeManifest: string | null; draftId: string; draftName: string }
  | { error: string }

/** What the Go live panel needs: the draft being edited, and the draft the live store came from. */
export interface PublishContext {
  active: { id: string; name: string; tip: string | null }
  publishedDraft: { id: string; name: string } | null
}

export function draftBranchOf(id: string): string {
  return id === MAIN_DRAFT_ID ? MAIN_BRANCH : `draft-${id}`
}

export function newDraftId(
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  let id = ""
  while (id.length < DRAFT_ID_LENGTH) {
    for (const byte of randomBytes(DRAFT_ID_LENGTH)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue
      id += DRAFT_ID_ALPHABET[byte % DRAFT_ID_ALPHABET.length]
      if (id.length === DRAFT_ID_LENGTH) break
    }
  }
  return id
}

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127
  })
}

/** Why `name` can't name a draft among `drafts`, or null. `exceptId` is the draft being renamed. */
export function draftNameProblem(name: string, drafts: DraftRecord[], exceptId?: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "Give the draft a name."
  if (trimmed.length > DRAFT_NAME_MAX_LENGTH) return `Keep the name to ${DRAFT_NAME_MAX_LENGTH} characters or fewer.`
  if (hasControlCharacter(trimmed)) return "The name can't contain line breaks or tabs."
  const lower = trimmed.toLowerCase()
  if (drafts.some((draft) => draft.id !== exceptId && draft.name.toLowerCase() === lower)) {
    return "Another draft already has that name."
  }
  return null
}

function recordOf(row: Record<string, SqlStorageValue>): DraftRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    branch: String(row.branch),
    startedFrom: row.started_from === "live" ? "live" : "main",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** Every draft, Main first and then oldest first. Main's row is created on first use. */
export function listDraftRecords(sql: SqlStorage, nowMs: number): DraftRecord[] {
  sql.exec(
    "INSERT OR IGNORE INTO drafts (id, name, branch, started_from, created_at, updated_at) VALUES (?, ?, ?, 'main', ?, ?)",
    MAIN_DRAFT_ID,
    MAIN_DRAFT_NAME,
    MAIN_BRANCH,
    nowMs,
    nowMs,
  )
  return sql
    .exec("SELECT * FROM drafts ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at, id", MAIN_DRAFT_ID)
    .toArray()
    .map(recordOf)
}

export function draftById(sql: SqlStorage, nowMs: number, id: string): DraftRecord | null {
  return listDraftRecords(sql, nowMs).find((draft) => draft.id === id) ?? null
}

export function draftByBranch(sql: SqlStorage, nowMs: number, branch: string): DraftRecord | null {
  return listDraftRecords(sql, nowMs).find((draft) => draft.branch === branch) ?? null
}

export function addDraft(
  sql: SqlStorage,
  nowMs: number,
  input: { name: string; startedFrom: DraftStart },
): { draft: DraftRecord } | { error: string } {
  const drafts = listDraftRecords(sql, nowMs)
  if (drafts.length >= DRAFT_LIMIT) return { error: "Delete a draft to start a new one." }
  const problem = draftNameProblem(input.name, drafts)
  if (problem) return { error: problem }
  let id = newDraftId()
  while (drafts.some((draft) => draft.id === id)) id = newDraftId()
  const draft: DraftRecord = {
    id,
    name: input.name.trim(),
    branch: draftBranchOf(id),
    startedFrom: input.startedFrom,
    createdAt: nowMs,
    updatedAt: nowMs,
  }
  sql.exec(
    "INSERT INTO drafts (id, name, branch, started_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    draft.id,
    draft.name,
    draft.branch,
    draft.startedFrom,
    draft.createdAt,
    draft.updatedAt,
  )
  return { draft }
}

export function renameDraftRecord(
  sql: SqlStorage,
  nowMs: number,
  id: string,
  name: string,
): { draft: DraftRecord } | { error: string } {
  if (id === MAIN_DRAFT_ID) return { error: "Main keeps its name." }
  const drafts = listDraftRecords(sql, nowMs)
  const draft = drafts.find((candidate) => candidate.id === id)
  if (!draft) return { error: "That draft doesn't exist." }
  const problem = draftNameProblem(name, drafts, id)
  if (problem) return { error: problem }
  sql.exec("UPDATE drafts SET name = ?, updated_at = ? WHERE id = ?", name.trim(), nowMs, id)
  return { draft: { ...draft, name: name.trim(), updatedAt: nowMs } }
}

export function removeDraftRecord(sql: SqlStorage, id: string): void {
  sql.exec("DELETE FROM drafts WHERE id = ? AND id != ?", id, MAIN_DRAFT_ID)
}

/** Records that the draft on `branch` changed, for the switcher's last-changed time. */
export function touchDraftBranch(sql: SqlStorage, branch: string, nowMs: number): void {
  sql.exec("UPDATE drafts SET updated_at = ? WHERE branch = ?", nowMs, branch)
}
