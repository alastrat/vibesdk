import type { FileSystem } from "@cloudflare/shell"

/** An error with the errno-style `code` isomorphic-git dispatches on. */
export interface CodedError extends Error {
  code: string
}

const LEADING_ERROR_CODE = /^(E[A-Z]+):/

export function hasErrorCode(error: unknown): error is CodedError {
  return error instanceof Error && "code" in error && typeof error.code === "string"
}

/** The code leading a message such as "ENOENT: no such file or directory", if any. */
export function errorCodeFromMessage(message: string): string | undefined {
  return LEADING_ERROR_CODE.exec(message)?.[1]
}

function withCode(error: unknown): unknown {
  if (!(error instanceof Error) || hasErrorCode(error)) return error
  const code = errorCodeFromMessage(error.message)
  if (code) Object.assign(error, { code })
  return error
}

/**
 * `@cloudflare/shell` filesystems throw `Error("ENOENT: …")` without a `code`,
 * but isomorphic-git dispatches on `code` (1.42+ only creates missing parent
 * directories for ENOENT). Git built on a shell filesystem goes through this
 * view, which runs every method on the original instance and codes uncoded
 * errors from their message before rethrowing them.
 */
export function withErrorCodes<T extends FileSystem>(fs: T): T {
  return new Proxy(fs, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property)
      if (typeof value !== "function") return value
      return (...args: unknown[]): unknown => {
        let result: unknown
        try {
          result = Reflect.apply(value, target, args)
        } catch (error) {
          throw withCode(error)
        }
        if (!(result instanceof Promise)) return result
        return result.catch((error: unknown) => {
          throw withCode(error)
        })
      }
    },
  })
}
