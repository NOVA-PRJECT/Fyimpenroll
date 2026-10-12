export interface QueuedAction {
  id: string; ownerId: string; type: 'CAMPUS_SIGN_IN' | 'PERIOD_MARKING'; endpoint: string
  payload: unknown; clientTimestamp: string; blockedReason?: string
}
export interface QueueStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }

/** A single serialized owner-scoped queue; disk writes complete before callers see success. */
export class OfflineActionQueue {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private storage: QueueStorage) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work)
    this.tail = result.catch(() => {})
    return result
  }
  private key(owner: string) { return `fyimp_queue_v2_${owner}` }
  private async read(owner: string): Promise<QueuedAction[]> {
    const raw = await this.storage.getItem(this.key(owner))
    if (!raw) return []
    const rows: QueuedAction[] = JSON.parse(raw)
    if (!Array.isArray(rows) || rows.some(row => row.ownerId !== owner)) throw new Error('Offline queue ownership is invalid')
    return rows
  }
  list(owner: string) { return this.serialize(() => this.read(owner)) }
  enqueue(action: QueuedAction) {
    return this.serialize(async () => {
      const rows = await this.read(action.ownerId)
      if (rows.length >= 50) throw new Error('Offline queue is full. Sync or review pending actions first.')
      rows.push(action)
      await this.storage.setItem(this.key(action.ownerId), JSON.stringify(rows))
      return rows
    })
  }
  clear(owner: string, type: QueuedAction['type']) {
    return this.serialize(async () => {
      const rows = (await this.read(owner)).filter(row => row.type !== type)
      await this.storage.setItem(this.key(owner), JSON.stringify(rows))
      return rows
    })
  }
  sync(owner: string, stillOwner: () => boolean, send: (action: QueuedAction) => Promise<void>) {
    return this.serialize(async () => {
      const rows = await this.read(owner)
      for (const action of [...rows]) {
        if (!stillOwner() || action.blockedReason) break
        try {
          await send(action)
          rows.splice(rows.findIndex(row => row.id === action.id), 1)
        } catch (error) {
          const failure = error as { statusCode?: number; message?: string }
          if ([400, 403, 404, 409, 422].includes(failure.statusCode || 0)) {
            action.blockedReason = failure.message || 'Review this action before retrying'
          }
          await this.storage.setItem(this.key(owner), JSON.stringify(rows))
          break
        }
        await this.storage.setItem(this.key(owner), JSON.stringify(rows))
      }
      return rows
    })
  }
}
