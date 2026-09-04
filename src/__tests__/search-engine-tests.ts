import { describe, expect, it } from 'vitest'
import { RecencyCutoff, type IndexedDocument } from '../globals'
import type OmnisearchPlugin from '../main'
import { Query } from '../search/query'
import { SearchEngine } from '../search/search-engine'

const MAX_CONCURRENT_DOCUMENT_MAPPINGS = 50

function createDocument(
  path: string,
  content = `content for ${path}`
): IndexedDocument {
  return {
    path,
    basename: path.split('/').pop() ?? path,
    displayTitle: '',
    mtime: 1,
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

function createEngine(
  getDocument: (path: string) => Promise<IndexedDocument>
): SearchEngine {
  const plugin = {
    settings: {
      fuzziness: '0',
      weightBasename: 1,
      weightDirectory: 1,
      weightH1: 1,
      weightH2: 1,
      weightH3: 1,
      weightUnmarkedTags: 1,
      recencyBoost: RecencyCutoff.Disabled,
      ignoreDiacritics: false,
      ignoreArabicDiacritics: false,
      hideExcluded: false,
      downrankedFoldersFilters: [],
      weightCustomProperties: [],
      displayTitle: '',
      splitCamelCase: false,
      tokenizeUrls: false,
    },
    app: {
      vault: {
        getAbstractFileByPath: () => ({}),
      },
      metadataCache: {
        getCache: () => null,
        isUserIgnored: () => false,
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

describe('SearchEngine', () => {
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

  it('does not load result documents without content filters', async () => {
    const path = 'notes/entry.md'
    const document = createDocument(path)
    let documentLoads = 0
    const engine = createEngine(async requestedPath => {
      documentLoads++
      return requestedPath === path ? document : createDocument(requestedPath)
    })
    await engine.addFromPaths([path])
    documentLoads = 0

    const results = await engine.search(
      new Query('content', {
        ignoreDiacritics: false,
        ignoreArabicDiacritics: false,
      }),
      { prefixLength: 1 }
    )

    expect(results.map(result => result.id)).toEqual([path])
    expect(documentLoads).toBe(0)
  })

  it('loads result documents when an exact-match filter needs content', async () => {
    const path = 'notes/entry.md'
    const document = createDocument(path, 'exact phrase')
    let documentLoads = 0
    const engine = createEngine(async requestedPath => {
      documentLoads++
      return requestedPath === path ? document : createDocument(requestedPath)
    })
    await engine.addFromPaths([path])
    documentLoads = 0

    const results = await engine.search(
      new Query('"exact phrase"', {
        ignoreDiacritics: false,
        ignoreArabicDiacritics: false,
      }),
      { prefixLength: 1 }
    )

    expect(results.map(result => result.id)).toEqual([path])
    expect(documentLoads).toBe(1)
  })
})
