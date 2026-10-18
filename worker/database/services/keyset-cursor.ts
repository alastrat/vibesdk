/** A page of a newest-first list ends at its last row's creation second and id, so rows created in the same second are neither skipped nor repeated. */

const CURSOR = /^(\d{1,12}):([A-Za-z0-9_-]{1,64})$/;

export function parseKeysetCursor(cursor: string): { createdAt: Date; id: string } | null {
    const match = CURSOR.exec(cursor);
    return match ? { createdAt: new Date(Number(match[1]) * 1000), id: match[2] } : null;
}

export function keysetCursorOf(createdAt: Date, id: string): string {
    return `${Math.floor(createdAt.getTime() / 1000)}:${id}`;
}
