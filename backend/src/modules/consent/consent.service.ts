import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { AuthUser } from '../../core/auth/types';
import { CURRENT_POLICY_VERSION } from './consent.constants';

@Injectable()
export class ConsentService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService
  ) {}

  /**
   * Check whether the user has consented to the current active policy version.
   */
  async getStatus(userId: string) {
    const { data, error } = await this.supabase.admin
      .from('consent_records')
      .select('policy_version, accepted_at')
      .eq('user_id', userId)
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to retrieve consent status: ${error.message}`
      );
    }

    const hasAcceptedCurrent = data?.policy_version === CURRENT_POLICY_VERSION;

    return {
      accepted: hasAcceptedCurrent,
      currentVersion: CURRENT_POLICY_VERSION,
      userAcceptedVersion: data?.policy_version || null,
      acceptedAt: data?.accepted_at || null,
    };
  }

  /**
   * Append a new consent record for the user.
   * Strictly enforces that the accepted version matches CURRENT_POLICY_VERSION.
   */
  async acceptConsent(user: AuthUser, policyVersion: string, ip: string) {
    if (policyVersion !== CURRENT_POLICY_VERSION) {
      throw new BadRequestException(
        `Policy version mismatch. The current active version is "${CURRENT_POLICY_VERSION}", but received "${policyVersion}".`
      );
    }

    const acceptedAt = new Date().toISOString();

    const { error } = await this.supabase.admin.from('consent_records').insert({
      user_id: user.userId,
      policy_version: policyVersion,
      accepted_at: acceptedAt,
    });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to persist consent record: ${error.message}`
      );
    }

    // Fast-path cache in app_metadata
    await this.supabase.admin.auth.admin
      .updateUserById(user.userId, {
        app_metadata: {
          accepted_policy_version: policyVersion,
        },
      })
      .catch(() => {});

    await this.auditLogger.log({
      eventType: 'consent_accepted',
      userId: user.userId,
      userRole: user.role,
      action: 'accepted terms of use and privacy policy',
      resourceType: 'policy',
      resourceId: policyVersion,
      status: 'success',
      ipAddress: ip,
      metadata: {
        policy_version: policyVersion,
        accepted_at: acceptedAt,
      },
    });

    return {
      success: true,
      policy_version: policyVersion,
      accepted_at: acceptedAt,
    };
  }
}
