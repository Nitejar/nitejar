import { describe, expect, it } from 'vitest'
import { extractMentions } from './mention-parser'

describe('extractMentions', () => {
  it('matches hyphenated handles', () => {
    const mentions = extractMentions('Thanks @nitejar-dev and @pixel', ['nitejar-dev', 'pixel'])
    expect(mentions).toEqual(expect.arrayContaining(['nitejar-dev', 'pixel']))
  })

  it('is case-insensitive and de-duplicates mentions', () => {
    const mentions = extractMentions('@PIXEL please sync with @pixel', ['pixel'])
    expect(mentions).toEqual(['pixel'])
  })
})
