import { createFileRoute } from '@tanstack/react-router'
import { buildIcs } from '@/lib/ics'

/**
 * Public .ics download for a private-room booking. The booking id is a
 * random UUID, so the URL is unguessable enough to serve as a bearer for
 * the recipient's own calendar file. No PII is returned beyond what the
 * user already sees in their confirmation email / dashboard.
 *
 * Uses the service-role client since the recipient opening this from an
 * email won't have an app session.
 */
export const Route = createFileRoute('/api/public/bookings/$id/ics')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = params.id
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return new Response('Not found', { status: 404 })
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const { data: booking, error } = await supabaseAdmin
          .from('private_room_bookings')
          .select('id,starts_at,duration_minutes,party_size,notes,status')
          .eq('id', id)
          .maybeSingle()

        if (error || !booking) {
          return new Response('Not found', { status: 404 })
        }
        // Only issue calendar files for real, still-live bookings.
        if (booking.status === 'cancelled' || booking.status === 'refunded') {
          return new Response('Booking is no longer active', { status: 410 })
        }

        const starts = new Date(booking.starts_at as string)
        const ends = new Date(starts.getTime() + (booking.duration_minutes as number) * 60_000)

        const ics = buildIcs({
          uid: `booking-${booking.id}@princesspink90`,
          title: `Midnight Glory · Private room (${booking.duration_minutes} min)`,
          description: [
            `Party size: ${booking.party_size ?? 1}`,
            booking.notes ? `Notes: ${booking.notes}` : null,
            `Booking ID: ${booking.id}`,
          ]
            .filter(Boolean)
            .join('\n'),
          start: starts,
          end: ends,
          url: 'https://princesspink90.com/dashboard',
        })

        return new Response(ics, {
          status: 200,
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="midnight-glory-booking-${booking.id.slice(0, 8)}.ics"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
