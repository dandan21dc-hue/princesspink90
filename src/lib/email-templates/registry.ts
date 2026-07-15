import type { ComponentType } from 'react'

import { template as partnershipConfirmation } from './partnership-confirmation'
import { template as partnershipNotification } from './partnership-notification'
import { template as partnershipReply } from './partnership-reply'
import { template as bookingConfirmation } from './booking-confirmation'
import { template as bookingCancelled } from './booking-cancelled'
import { template as bookingRescheduled } from './booking-rescheduled'
import { template as auditAlert } from './audit-alert'
import { template as allAccessRevoked } from './all-access-revoked'
import { template as adminRewardRedeemed } from './admin-reward-redeemed'
import { template as orderReceipt } from './order-receipt'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'partnership-confirmation': partnershipConfirmation,
  'partnership-notification': partnershipNotification,
  'partnership-reply': partnershipReply,
  'booking-confirmation': bookingConfirmation,
  'booking-cancelled': bookingCancelled,
  'booking-rescheduled': bookingRescheduled,
  'audit-alert': auditAlert,
  'all-access-revoked': allAccessRevoked,
  'admin-reward-redeemed': adminRewardRedeemed,
}
