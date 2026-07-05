import { describe, expect, it } from 'vitest'
import { maskEmail } from './mask-email'

// A raw address must never survive maskEmail — every test asserts that the
// full input string is NOT present in the output.
function assertNoRaw(raw: string, masked: string) {
  expect(masked).not.toContain(raw)
}

describe('maskEmail — standard shapes', () => {
  const cases: Array<[string, string]> = [
    ['alice@example.com', 'a***@example.com'],
    ['bob@example.co.uk', 'b***@example.co.uk'],
    ['a@example.com', 'a***@example.com'],
    ['Alice.Smith@example.com', 'A***@example.com'],
    ['first.last@sub.example.com', 'f***@sub.example.com'],
    ['UPPER@Example.COM', 'U***@Example.COM'],
  ]
  for (const [raw, expected] of cases) {
    it(`masks ${JSON.stringify(raw)} → ${JSON.stringify(expected)}`, () => {
      const masked = maskEmail(raw)
      expect(masked).toBe(expected)
      assertNoRaw(raw, masked)
    })
  }
})

describe('maskEmail — RFC-flavoured local parts', () => {
  const cases: Array<[string, string]> = [
    ['user+tag@example.com', 'u***@example.com'],
    ['user+very-long-tag+another@example.com', 'u***@example.com'],
    ['user.name+filter@example.com', 'u***@example.com'],
    ['user_name@example.com', 'u***@example.com'],
    ['user-name@example.com', 'u***@example.com'],
    ['1234567890@example.com', '1***@example.com'],
    ['x@sub.example.co.uk', 'x***@sub.example.co.uk'],
    // Address with an @ inside the local part (quoted local part). Mask
    // splits on the LAST @ so the domain remains identifiable.
    ['"weird@local"@example.com', '"***@example.com'],
  ]
  for (const [raw, expected] of cases) {
    it(`masks ${JSON.stringify(raw)} → ${JSON.stringify(expected)}`, () => {
      const masked = maskEmail(raw)
      expect(masked).toBe(expected)
      assertNoRaw(raw, masked)
    })
  }
})

describe('maskEmail — whitespace and casing', () => {
  it('trims surrounding whitespace before masking', () => {
    const raw = '   spaced@example.com   '
    const masked = maskEmail(raw)
    expect(masked).toBe('s***@example.com')
    // The raw padded value must not appear.
    expect(masked).not.toContain('spaced@example.com')
  })

  it('preserves domain casing without leaking the full local part', () => {
    const masked = maskEmail('AliceSmith@Example.COM')
    expect(masked).toBe('A***@Example.COM')
    expect(masked).not.toContain('AliceSmith')
    expect(masked).not.toContain('licesmith')
  })
})

describe('maskEmail — invalid / defensive inputs', () => {
  const cases: Array<[unknown, string]> = [
    [undefined, '***'],
    [null, '***'],
    ['', '***'],
    ['   ', '***'],
    ['no-at-sign', '***'],
    ['@no-local.com', '***'], // empty local part
    ['no-domain@', '***'], // empty domain
    ['local@localhost', '***'], // domain without a dot
    ['plainstring', '***'],
    [42, '***'],
    [{ toString: () => 'x@y.com' }, '***'],
  ]
  for (const [raw, expected] of cases) {
    it(`returns *** for ${JSON.stringify(raw)}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(maskEmail(raw as any)).toBe(expected)
    })
  }
})

describe('maskEmail — invariant: no raw address ever survives', () => {
  const samples = [
    'alice@example.com',
    'a.very.long.local.part@example.com',
    'user+tag@sub.domain.example.co.uk',
    'x@y.io',
    '  padded@example.com  ',
    'MixedCase.User@Example.COM',
    'user_name-99@mail.example.org',
  ]
  for (const raw of samples) {
    it(`does not contain the raw address for ${JSON.stringify(raw)}`, () => {
      const masked = maskEmail(raw)
      const rawTrim = raw.trim()
      // Neither the trimmed input nor its local part can appear.
      expect(masked).not.toContain(rawTrim)
      const localPart = rawTrim.split('@')[0]
      if (localPart.length > 1) {
        // The masked output must not include the local part beyond its
        // first character (which is the only intentionally-revealed byte).
        expect(masked).not.toContain(localPart)
      }
      // The masking marker must be present.
      expect(masked).toContain('***')
    })
  }
})
