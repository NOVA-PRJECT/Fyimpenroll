import { ServiceUnavailableException } from '@nestjs/common'
import { SupabaseService } from '../database/supabase.service'
import { CURRENT_POLICY_VERSION } from '../../modules/consent/consent.constants'

/** Metadata comes from Supabase getUser/signIn, never a browser-provided claim. */
export async function currentConsentStatus(supabase: SupabaseService, userId: string, acceptedVersion?: string) {
  if (acceptedVersion === CURRENT_POLICY_VERSION) {
    return { accepted: true, currentVersion: CURRENT_POLICY_VERSION }
  }
  const { data, error } = await supabase.admin.from('consent_records')
    .select('policy_version').eq('user_id', userId).eq('policy_version', CURRENT_POLICY_VERSION).maybeSingle()
  if (error) throw new ServiceUnavailableException('Consent verification is temporarily unavailable. Please retry.')
  return { accepted: !!data, currentVersion: CURRENT_POLICY_VERSION }
}
