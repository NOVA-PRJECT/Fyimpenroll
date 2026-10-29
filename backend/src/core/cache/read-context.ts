import { AsyncLocalStorage } from 'node:async_hooks'
export interface ReadContext {
  force: boolean
  scope: string
  cacheReferences?: boolean
  verifiedCampusSettings?: Record<string, unknown>
  pending: Map<string, Promise<unknown>>
}
export const readContext = new AsyncLocalStorage<ReadContext>()
export function requestOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const context = readContext.getStore()
  if (!context) return load()
  const pending = context.pending.get(key)
  if (pending) return pending as Promise<T>
  const result = load()
  context.pending.set(key, result)
  return result
}
