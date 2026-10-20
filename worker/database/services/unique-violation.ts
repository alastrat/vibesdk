/** True when a D1 write failed on a unique key. Drizzle wraps D1's error, so the constraint is named in a cause. */
export function isUniqueViolation(error: unknown): boolean {
    for (let current: unknown = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth++) {
        if (current.message.includes('UNIQUE constraint failed')) return true;
    }
    return false;
}
