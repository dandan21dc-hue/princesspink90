import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  body?: string
  originalMessage?: string
}

const Email = ({ name, body, originalMessage }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{body ? body.slice(0, 120) : 'A reply from Princess Pink'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Hi{name ? ` ${name}` : ''},</Heading>
        <Text style={text} className="whitespace-pre-wrap">{body}</Text>
        <Text style={sig}>— Princess Pink</Text>
        {originalMessage && (
          <>
            <hr style={hr} />
            <Text style={quoteLabel}>Your original message</Text>
            <Text style={quote}>{originalMessage}</Text>
          </>
        )}
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) => data.subject || 'A reply from Princess Pink',
  displayName: 'Partnership — admin reply',
  previewData: {
    name: 'Jamie',
    subject: 'Re: Venue takeover in Manchester',
    body: "Thanks for reaching out — I'd love to talk. Are you free next Thursday for a call?",
    originalMessage: 'We run a private club in Manchester...',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 14px' }
const text = { fontSize: '15px', color: '#222', lineHeight: '1.7', margin: '0 0 18px', whiteSpace: 'pre-wrap' as const }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 0', fontWeight: 600 as const }
const hr = { border: 'none', borderTop: '1px solid #ececef', margin: '28px 0 16px' }
const quoteLabel = { fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#999', margin: '0 0 6px' }
const quote = { fontSize: '13px', color: '#666', margin: 0, whiteSpace: 'pre-wrap' as const, lineHeight: '1.6', borderLeft: '3px solid #ececef', paddingLeft: '12px' }
