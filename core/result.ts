// Errors are values. A command that fails returns a Problem and changes nothing.

export interface Problem {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Problem };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: string, message: string, details?: Record<string, unknown>): Result<T> {
  return { ok: false, error: details ? { code, message, details } : { code, message } };
}
