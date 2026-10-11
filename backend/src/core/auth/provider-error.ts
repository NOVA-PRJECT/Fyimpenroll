import { ServiceUnavailableException } from '@nestjs/common'

/** Authentication outages must never be mistaken for revoked credentials. */
export function assertAuthProviderAvailable(error: unknown): void {
  if (!error) return
  const failure = error as { status?: number; name?: string }
  if (!failure.status || failure.status === 429 || failure.status >= 500 ||
      failure.name === 'AuthRetryableFetchError') {
    throw new ServiceUnavailableException('Authentication service is temporarily unavailable. Please retry.')
  }
}

export async function authProviderCall<T>(operation: Promise<T>): Promise<T> {
  try { return await operation } catch (error) {
    assertAuthProviderAvailable(error)
    throw error
  }
}
