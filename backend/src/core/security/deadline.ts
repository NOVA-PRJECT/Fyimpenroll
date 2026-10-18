/** Bounds even a provider/adapter that fails to honour its AbortSignal. */
export function withDeadline<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Deadline exceeded'))
    if (signal.aborted) { Promise.resolve(work).catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
