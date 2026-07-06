import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  email?: string
  organization?: string
  inquiryType?: string
  message?: string
  inquiryId?: string
}

const Email = ({ name, email, organization, inquiryType, message, inquiryId }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New partnership enquiry from {name || 'someone'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={badge}>New lead · Partnerships</Text>
        <Heading style={h1}>{name || 'A new enquiry'}</Heading>
        {organization && <Text style={sub}>{organization}</Text>}
        <Section style={grid}>
          <Row label="Email" value={email ? <Link href={`mailto:${email}`} style={link}>{email}</Link> : '—'} />
          <Row label="Type" value={inquiryType || '—'} />
          {inquiryId && <Row label="Ref" value={inquiryId} />}
        </Section>
        <Section style={messageBox}>
          <Text style={messageLabel}>Message</Text>
          <Text style={messageText}>{message || '(empty)'}</Text>
        </Section>
        <Text style={hint}>
          Reply from the admin dashboard at <strong>/admin/partnerships</strong> to send
          a response from your Princess Pink address.
        </Text>
      </Container>
    </Body>
  </Html>
)

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Section style={rowStyle}>
      <Text style={rowLabel}>{label}</Text>
      <Text style={rowValue}>{value}</Text>
    </Section>
  )
}

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `New partnership enquiry — ${data.name || 'unknown'}${data.organization ? ` (${data.organization})` : ''}`,
  displayName: 'Partnership — internal admin notification',
  to: 'danielle@princesspink90.com',
  previewData: {
    name: 'Jamie Rivera',
    email: 'jamie@somewhere.com',
    organization: 'Velvet Room MCR',
    inquiryType: 'venue',
    message: 'We run a private club in Manchester and would love to chat about a takeover night.',
    inquiryId: 'abc-123',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const badge = { fontSize: '11px', letterSpacing: '0.25em', textTransform: 'uppercase' as const, color: '#e91e63', margin: '0 0 8px' }
const h1 = { fontSize: '24px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 4px' }
const sub = { fontSize: '14px', color: '#666', margin: '0 0 18px' }
const grid = { margin: '0 0 18px' }
const rowStyle = { margin: '0 0 8px', paddingBottom: '8px', borderBottom: '1px solid #f0f0f0' }
const rowLabel = { fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#999', margin: '0 0 2px' }
const rowValue = { fontSize: '14px', color: '#0a0a0f', margin: 0 }
const link = { color: '#e91e63', textDecoration: 'underline' }
const messageBox = { border: '1px solid #ececef', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#fafafa', margin: '4px 0 20px' }
const messageLabel = { fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#e91e63', margin: '0 0 6px' }
const messageText = { fontSize: '14px', color: '#0a0a0f', margin: 0, whiteSpace: 'pre-wrap' as const, lineHeight: '1.6' }
const hint = { fontSize: '12px', color: '#888', margin: '18px 0 0' }
