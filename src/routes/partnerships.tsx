import { createFileRoute } from '@tanstack/react-router'
import { PartnershipForm } from '@/components/PartnershipForm'

export const Route = createFileRoute('/partnerships')({
  head: () => ({
    meta: [
      { title: 'Partner with Princess Pink — venues, sponsors, collabs' },
      {
        name: 'description',
        content:
          'Pitch a venue takeover, sponsorship, media feature, or collab with Princess Pink. Every enquiry is read personally.',
      },
      { property: 'og:title', content: 'Partner with Princess Pink' },
      { property: 'og:description', content: 'Venue takeovers, sponsors, media, collabs. Every enquiry read personally.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://princesspink90.lovable.app/partnerships' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Partner with Princess Pink' },
      { name: 'twitter:description', content: 'Venue takeovers, sponsors, media, collabs. Every enquiry read personally.' },
    ],
    links: [{ rel: 'canonical', href: 'https://princesspink90.lovable.app/partnerships' }],
  }),
  component: PartnershipsPage,
})

function PartnershipsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-neon">Partnerships</div>
      <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
        Work <span className="text-neon">with me</span>
      </h1>
      <p className="mt-5 text-muted-foreground leading-relaxed">
        Adult-friendly venue, sponsor, media outlet, or fellow creator? I read every
        partnership enquiry personally and reply from my Princess Pink address.
        Tell me who you are and what you're thinking.
      </p>
      <div className="mt-10 rounded-3xl border border-primary/30 bg-card/40 p-6 sm:p-8">
        <PartnershipForm />
      </div>
    </main>
  )
}
