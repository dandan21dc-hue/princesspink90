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
  rewardName?: string
  pointsSpent?: number
  memberEmail?: string
  memberDisplayName?: string
  redeemedAt?: string
  fulfillUrl?: string
}

const Email = ({
  rewardName,
  pointsSpent,
  memberEmail,
  memberDisplayName,
  redeemedAt,
  fulfillUrl,
}: Props) => {
  const displayMember = memberDisplayName || memberEmail || 'A member'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {rewardName ? `${rewardName} redeemed` : 'Reward redeemed'} — awaiting fulfilment
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={badge}>Admin · Rewards</Text>
          <Heading style={h1}>New reward redemption</Heading>
          <Text style={sub}>
            {displayMember} redeemed a reward and it is waiting for fulfilment.
          </Text>
          <Section style={grid}>
            <Row label="Reward" value={rewardName ?? '—'} />
            <Row
              label="Points spent"
              value={typeof pointsSpent === 'number' ? pointsSpent.toLocaleString() : '—'}
            />
            <Row label="Member" value={memberDisplayName ?? '—'} />
            {memberEmail && <Row label="Email" value={memberEmail} />}
            {redeemedAt && <Row label="Redeemed at" value={redeemedAt} />}
          </Section>
          {fulfillUrl && (
            <Text style={{ margin: '20px 0 0' }}>
              <Link href={fulfillUrl} style={cta}>
                Open Rewards Manager
              </Link>
            </Text>
          )}
          <Text style={hint}>
            You are receiving this because admin reward alerts are enabled in
            site settings. Turn them off any time from the Rewards Manager.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

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
  subject: (data: Record<string, any>) => {
    const name = data.rewardName ? ` — ${data.rewardName}` : ''
    return `[Rewards] New redemption${name}`
  },
  displayName: 'Admin — reward redemption alert',
  previewData: {
    rewardName: 'Signed Polaroid',
    pointsSpent: 500,
    memberEmail: 'member@example.com',
    memberDisplayName: 'Jane Member',
    redeemedAt: new Date().toISOString(),
    fulfillUrl: 'https://princesspink90.lovable.app/admin/rewards',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const badge = {
  fontSize: '11px',
  letterSpacing: '0.25em',
  textTransform: 'uppercase' as const,
  color: '#c0143c',
  margin: '0 0 8px',
}
const h1 = { fontSize: '22px', fontWeight: 700 as const, color: '#0a0a0f', margin: '0 0 4px' }
const sub = { fontSize: '14px', color: '#666', margin: '0 0 18px' }
const grid = { margin: '0 0 18px' }
const rowStyle = { margin: '0 0 8px', paddingBottom: '8px', borderBottom: '1px solid #f0f0f0' }
const rowLabel = {
  fontSize: '11px',
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  color: '#999',
  margin: '0 0 2px',
}
const rowValue = { fontSize: '14px', color: '#0a0a0f', margin: 0 }
const cta = {
  display: 'inline-block',
  backgroundColor: '#0a0a0f',
  color: '#ffffff',
  padding: '10px 18px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 600 as const,
}
const hint = { fontSize: '12px', color: '#888', margin: '18px 0 0' }
