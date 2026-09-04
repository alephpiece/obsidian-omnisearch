import { describe, expect, it } from 'vitest'
import type { IndexedDocument } from '../globals'
import { LiveDocumentCache } from '../repositories/live-document-cache'

function createDocument(path: string, content: string): IndexedDocument {
  return {
    path,
    basename: path,
    displayTitle: '',
    mtime: 0,
    content,
    aliases: '',
    tags: [],
    unmarkedTags: [],
    headings1: '',
    headings2: '',
    headings3: '',
    hanBigrams: '',
  }
}

describe('LiveDocumentCache', () => {
  it('evicts the least recently used document within its byte budget', () => {
    const cache = new LiveDocumentCache(5_500)
    const first = createDocument('first.md', 'a'.repeat(1_000))
    const second = createDocument('second.md', 'b'.repeat(1_000))
    const third = createDocument('third.md', 'c'.repeat(1_000))

    cache.set(first.path, first)
    cache.set(second.path, second)
    expect(cache.get(first.path)).toBe(first)

    cache.set(third.path, third)

    expect(cache.get(second.path)).toBeUndefined()
    expect(cache.get(first.path)).toBe(first)
    expect(cache.get(third.path)).toBe(third)
  })

  it('does not retain a document larger than the cache budget', () => {
    const cache = new LiveDocumentCache(100)
    const document = createDocument('large.md', 'x'.repeat(100))

    cache.set(document.path, document)

    expect(cache.get(document.path)).toBeUndefined()
  })
})
