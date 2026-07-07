// @ts-expect-error React import kept for JSX runtime
import * as React from 'react';
void React;
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
  bookingId: string
  dashboardUrl: string
}

const Email = ({
  name,
  dateLabel,
  timeLabel,
  durationLabel,
  partySize,
  amount,
  bookingId,
  dashboardUrl,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your booking is cancelled — {dateLabel} · {timeLabel}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your booking is cancelled{name ? `, ${name}` : ''}.</Heading>
        <Text style={text}>
          This is a confirmation that your private-room booking has been cancelled.
          The details of the cancelled session are below for your reference.
        </Text>

        <Section style={card}>
          <Text style={cardLabel}>Cancelled booking</Text>
          <Text style={cardTitle}>{durationLabel}</Text>

          <Row label="Date" value={dateLabel} />
          <Row label="Time" value={timeLabel} />
          <Row
            label="Party size"
            value={`${partySize} ${partySize === 1 ? 'guest' : 'guests'}`}
          />
          {amount && <Row label="Amount" value={amount} />}
          <Row label="Booking ID" value={bookingId} />
        </Section>

        <Section style={{ textAlign: 'center' as const, margin: '24px 0 8px' }}>
          <Button href={dashboardUrl} style={button}>
            Go to dashboard
          </Button>
        </Section>
        <Text style={fineprint}>
          If this cancellation wasn't you, or you'd like to rebook, head to your
          dashboard to make a new reservation.
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
  subject: 'Your Princess Pink private-room booking is cancelled',
  displayName: 'Private room — booking cancelled',
  previewData: {
    name: 'Jamie',
    dateLabel: 'Friday, 12 July 2026',
    timeLabel: '7:00 PM – 8:00 PM',
    durationLabel: '1-hour session',
    partySize: 2,
    amount: 'A$250.00',
    bookingId: '4f2c3a80-1a2b-4c5d-9e0f-abcdef012345',
    dashboardUrl: 'https://princesspink90.com/bookings',
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
const fineprint = { fontSize: '12px', color: '#666', textAlign: 'center' as const, margin: '0 0 18px' }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 8px', fontWeight: 600 as const }
const footer = { fontSize: '11px', color: '#999', margin: '32px 0 0', lineHeight: '1.5' }
