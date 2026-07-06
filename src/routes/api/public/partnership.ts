import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  organization: z.string().trim().max(200).optional().or(z.literal('')),
  inquiryType: z.enum(['venue', 'sponsor', 'collab', 'media', 'other']).optional(),
  message: z.string().trim().min(1).max(5000),
  website: z.string().max(0).optional(), // honeypot — must be empty
})

export const Route = createFileRoute('/api/public/partnership')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }

        const parsed = submissionSchema.safeParse(body)
        if (!parsed.success) {
          return Response.json(
            { error: 'Invalid submission', details: parsed.error.flatten() },
            { status: 400 },
          )
        }

        const { name, email, organization, inquiryType, message, website } = parsed.data

        // Honeypot — silently accept but do nothing
        if (website && website.length > 0) {
          return Response.json({ success: true })
        }

        const { createClient } = await import('@supabase/supabase-js')
        const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        })

        const { data: inserted, error: insertError } = await supabase
          .from('partnership_inquiries')
          .insert({
            name,
            email: email.toLowerCase(),
            organization: organization || null,
            inquiry_type: inquiryType || null,
            message,
          })
          .select('id')
          .single()

        if (insertError || !inserted) {
          console.error('partnership submit: insert failed', { error: insertError })
          return Response.json({ error: 'Failed to save enquiry' }, { status: 500 })
        }

        const { enqueueTemplateEmail } = await import('@/lib/email/enqueue.server')

        // Fire both emails in parallel; individual failures are logged but
        // don't block the response — the inquiry row is already saved.
        await Promise.allSettled([
          enqueueTemplateEmail({
            templateName: 'partnership-confirmation',
            recipientEmail: email,
            idempotencyKey: `partnership-confirmation-${inserted.id}`,
            templateData: { name, inquiryType, message },
          }),
          enqueueTemplateEmail({
            templateName: 'partnership-notification',
            idempotencyKey: `partnership-notification-${inserted.id}`,
            templateData: {
              name,
              email,
              organization: organization || undefined,
              inquiryType,
              message,
              inquiryId: inserted.id,
            },
          }),
        ])

        return Response.json({ success: true, id: inserted.id })
      },
    },
  },
})
