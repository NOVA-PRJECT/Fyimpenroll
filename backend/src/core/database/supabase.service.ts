import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

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

  createAuthClient(): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  getClientForToken(token: string): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
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
