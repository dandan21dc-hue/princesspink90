import { describe, expect, it } from 'vitest'
import { normalizeEntryPhrase } from '@/lib/entry-phrase'

describe('normalizeEntryPhrase', () => {
  it('returns null for null / undefined', () => {
    expect(normalizeEntryPhrase(null)).toBeNull()
    expect(normalizeEntryPhrase(undefined)).toBeNull()
  })

  it('returns null for empty string and whitespace-only strings', () => {
    expect(normalizeEntryPhrase('')).toBeNull()
    expect(normalizeEntryPhrase('   ')).toBeNull()
    expect(normalizeEntryPhrase('\t\n ')).toBeNull()
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeEntryPhrase('  Velvet Night  ')).toBe('Velvet Night')
    expect(normalizeEntryPhrase('\nCrimson Silk\t')).toBe('Crimson Silk')
  })

  it('preserves internal whitespace and non-blank values as-is', () => {
    expect(normalizeEntryPhrase('Ruby Whisper')).toBe('Ruby Whisper')
    expect(normalizeEntryPhrase('a')).toBe('a')
  })
})
