const CHANNEL = 'fyimp:account-transition'
export const SESSION_TRANSITION_KEY = 'fyimp:session-transition'

/** Notifications contain no identity or credentials and are never authorization proof. */
export function installSessionBroadcast(changed: () => void) {
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)
  let lastTransition: unknown
  const receive = (nonce: unknown) => {
    if (typeof nonce !== 'string' || !nonce || nonce === lastTransition) return
    lastTransition = nonce; changed()
  }
  if (channel) channel.onmessage = event => receive(event.data)
  const storage = (event: StorageEvent) => { if (event.key === SESSION_TRANSITION_KEY) receive(event.newValue) }
  const send = () => {
    const nonce = crypto.randomUUID()
    channel?.postMessage(nonce)
    try { localStorage.setItem(SESSION_TRANSITION_KEY, nonce) } catch {}
  }
  window.addEventListener('storage', storage)
  window.addEventListener('fyimp:account-transition', send)
  return () => {
    channel?.close()
    window.removeEventListener('storage', storage)
    window.removeEventListener('fyimp:account-transition', send)
  }
}
