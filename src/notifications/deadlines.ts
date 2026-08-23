import * as Notifications from 'expo-notifications'
import type { ScannedDocument, DeadlineInfo, DocumentType, DeadlineType } from '../types'

// Statutory response windows in days, per US law (conservative estimates).
// All counts from the date the document was received (doc.createdAt).
const STATUTORY_DEADLINES: Record<
  DocumentType,
  Array<{ type: DeadlineType; label: string; days: number }>
> = {
  INSURANCE_DENIAL: [
    { type: 'APPEAL', label: 'Internal Appeal Deadline (ACA §2719)', days: 180 },
    { type: 'RESPONSE', label: 'External Review Request', days: 60 },
  ],
  EVICTION_NOTICE: [
    { type: 'RESPONSE', label: 'Written Response to Landlord', days: 3 },
    { type: 'CURE_PERIOD', label: 'Seek Legal Aid Immediately', days: 1 },
  ],
  MEDICAL_BILL: [
    { type: 'APPEAL', label: 'Billing Dispute Window', days: 180 },
    { type: 'RESPONSE', label: 'Charity Care / Financial Assistance Application', days: 90 },
  ],
  LEGAL_NOTICE: [
    { type: 'RESPONSE', label: 'Written Response Required', days: 30 },
  ],
  WELFARE_FORM: [
    { type: 'APPEAL', label: 'Benefits Denial Appeal Deadline', days: 90 },
    { type: 'RESPONSE', label: 'Fair Hearing Request', days: 45 },
  ],
  HOUSING_NOTICE: [
    { type: 'RESPONSE', label: 'Written Response to Landlord', days: 14 },
    { type: 'APPEAL', label: 'Rent Increase Contest Deadline', days: 30 },
  ],
  UTILITY_BILL: [
    { type: 'PAYMENT', label: 'Payment Plan Request Window', days: 30 },
  ],
  GENERAL: [],
}

// ─── Deadline Calculation ─────────────────────────────────────────────────────

export function calculateDeadlines(doc: ScannedDocument): DeadlineInfo[] {
  const now = Date.now()
  const results: DeadlineInfo[] = []

  // 1. Deadline extracted from the document itself (highest precision)
  if (doc.metadata.dueDate) {
    const extracted = parseDocumentDate(doc.metadata.dueDate)
    if (extracted) {
      results.push({
        type: 'PAYMENT',
        label: 'Document Due Date',
        date: extracted.toISOString(),
        daysRemaining: daysFrom(now, extracted.getTime()),
        isStatutory: false,
      })
    }
  }

  // 2. Statutory deadlines for this document type
  for (const { type, label, days } of STATUTORY_DEADLINES[doc.type] ?? []) {
    const deadlineMs = doc.createdAt + days * 86_400_000
    const daysRemaining = daysFrom(now, deadlineMs)
    // Skip deadlines that passed more than 30 days ago — no longer actionable
    if (daysRemaining <= -30) continue
    results.push({
      type,
      label,
      date: new Date(deadlineMs).toISOString(),
      daysRemaining,
      isStatutory: true,
    })
  }

  return results.sort((a, b) => a.daysRemaining - b.daysRemaining)
}

// ─── Notification Scheduling ──────────────────────────────────────────────────

export async function scheduleDeadlineAlerts(
  docId: string,
  docTitle: string,
  deadlines: DeadlineInfo[]
): Promise<string[]> {
  const { granted } = await Notifications.requestPermissionsAsync()
  if (!granted) return []

  const notifIds: string[] = []
  const now = new Date()

  for (const deadline of deadlines) {
    if (deadline.daysRemaining <= 0) continue

    const deadlineDate = new Date(deadline.date)
    // Alert at 7 days, 3 days, and 1 day before — whichever are still in the future
    for (const daysBefore of [7, 3, 1]) {
      if (daysBefore >= deadline.daysRemaining) continue  // already past this threshold

      const triggerDate = new Date(deadlineDate)
      triggerDate.setDate(triggerDate.getDate() - daysBefore)
      triggerDate.setHours(9, 0, 0, 0)  // 9 AM local time

      if (triggerDate <= now) continue

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: daysBefore === 1
            ? `⏰ Deadline TOMORROW — Act Now`
            : `⏰ ${daysBefore} Days Until Deadline`,
          body: `${deadline.label} — ${docTitle}`,
          data: { documentId: docId, deadlineLabel: deadline.label },
          categoryIdentifier: 'deadline',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
      })
      notifIds.push(id)
    }

    // Day-of alert at 9 AM
    const dayOf = new Date(deadlineDate)
    dayOf.setHours(9, 0, 0, 0)
    if (dayOf > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `🚨 DEADLINE TODAY`,
          body: `${deadline.label} — ${docTitle}`,
          data: { documentId: docId, deadlineLabel: deadline.label },
          categoryIdentifier: 'deadline',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: dayOf },
      })
      notifIds.push(id)
    }
  }

  return notifIds
}

export async function cancelAlertsForDocument(notifIds: string[]): Promise<void> {
  await Promise.all(notifIds.map(id => Notifications.cancelScheduledNotificationAsync(id)))
}

// Call once in the root layout to configure notification display behavior.
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowList: true,
    }),
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysFrom(nowMs: number, targetMs: number): number {
  return Math.ceil((targetMs - nowMs) / 86_400_000)
}

function parseDocumentDate(dateStr: string): Date | null {
  try {
    // ISO or natural language dates
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d

    // MM/DD/YYYY
    const m = dateStr.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/)
    if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))

    return null
  } catch {
    return null
  }
}
