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
  mode: 'revoked' | 'suspended'
  reasonLabel: string
  membershipLabel: string
  effectiveDateLabel: string
  supportUrl: string
  dashboardUrl: string
}

const Email = ({
  name,
  mode,
  reasonLabel,
  membershipLabel,
  effectiveDateLabel,
  supportUrl,
  dashboardUrl,
}: Props) => {
  const revoked = mode === 'revoked'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {revoked
          ? `Your All-Access Pass has been revoked (${reasonLabel})`
          : `Your All-Access Pass has been suspended (${reasonLabel})`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {revoked
              ? `Your All-Access Pass has been revoked${name ? `, ${name}` : ''}.`
              : `Your All-Access Pass has been suspended${name ? `, ${name}` : ''}.`}
          </Heading>

          <Text style={text}>
            {revoked
              ? `We've received a refund/reversal on the payment for your ${membershipLabel} and, as a result, the associated All-Access entitlement has been revoked. You will no longer be able to use benefits attached to this pass.`
              : `A payment dispute (chargeback) was raised against your ${membershipLabel}. While your payment provider reviews it, your All-Access entitlement is temporarily suspended. If the dispute is resolved in your favour we'll restore access; if not, access will be permanently revoked.`}
          </Text>

          <Section style={card}>
            <Text style={cardLabel}>Access change</Text>
            <Text style={cardTitle}>{revoked ? 'Revoked' : 'Suspended'}</Text>
            <Row label="Pass" value={membershipLabel} />
            <Row label="Reason" value={reasonLabel} />
            <Row label="Effective" value={effectiveDateLabel} />
          </Section>

          <Section style={{ textAlign: 'center' as const, margin: '24px 0 8px' }}>
            <Button href={dashboardUrl} style={button}>
              View my account
            </Button>
          </Section>

          <Text style={fineprint}>
            Think this is a mistake, or want to talk it through? Reply to this
            email or reach us at{' '}
            <a href={supportUrl} style={link}>
              support
            </a>
            .
          </Text>

          <Text style={sig}>— Midnight Glory</Text>
          <Text style={footer}>
            Midnight Glory · Adults only · 18+ · Consent, safety and discretion are non-negotiable.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

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
    data?.mode === 'suspended'
      ? 'Your All-Access Pass has been suspended'
      : 'Your All-Access Pass has been revoked',
  displayName: 'All-Access Pass — revoked or suspended',
  previewData: {
    name: 'Jamie',
    mode: 'revoked',
    reasonLabel: 'Payment refunded',
    membershipLabel: '30-day All-Access Pass',
    effectiveDateLabel: '15 July 2026',
    supportUrl: 'mailto:midnight-glory@princesspink90.com',
    dashboardUrl: 'https://princesspink90.com/account',
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
}
const fineprint = { fontSize: '12px', color: '#666', textAlign: 'center' as const, margin: '0 0 18px' }
const link = { color: '#e91e63', textDecoration: 'underline' }
const sig = { fontSize: '15px', color: '#0a0a0f', margin: '20px 0 8px', fontWeight: 600 as const }
const footer = { fontSize: '11px', color: '#999', margin: '32px 0 0', lineHeight: '1.5' }
