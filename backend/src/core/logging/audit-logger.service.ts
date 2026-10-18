import { Injectable, Logger } from '@nestjs/common'
import { SupabaseService } from '../database/supabase.service'
import { Optional } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditDeliveryService } from './audit-delivery.service'
import { withDeadline } from '../security/deadline'

export interface AuditLogEntry {
  eventType: string
  userId: string
  userRole: string
  action: string
  resourceType: string
  resourceId?: string
  status: 'success' | 'failure'
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

export const AuditEvents = {
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  CAMPUS_CREATED: 'campus_created',
  CAMPUS_UPDATED: 'campus_updated',
  CAMPUS_DELETED: 'campus_deleted',
  DEPARTMENT_CREATED: 'department_created',
  DEPARTMENT_UPDATED: 'department_updated',
  DEPARTMENT_DELETED: 'department_deleted',
  FACULTY_CREATED: 'faculty_created',
  FACULTY_UPDATED: 'faculty_updated',
  FACULTY_DELETED: 'faculty_deleted',
  STUDENT_CREATED: 'student_created',
  STUDENT_BULK_CREATED: 'student_bulk_created',
  STUDENT_PROMOTED: 'student_promoted',
  COURSE_CREATED: 'course_created',
  COURSE_UPDATED: 'course_updated',
  COURSE_DELETED: 'course_deleted',
  BLUEPRINT_SAVED: 'blueprint_saved',
  REGISTRATION_SUBMITTED: 'registration_submitted',
  TIMETABLE_GENERATED: 'timetable_generated',
  TIMETABLE_PUBLISHED: 'timetable_published',
  ALLOCATION_RUN_COMPLETED: 'allocation_run_completed',
  MANUAL_ALLOCATION: 'manual_allocation',
} as const

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name)

  constructor(private readonly supabase: SupabaseService, @Optional() private readonly delivery?: AuditDeliveryService) {}

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  private sanitizeIpAddress(rawIp?: string): { sanitizedIp: string | null; rawAttempted?: string } {
    if (!rawIp || typeof rawIp !== 'string') {
      return { sanitizedIp: null }
    }
    const trimmed = rawIp.trim()
    if (!trimmed) return { sanitizedIp: null }

    // If forwarded header has comma-separated list e.g. "1.2.3.4, 10.0.0.1", take the first
    let candidate = trimmed.split(',')[0].trim()

    // Strip IPv6-mapped IPv4 prefix (e.g., "::ffff:127.0.0.1" -> "127.0.0.1")
    if (candidate.startsWith('::ffff:')) {
      candidate = candidate.replace(/^::ffff:/, '')
    }

    // Check standard IPv4 regex (each octet 0-255)
    const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/
    if (ipv4Regex.test(candidate)) {
      return { sanitizedIp: candidate }
    }

    // Check standard IPv6 or loopback
    if (candidate === '::1' || candidate.includes(':')) {
      return { sanitizedIp: candidate }
    }

    // Invalid INET format (e.g. "localhost", "unknown", socket path)
    return { sanitizedIp: null, rawAttempted: trimmed }
  }

  async log(entry: AuditLogEntry, options?: { signal: AbortSignal }): Promise<void> {
    try {
      const isValidUuid = entry.userId && AuditLoggerService.UUID_REGEX.test(entry.userId)
      const validUserId = isValidUuid ? entry.userId : null

      const isValidResourceId = entry.resourceId && AuditLoggerService.UUID_REGEX.test(entry.resourceId)
      const validResourceId = isValidResourceId ? entry.resourceId : null

      const { sanitizedIp, rawAttempted: attemptedIp } = this.sanitizeIpAddress(entry.ipAddress)

      const enrichedMetadata = {
        ...entry.metadata,
        ...(isValidUuid ? {} : { attempted_identifier: entry.userId }),
        ...(entry.resourceId && !isValidResourceId ? { resource_identifier: entry.resourceId } : {}),
        ...(attemptedIp ? { raw_ip_address: attemptedIp } : {}),
      }

      const logPayload = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        log_type: 'audit_event',
        event_type: entry.eventType,
        user_id: validUserId,
        user_role: entry.userRole,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: validResourceId,
        status: entry.status,
        ip_address: sanitizedIp,
        user_agent: entry.userAgent ?? null,
        metadata: enrichedMetadata,
      }

      const isSessionEvent = [AuditEvents.USER_LOGIN, AuditEvents.USER_LOGOUT, 'login_failed'].includes(entry.eventType)
      if (options?.signal.aborted) return
      const queued = isSessionEvent && this.delivery ? this.delivery.enqueue(logPayload, options?.signal) : Promise.resolve(false)
      if (await (options ? withDeadline(queued, options.signal) : queued)) return

      // An ambiguous queue acknowledgement can produce a later redelivery.
      const query = isSessionEvent && this.delivery
        ? this.supabase.admin.from('system_logs').upsert(logPayload, { onConflict: 'id', ignoreDuplicates: true })
        : this.supabase.admin.from('system_logs').insert(logPayload)
      const { error } = await (options ? withDeadline(query.abortSignal(options.signal), options.signal) : query)

      if (error) this.logger.warn(`Failed to persist audit log in system_logs: ${error.message}`)
    } catch (err: any) {
      this.logger.warn(`Exception writing audit log: ${err.message}`)
    }
  }
}
