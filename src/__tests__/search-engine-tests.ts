import { describe, expect, it } from 'vitest'
import type { IndexedDocument } from '../globals'
import type OmnisearchPlugin from '../main'
import { SearchEngine } from '../search/search-engine'

const MAX_CONCURRENT_DOCUMENT_MAPPINGS = 50

function createDocument(path: string): IndexedDocument {
  return {
    path,
    basename: path.split('/').pop() ?? path,
    displayTitle: '',
    mtime: 1,
    content: `content for ${path}`,
    aliases: '',
    tags: [],
    unmarkedTags: [],
    headings1: '',
    headings2: '',
    headings3: '',
    hanBigrams: '',
  }
}

function createEngine(
  getDocument: (path: string) => Promise<IndexedDocument>
): SearchEngine {
  const plugin = {
    settings: {
      ignoreDiacritics: false,
      ignoreArabicDiacritics: false,
      splitCamelCase: false,
      tokenizeUrls: false,
    },
    app: {
      vault: {
        getAbstractFileByPath: () => ({}),
      },
    },
    documentsRepository: {
      getDocument,
    },
    getChsSegmenter: () => undefined,
  } as unknown as OmnisearchPlugin
  return new SearchEngine(plugin)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('SearchEngine.addFromPaths()', () => {
  it('bounds document mapping while keeping markdown files first', async () => {
    // Arrange
    const markdownPaths = Array.from(
      { length: 500 },
      (_, index) => `notes/entry-${index}.md`
    )
    const attachmentPath = 'attachments/reference.pdf'
    const paths = [attachmentPath, ...markdownPaths]
    const documents = new Map(paths.map(path => [path, createDocument(path)]))
    const firstMappingStarted = deferred()
    const releaseMappings = deferred()
    const requestedPaths: string[] = []
    let concurrentMappings = 0
    let peakConcurrentMappings = 0

    const engine = createEngine(async path => {
      requestedPaths.push(path)
      concurrentMappings++
      peakConcurrentMappings = Math.max(
        peakConcurrentMappings,
        concurrentMappings
      )
      firstMappingStarted.resolve()

      await releaseMappings.promise
      concurrentMappings--
      return documents.get(path)!
    })

    // Act
    const indexing = engine.addFromPaths(paths)
    await firstMappingStarted.promise

    // Assert
    expect(concurrentMappings).toBeLessThanOrEqual(
      MAX_CONCURRENT_DOCUMENT_MAPPINGS
    )
    expect(peakConcurrentMappings).toBeLessThanOrEqual(
      MAX_CONCURRENT_DOCUMENT_MAPPINGS
    )
    expect(requestedPaths).toHaveLength(MAX_CONCURRENT_DOCUMENT_MAPPINGS)
    expect(requestedPaths).toEqual(markdownPaths.slice(0, requestedPaths.length))

    releaseMappings.resolve()
    await indexing

    expect(engine.getSerializedMiniSearch().documentCount).toBe(paths.length)
    expect(engine.getSerializedIndexedDocuments().map(doc => doc.path)).toEqual([
      ...markdownPaths,
      attachmentPath,
    ])
  })
})
