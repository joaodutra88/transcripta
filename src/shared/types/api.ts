export type IpcResponse<T> = { success: true; data: T } | { success: false; error: string }
