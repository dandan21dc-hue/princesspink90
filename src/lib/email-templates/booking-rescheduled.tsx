import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  oldDateLabel: string
  oldTimeLabel: string
  dateLabel: string
  timeLabel: string
  durationLabel: string
  partySize: number
  amount?: string
  bookingId: string
  icsUrl: string
  dashboardUrl: string
  bookingUrl: string
  rescheduleUrl: string
  cancelUrl: string
  reason?: string
  rescheduledByStaff?: boolean
}

const Email = ({
  name,
  oldDateLabel,
  oldTimeLabel,
  dateLabel,
  timeLabel,
  durationLabel,
  partySize,
  amount,
  bookingId,
  icsUrl,
  dashboardUrl,
  bookingUrl,
  rescheduleUrl,
  cancelUrl,
  reason,
  rescheduledByStaff,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Booking moved — now {dateLabel} · {timeLabel}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          Your booking has been rescheduled{name ? `, ${name}` : ''}.
        </Heading>
        <Text style={text}>
          {rescheduledByStaff
            ? "We've moved your private-room session to a new time. Please review the new details below and update your calendar."
            : "Your private-room session has been moved. Here are the new details — save them to your calendar."}
        </Text>

        <Section style={oldCard}>
          <Text style={cardLabel}>Previously</Text>
          <Text style={oldValue}>
            {oldDateLabel} · {oldTimeLabel}
          </Text>
        </Section>

        <Section style={card}>
          <Text style={cardLabel}>New booking time</Text>
          <Text style={cardTitle}>{durationLabel}</Text>

          <Row label="Date" value={dateLabel} />
          <Row label="Time" value={timeLabel} />
          <Row
            label="Party size"
            value={`${partySize} ${partySize === 1 ? 'guest' : 'guests'}`}
          />
          {amount && <Row label="Amount paid" value={amount} />}
          <Row label="Booking ID" value={bookingId} />
        </Section>

        {reason && (
          <Section style={card}>
            <Text style={cardLabel}>Note from the host</Text>
            <Text style={cardValue}>{reason}</Text>
          </Section>
        )}

        <Section style={{ textAlign: 'center' as const, margin: '24px 0 8px' }}>
          <Button href={bookingUrl} style={button}>
            View this booking
          </Button>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '8px 0' }}>
          <Button href={icsUrl} style={secondaryButton}>
            Add new time to calendar
          </Button>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '8px 0' }}>
          <Button href={dashboardUrl} style={secondaryButton}>
            All my bookings
          </Button>
        </Section>

        <Section style={{ textAlign: 'center' as const, margin: '16px 0 4px' }}>
          <Text style={manageLabel}>Need to change again?</Text>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '4px 0' }}>
          <Button href={rescheduleUrl} style={secondaryButton}>
            Reschedule
          </Button>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '8px 0 16px' }}>
          <Button href={cancelUrl} style={dangerButton}>
            Cancel booking
          </Button>
        </Section>

        <Text style={fineprint}>
          Please remove the previous time from your calendar. Cancellations
          must be made at least 2 hours before your new session.
        </Text>

        <Text style={sig}>— Midnight Glory</Text>
        <Text style={footer}>
          Midnight Glory · Adults only · 18+ · Consent, safety and discretion are non-negotiable.
        </Text>
      </Container>
    </Body>
  </Html>
)

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Section style={row}>
      <Text style={rowLabel}>{label}</Text>
      <Text style={rowValue}>{value}</Text>
    </Section>
  )
}

export const template = {
  component: Email,
  subject: 'Your Midnight Glory private-room booking has been rescheduled',
  displayName: 'Private room — booking rescheduled',
  previewData: {
    name: 'Jamie',
    oldDateLabel: 'Friday, 12 July 2026',
    oldTimeLabel: '7:00 PM – 8:00 PM',
    dateLabel: 'Saturday, 13 July 2026',
    timeLabel: '8:00 PM – 9:00 PM',
    durationLabel: '1-hour session',
    partySize: 2,
    amount: 'A$250.00',
    bookingId: '4f2c3a80-1a2b-4c5d-9e0f-abcdef012345',
    icsUrl: 'https://princesspink90.com/api/public/bookings/4f2c3a80-1a2b-4c5d-9e0f-abcdef012345/ics',
    dashboardUrl: 'https://princesspink90.com/bookings',
    bookingUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80&action=view',
    rescheduleUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80&action=reschedule',
    cancelUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80&action=cancel',
    reason: 'Room maintenance — apologies for the shuffle.',
    rescheduledByStaff: true,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 18px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 18px' }
const card = {
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '16px 18px',
  margin: '0 0 14px',
  backgroundColor: '#fafafa',
}
const oldCard = {
  border: '1px dashed #d4d4d8',
  borderRadius: '10px',
  padding: '12px 18px',
  margin: '0 0 14px',
  backgroundColor: '#ffffff',
}
const oldValue = {
  fontSize: '14px',
  color: '#71717a',
  margin: 0,
  textDecoration: 'line-through',
}
const cardLabel = {
  fontSize: '11px',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: '#e91e63',
  margin: '0 0 6px',
}
const cardTitle = {
  fontSize: '18px',
  fontWeight: 700 as const,
  color: '#0a0a0f',
  margin: '0 0 12px',
}
const cardValue = { fontSize: '14px', color: '#0a0a0f', margin: 0, whiteSpace: 'pre-wrap' as const }
const row = {
  display: 'block',
  padding: '6px 0',
  borderTop: '1px solid #ececef',
}
const rowLabel = { fontSize: '12px', color: '#777', margin: '0 0 2px', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }
const rowValue = { fontSize: '14px', color: '#0a0a0f', margin: 0, fontWeight: 500 as const }
const button = {
  backgroundColor: '#e91e63',
  color: '#ffffff',
  padding: '12px 22px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 700 as const,
  textDecoration: 'none',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
}
const secondaryButton = {
  backgroundColor: '#ffffff',
  color: '#e91e63',
  border: '1px solid #e91e63',
  padding: '12px 22px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 700 as const,
  textDecoration: 'none',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
}
const fineprint = { fontSize: '12px', color: '#666', textAlign: 'center' as const, margin: '0 0 18px' }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 8px', fontWeight: 600 as const }
const footer = { fontSize: '11px', color: '#999', margin: '32px 0 0', lineHeight: '1.5' }
const manageLabel = {
  fontSize: '11px',
  color: '#777',
  margin: '0',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.18em',
  textAlign: 'center' as const,
}
const dangerButton = {
  backgroundColor: '#ffffff',
  color: '#b91c1c',
  border: '1px solid #b91c1c',
  padding: '12px 22px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 700 as const,
  textDecoration: 'none',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
}
