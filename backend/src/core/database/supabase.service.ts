import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000),
})

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name)
  private readonly supabaseUrl: string
  private readonly supabaseServiceRoleKey: string
  private readonly supabaseAnonKey: string
  private adminClientInstance: SupabaseClient

  constructor(private readonly configService: ConfigService) {
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL || ''
    this.supabaseServiceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    this.supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || process.env.SUPABASE_ANON_KEY || ''

    if (!this.supabaseUrl || !this.supabaseServiceRoleKey) {
      this.logger.error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')
    }

    this.adminClientInstance = createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
      global: {
        fetch: boundedFetch,
        headers: {
          Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  get admin(): SupabaseClient {
    return this.adminClientInstance
  }

  createAuthClient(signal?: AbortSignal): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: { fetch: signal ? (input, init) => boundedFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) : boundedFetch },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  createLogoutClient(signal: AbortSignal): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
      global: { fetch: (input, init) => boundedFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) },
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }

  getClientForToken(token: string): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
        fetch: boundedFetch,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
}
