export type AppError = { code: string; message: string }

export type Result<T, E = AppError> = { success: true; data: T } | { success: false; error: E }

export function ok<T>(data: T): Result<T> {
  return { success: true, data }
}

export function err(code: string, message: string): Result<never> {
  return { success: false, error: { code, message } }
}
