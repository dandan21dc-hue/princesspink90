import { createFileRoute } from '@tanstack/react-router'
import { createHash } from 'crypto'
import { z } from 'zod'

const bodySchema = z.object({
  outcome: z.enum(['confirmed', 'declined', 'viewed']),
  path: z.string().max(2048).optional(),
  context: z.enum(['anonymous', 'authenticated']).optional(),
})

export const Route = createFileRoute('/api/public/age-gate-event')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          return new Response('Invalid JSON', { status: 400 })
        }
        const parsed = bodySchema.safeParse(payload)
        if (!parsed.success) {
          return new Response('Invalid payload', { status: 400 })
        }

        const ua = request.headers.get('user-agent')?.slice(0, 1024) ?? null
        const rawIp =
          request.headers.get('cf-connecting-ip') ??
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          request.headers.get('x-real-ip') ??
          ''
        const salt = process.env.SUPABASE_URL ?? 'age-gate-salt'
        const ipHash = rawIp
          ? createHash('sha256').update(`${salt}:${rawIp}`).digest('hex').slice(0, 64)
          : null

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const { error } = await supabaseAdmin.from('age_gate_events').insert({
          outcome: parsed.data.outcome,
          path: parsed.data.path ?? null,
          context: parsed.data.context ?? 'anonymous',
          user_agent: ua,
          ip_hash: ipHash,
        })
        if (error) {
          console.error('age_gate_events insert failed', error)
          return new Response('Log failed', { status: 500 })
        }

        return new Response(null, { status: 204 })
      },
    },
  },
})
