import * as React from 'react'; void React;
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
  dateLabel: string
  timeLabel: string
  durationLabel: string
  partySize: number
  amount?: string
  notes?: string
  bookingId: string
  icsUrl: string
  dashboardUrl: string
  bookingUrl: string
  rescheduleUrl: string
  cancelUrl: string
}

const Email = ({
  name,
  dateLabel,
  timeLabel,
  durationLabel,
  partySize,
  amount,
  notes,
  bookingId,
  icsUrl,
  dashboardUrl,
  bookingUrl,
  rescheduleUrl,
  cancelUrl,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      You're booked in — {dateLabel} · {timeLabel}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You're booked in{name ? `, ${name}` : ''}. 🎉</Heading>
        <Text style={text}>
          Payment confirmed. Here are your private-room details — save them to your
          calendar and I'll see you there.
        </Text>

        <Section style={card}>
          <Text style={cardLabel}>Your private room booking</Text>
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

        {notes && (
          <Section style={card}>
            <Text style={cardLabel}>Your notes</Text>
            <Text style={cardValue}>{notes}</Text>
          </Section>
        )}

        <Section style={{ textAlign: 'center' as const, margin: '24px 0 8px' }}>
          <Button href={bookingUrl} style={button}>
            View this booking
          </Button>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '8px 0' }}>
          <Button href={icsUrl} style={secondaryButton}>
            Add to calendar (.ics)
          </Button>
        </Section>
        <Section style={{ textAlign: 'center' as const, margin: '8px 0' }}>
          <Button href={dashboardUrl} style={secondaryButton}>
            All my bookings
          </Button>
        </Section>

        <Section style={{ textAlign: 'center' as const, margin: '16px 0 4px' }}>
          <Text style={manageLabel}>Need to change plans?</Text>
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
          The calendar button downloads a file you can import into Apple Calendar,
          Google Calendar, Outlook or any iCal-compatible app. Cancellations
          must be made at least 2 hours before your session.
        </Text>

        <Text style={sig}>— Princess Pink</Text>
        <Text style={footer}>
          Princess Pink · Adults only · 18+ · Consent, safety and discretion are non-negotiable.
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
  subject: 'Your Princess Pink private-room booking is confirmed',
  displayName: 'Private room — booking confirmation',
  previewData: {
    name: 'Jamie',
    dateLabel: 'Friday, 12 July 2026',
    timeLabel: '7:00 PM – 8:00 PM',
    durationLabel: '1-hour session',
    partySize: 2,
    amount: 'A$250.00',
    notes: 'Anniversary — please dim the lights.',
    bookingId: '4f2c3a80-1a2b-4c5d-9e0f-abcdef012345',
    icsUrl: 'https://princesspink90.com/api/public/bookings/4f2c3a80-1a2b-4c5d-9e0f-abcdef012345.ics',
    dashboardUrl: 'https://princesspink90.com/bookings',
    bookingUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80-1a2b-4c5d-9e0f-abcdef012345&action=view',
    rescheduleUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80-1a2b-4c5d-9e0f-abcdef012345&action=reschedule',
    cancelUrl: 'https://princesspink90.com/bookings?booking=4f2c3a80-1a2b-4c5d-9e0f-abcdef012345&action=cancel',
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
