/**
 * Authorization tests for /lovable/email/transactional/send.
 *
 * Verifies the fix for the "authenticated email relay" finding
 * (`email_relay_any_user`):
 *
 *   - Non-admin callers MUST be rejected with 403 when the requested
 *     template has no fixed `to` recipient (i.e., they'd be able to
 *     supply an arbitrary recipientEmail).
 *   - Admin callers are allowed through the authorization check for
 *     open-recipient templates.
 *   - Fixed-recipient templates (template.to set) bypass the admin
 *     check entirely — any authenticated user can trigger them.
 *   - Missing / malformed bearer tokens produce 401 without reaching
 *     the role check.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks --------------------------------------------------------------

// A configurable template registry we can rewrite per test.
vi.mock('@/lib/email-templates/registry', () => ({
  TEMPLATES: {} as Record<string, any>,
}))

// Render is only reached when authorization + suppression succeed.
// Keep it cheap so the "admin path" test doesn't blow up.
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html></html>'),
}))

// Supabase client factory — we return a hand-rolled fake driven by the
// hasRoleResult / userResult / suppressed knobs set per test.
type Knobs = {
  userResult: { data: { user: any }; error: any }
  hasRoleResult: { data: unknown; error: any }
  hasRoleCalled: number
  suppressed: boolean
}

const knobs: Knobs = {
  userResult: { data: { user: null }, error: null },
  hasRoleResult: { data: false, error: null },
  hasRoleCalled: 0,
  suppressed: false,
}

vi.mock('@supabase/supabase-js', () => {
  const fakeClient = {
    auth: {
      getUser: vi.fn(async () => knobs.userResult),
    },
    rpc: vi.fn(async (fn: string, _args: unknown) => {
      if (fn === 'has_role') {
        knobs.hasRoleCalled += 1
        return knobs.hasRoleResult
      }
      // enqueue_email — succeed silently
      return { data: null, error: null }
    }),
    from: vi.fn((table: string) => {
      if (table === 'suppressed_emails') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                knobs.suppressed
                  ? { data: { id: 'x' }, error: null }
                  : { data: null, error: null },
            }),
          }),
        }
      }
      if (table === 'email_unsubscribe_tokens') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { token: 'existing-token', used_at: null },
                error: null,
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
        }
      }
      if (table === 'email_send_log') {
        return { insert: async () => ({ error: null }) }
      }
      return { insert: async () => ({ error: null }) }
    }),
  }
  return { createClient: vi.fn(() => fakeClient) }
})

// Env must be set BEFORE the route module is imported (top-level reads).
vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')

// ---- Test helpers -------------------------------------------------------

async function loadHandler() {
  const mod = await import('./send')
  const handler = (mod.Route as any).options.server.handlers.POST as (
    ctx: { request: Request },
  ) => Promise<Response>
  expect(typeof handler).toBe('function')
  return handler
}

function makeRequest(body: unknown, opts: { auth?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const auth = opts.auth === undefined ? 'Bearer valid-token' : opts.auth
  if (auth) headers.Authorization = auth
  return new Request('http://localhost/lovable/email/transactional/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function setTemplates(templates: Record<string, any>) {
  const registry = await import('@/lib/email-templates/registry')
  // Reset and repopulate the mocked registry object.
  for (const k of Object.keys(registry.TEMPLATES)) delete registry.TEMPLATES[k]
  Object.assign(registry.TEMPLATES, templates)
}

const FIXED_TEMPLATE = {
  component: () => null,
  subject: 'fixed',
  to: 'owner@site.example',
}
const OPEN_TEMPLATE = {
  component: () => null,
  subject: 'open',
  // no `to` — caller supplies recipientEmail
}

// ---- Tests --------------------------------------------------------------

describe('POST /lovable/email/transactional/send — authorization', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    knobs.userResult = {
      data: { user: { id: 'user-123', email: 'u@example.com' } },
      error: null,
    }
    knobs.hasRoleResult = { data: false, error: null }
    knobs.hasRoleCalled = 0
    knobs.suppressed = false
    await setTemplates({ open: OPEN_TEMPLATE, fixed: FIXED_TEMPLATE })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()

  const auditCalls = (spy: ReturnType<typeof vi.spyOn>, event: string) =>
    (spy.mock.calls as unknown[][]).filter((call) => call[0] === `[audit] ${event}`)


  it('rejects requests without a bearer token (401) and does not check roles', async () => {
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest(
        { templateName: 'open', recipientEmail: 'victim@example.com' },
        { auth: null },
      ),
    })
    expect(res.status).toBe(401)
    expect(knobs.hasRoleCalled).toBe(0)
  })

  it('rejects invalid bearer tokens (401) and does not check roles', async () => {
    knobs.userResult = { data: { user: null }, error: { message: 'bad token' } }
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'open',
        recipientEmail: 'victim@example.com',
      }),
    })
    expect(res.status).toBe(401)
    expect(knobs.hasRoleCalled).toBe(0)
  })

  it('blocks non-admins from open-recipient templates with 403', async () => {
    knobs.hasRoleResult = { data: false, error: null }
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'open',
        recipientEmail: 'victim@example.com',
      }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(knobs.hasRoleCalled).toBe(1)
    // Audit trail: forbidden attempt is logged with actor + template + redacted recipient
    const forbidden = auditCalls(warnSpy, 'email_send.forbidden_non_admin_open_recipient')
    expect(forbidden.length).toBe(1)
    expect(forbidden[0][1]).toMatchObject({
      templateName: 'open',
      actorUserId: 'user-123',
      recipient_redacted: 'v***@example.com',
    })
    // Success-path audit line MUST NOT fire on denial
    expect(auditCalls(infoSpy, 'email_send.admin_recipient_override').length).toBe(0)
  })

  it('treats has_role RPC errors as denial (fail-closed → 403)', async () => {
    knobs.hasRoleResult = { data: null, error: { code: '42501', message: 'db down' } }
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'open',
        recipientEmail: 'victim@example.com',
      }),
    })
    expect(res.status).toBe(403)
    expect(knobs.hasRoleCalled).toBe(1)
    // Audit trail captures the RPC error code/message for debugging
    const forbidden = auditCalls(warnSpy, 'email_send.forbidden_non_admin_open_recipient')
    expect(forbidden.length).toBe(1)
    expect(forbidden[0][1]).toMatchObject({
      roleErrorCode: '42501',
      roleErrorMessage: 'db down',
    })
  })

  it('allows admins to specify arbitrary recipients for open templates', async () => {
    knobs.hasRoleResult = { data: true, error: null }
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'open',
        recipientEmail: 'someone@example.com',
        templateData: { name: 'Alice', message: 'hi' },
      }),
    })
    // Passes the authorization gate. Downstream flow (suppression / enqueue)
    // is mocked to succeed, so we should NOT see the 403 from this fix.
    expect(res.status).not.toBe(403)
    expect(knobs.hasRoleCalled).toBe(1)

    // Audit trail: exactly one override event, with actor + redacted recipient
    // + recipient domain + non-sensitive templateData key list.
    const overrides = auditCalls(infoSpy, 'email_send.admin_recipient_override')
    expect(overrides.length).toBe(1)
    const payload = overrides[0][1] as Record<string, unknown>
    expect(payload).toMatchObject({
      templateName: 'open',
      actorUserId: 'user-123',
      actorEmail_redacted: 'u***@example.com',
      recipient_redacted: 's***@example.com',
      recipientDomain: 'example.com',
      templateDataKeys: ['message', 'name'],
    })
    // Sanity: full email addresses MUST NOT appear in the audit payload
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('someone@example.com')
    expect(serialized).not.toContain('u@example.com')
    // messageId + idempotencyKey are present so the audit line can be
    // cross-referenced against email_send_log.
    expect(typeof payload.messageId).toBe('string')
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(typeof payload.at).toBe('string')

    // Denial-path audit line MUST NOT fire on success
    expect(auditCalls(warnSpy, 'email_send.forbidden_non_admin_open_recipient').length).toBe(0)
  })

  it('skips the admin check and emits no override audit for fixed-recipient templates', async () => {
    // Non-admin caller, but template has fixed `to` — must NOT invoke has_role,
    // must NOT return 403, and must NOT emit the admin_recipient_override
    // audit line (fixed recipients are not attacker-controlled).
    knobs.hasRoleResult = { data: false, error: null }
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'fixed',
        // Even if the caller supplies a rogue recipient, the fixed `to`
        // in the template takes precedence in the send route.
        recipientEmail: 'attacker-controlled@example.com',
      }),
    })
    expect(res.status).not.toBe(403)
    expect(knobs.hasRoleCalled).toBe(0)
    expect(auditCalls(infoSpy, 'email_send.admin_recipient_override').length).toBe(0)
    expect(auditCalls(warnSpy, 'email_send.forbidden_non_admin_open_recipient').length).toBe(0)
  })

  it('does not leak the admin check onto unknown templates (404 first)', async () => {
    const handler = await loadHandler()
    const res = await handler({
      request: makeRequest({
        templateName: 'does-not-exist',
        recipientEmail: 'x@example.com',
      }),
    })
    expect(res.status).toBe(404)
    expect(knobs.hasRoleCalled).toBe(0)
  })
})
