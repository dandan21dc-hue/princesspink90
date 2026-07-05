/**
 * Type-safe helper for mocking `sendResendEmail` in tests.
 *
 * Prevents TS2493 ("Tuple type '[]' of length '0' has no element at index '0'")
 * regressions caused by `vi.fn()` without an explicit signature — its
 * `mock.calls` become `[][]`, so `calls[i][0]` fails to typecheck and gets
 * "fixed" with `as unknown as [{ ... }]` casts that silently break when the
 * real signature changes.
 *
 * Usage:
 *   const email = mockSendResendEmail()
 *   vi.mock('@/lib/resend.server', () => ({
 *     sendResendEmail: email.sendResendEmail,
 *   }))
 *   // ...
 *   expect(email.recipients()).toContain('user@example.com')
 *   expect(email.keys()).toContain('expiry_7_day:xyz')
 */
import { vi, type Mock } from 'vitest'
import type { ResendResult, SendEmailArgs } from '@/lib/resend.server'

export type SendResendEmailMock = Mock<
  (args: SendEmailArgs) => Promise<ResendResult>
>

export interface MockSendResendEmail {
  /** The vi mock function — pass this into `vi.mock('@/lib/resend.server')`. */
  sendResendEmail: SendResendEmailMock
  /** Typed call-args list; each entry is a full `SendEmailArgs`. */
  calls: () => SendEmailArgs[]
  /** Flattened `to` recipients (arrays are expanded). */
  recipients: () => string[]
  /** Idempotency keys observed (undefined values dropped). */
  keys: () => string[]
  /** Clear recorded calls and re-apply the default implementation. */
  reset: () => void
}

export function mockSendResendEmail(
  impl: (args: SendEmailArgs) => Promise<ResendResult> = async () => ({
    ok: true,
    status: 200,
  }),
): MockSendResendEmail {
  const sendResendEmail = vi.fn(impl) as SendResendEmailMock
  const calls = () => sendResendEmail.mock.calls.map(([args]) => args)
  const recipients = () =>
    calls().flatMap(({ to }) => (Array.isArray(to) ? to : [to]))
  const keys = () =>
    calls()
      .map((c) => c.idempotencyKey)
      .filter((k): k is string => typeof k === 'string')
  const reset = () => {
    sendResendEmail.mockReset()
    sendResendEmail.mockImplementation(impl)
  }
  return { sendResendEmail, calls, recipients, keys, reset }
}
