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

interface Props {
  name?: string
  inquiryType?: string
  message?: string
}

const typeLabel: Record<string, string> = {
  venue: 'Venue partnership',
  sponsor: 'Sponsorship',
  collab: 'Collaboration',
  media: 'Media / press',
  other: 'General enquiry',
}

const Email = ({ name, inquiryType, message }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Thanks for reaching out to Midnight Glory — I've got your message.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Thanks{name ? `, ${name}` : ''} — I've got your message.</Heading>
        <Text style={text}>
          I read every partnership enquiry personally. If it's a fit, I'll be in touch
          from this address within a few days.
        </Text>
        {inquiryType && (
          <Section style={card}>
            <Text style={cardLabel}>Enquiry type</Text>
            <Text style={cardValue}>{typeLabel[inquiryType] ?? inquiryType}</Text>
          </Section>
        )}
        {message && (
          <Section style={card}>
            <Text style={cardLabel}>Your message</Text>
            <Text style={cardValue}>{message}</Text>
          </Section>
        )}
        <Text style={text}>
          In the meantime, everything I do is on <strong>princesspink90.com</strong> —
          have a look around.
        </Text>
        <Text style={sig}>— Midnight Glory</Text>
        <Text style={footer}>
          Midnight Glory · Adults only · 18+ · Consent, safety and discretion are non-negotiable.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Thanks — your partnership enquiry with Midnight Glory',
  displayName: 'Partnership — confirmation to sender',
  previewData: {
    name: 'Jamie',
    inquiryType: 'venue',
    message: 'We run a private club in Manchester and would love to chat about a takeover night.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 18px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 18px' }
const card = {
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '0 0 14px',
  backgroundColor: '#fafafa',
}
const cardLabel = { fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#e91e63', margin: '0 0 6px' }
const cardValue = { fontSize: '14px', color: '#0a0a0f', margin: 0, whiteSpace: 'pre-wrap' as const }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 8px', fontWeight: 600 as const }
const footer = { fontSize: '11px', color: '#999', margin: '32px 0 0', lineHeight: '1.5' }
