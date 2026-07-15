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
  severity?: string
  kind?: string
  count?: number
  detectedAt?: string
  detailJson?: string
  reviewUrl?: string
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#c0143c',
  warning: '#b26a00',
  info: '#3663a5',
}

const KIND_LABEL: Record<string, string> = {
  tampered_entries: 'Tampered audit entries',
  chain_break: 'Audit hash-chain break',
  missing_entries: 'Missing audit sequences',
}

const Email = ({ severity, kind, count, detectedAt, detailJson, reviewUrl }: Props) => {
  const sev = (severity ?? 'warning').toLowerCase()
  const sevLabel = SEVERITY_LABEL[sev] ?? severity ?? 'Alert'
  const sevColor = SEVERITY_COLOR[sev] ?? '#666'
  const kindLabel = KIND_LABEL[kind ?? ''] ?? kind ?? 'Audit anomaly'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {sevLabel} · {kindLabel}
        {count ? ` (${count})` : ''}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={{ ...badge, color: sevColor }}>
            {sevLabel} · Admin activity audit
          </Text>
          <Heading style={h1}>{kindLabel}</Heading>
          {typeof count === 'number' && count > 0 && (
            <Text style={sub}>
              {count} suspicious sequence{count === 1 ? '' : 's'} flagged.
            </Text>
          )}
          <Section style={grid}>
            <Row label="Severity" value={sevLabel} />
            <Row label="Kind" value={kind ?? '—'} />
            {detectedAt && <Row label="Detected at" value={detectedAt} />}
          </Section>
          {detailJson && (
            <Section style={detailBox}>
              <Text style={detailLabel}>Detail</Text>
              <Text style={detailText}>{detailJson}</Text>
            </Section>
          )}
          {reviewUrl && (
            <Text style={{ margin: '20px 0 0' }}>
              <Link href={reviewUrl} style={cta}>
                Review in admin activity audit
              </Link>
            </Text>
          )}
          <Text style={hint}>
            This alert was raised automatically by the admin activity audit integrity
            check. Acknowledge it from the admin dashboard once reviewed.
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
    const sev = SEVERITY_LABEL[(data.severity ?? '').toLowerCase()] ?? 'Alert'
    const kind = KIND_LABEL[data.kind ?? ''] ?? data.kind ?? 'audit anomaly'
    const count = typeof data.count === 'number' && data.count > 0 ? ` (${data.count})` : ''
    return `[${sev}] Admin audit — ${kind}${count}`
  },
  displayName: 'Admin — audit integrity alert',
  to: 'midnight-glory@princesspink90.com',
  previewData: {
    severity: 'critical',
    kind: 'tampered_entries',
    count: 2,
    detectedAt: new Date().toISOString(),
    detailJson: JSON.stringify({ seqs: [42, 57], count: 2 }, null, 2),
    reviewUrl: 'https://princesspink90.com/admin/activity-audit',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const badge = {
  fontSize: '11px',
  letterSpacing: '0.25em',
  textTransform: 'uppercase' as const,
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
const detailBox = {
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '14px 16px',
  backgroundColor: '#fafafa',
  margin: '4px 0 8px',
}
const detailLabel = {
  fontSize: '11px',
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  color: '#c0143c',
  margin: '0 0 6px',
}
const detailText = {
  fontSize: '12px',
  color: '#0a0a0f',
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: '1.5',
}
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
