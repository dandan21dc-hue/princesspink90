import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface LineItem {
  label: string
  value: string
}

interface Props {
  name?: string
  receiptTitle: string
  itemDescription: string
  amount: string
  purchasedAt: string
  referenceId: string
  lineItems?: LineItem[]
  dashboardUrl: string
}

const Email = ({
  name,
  receiptTitle,
  itemDescription,
  amount,
  purchasedAt,
  referenceId,
  lineItems = [],
  dashboardUrl,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Receipt for {itemDescription} — {amount}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Thank you{name ? `, ${name}` : ''} 💕</Heading>
        <Text style={text}>
          This is your receipt for {receiptTitle.toLowerCase()}. Keep it for your records —
          you'll also find it in your dashboard.
        </Text>

        <Section style={card}>
          <Text style={cardLabel}>{receiptTitle}</Text>
          <Text style={cardTitle}>{itemDescription}</Text>

          <Row label="Amount" value={amount} />
          <Row label="Date" value={purchasedAt} />
          <Row label="Reference" value={referenceId} />
          {lineItems.map((item) => (
            <Row key={item.label} label={item.label} value={item.value} />
          ))}
        </Section>

        <Section style={{ textAlign: 'center' as const, margin: '20px 0 8px' }}>
          <a href={dashboardUrl} style={button}>
            View in your dashboard
          </a>
        </Section>

        <Text style={fineprint}>
          All amounts are in AUD. If you didn't make this purchase, reply to this email
          and we'll investigate immediately.
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
  subject: (data: Record<string, any>) =>
    `Receipt: ${data.itemDescription ?? 'your purchase'} — ${data.amount ?? ''}`.trim(),
  displayName: 'Order / booking receipt',
  previewData: {
    name: 'Jamie',
    receiptTitle: 'Private room booking',
    itemDescription: '1-hour session · 2 guests',
    amount: 'A$250.00',
    purchasedAt: 'Friday, 12 July 2026 · 7:00 PM',
    referenceId: '4f2c3a80-1a2b-4c5d-9e0f-abcdef012345',
    lineItems: [{ label: 'Payment method', value: 'Card ending 4242' }],
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
const cardTitle = { fontSize: '18px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 12px' }
const row = { display: 'block', padding: '6px 0', borderTop: '1px solid #ececef' }
const rowLabel = {
  fontSize: '12px',
  color: '#777',
  margin: '0 0 2px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
}
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
  display: 'inline-block',
}
const fineprint = { fontSize: '12px', color: '#666', textAlign: 'center' as const, margin: '18px 0' }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 8px', fontWeight: 600 as const }
const footer = { fontSize: '11px', color: '#999', margin: '32px 0 0', lineHeight: '1.5' }
