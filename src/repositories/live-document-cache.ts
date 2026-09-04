import type { IndexedDocument } from '../globals'

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

/**
 * Bounded LRU cache for the raw documents needed to render search results.
 */
export class LiveDocumentCache {
  private documents = new Map<string, IndexedDocument>()
  private bytes = 0

  constructor(private readonly maxBytes = DEFAULT_MAX_BYTES) {}

  public get(path: string): IndexedDocument | undefined {
    const document = this.documents.get(path)
    if (!document) return undefined

    // Reinsert to mark this document as the most recently used.
    this.documents.delete(path)
    this.documents.set(path, document)
    return document
  }

  public set(path: string, document: IndexedDocument): void {
    this.delete(path)

    const documentBytes = this.getDocumentBytes(document)
    // A single large extracted document must not defeat the cache bound.
    if (documentBytes > this.maxBytes) return

    this.documents.set(path, document)
    this.bytes += documentBytes
    this.evictLeastRecentlyUsed()
  }

  public delete(path: string): void {
    const document = this.documents.get(path)
    if (!document) return

    this.bytes -= this.getDocumentBytes(document)
    this.documents.delete(path)
  }

  private evictLeastRecentlyUsed(): void {
    while (this.bytes > this.maxBytes) {
      const oldestPath = this.documents.keys().next().value
      if (oldestPath === undefined) return
      this.delete(oldestPath)
    }
  }

  private getDocumentBytes(document: IndexedDocument): number {
    const strings = [
      document.path,
      document.basename,
      document.displayTitle,
      document.content,
      document.aliases,
      document.headings1,
      document.headings2,
      document.headings3,
      document.hanBigrams,
      ...document.tags,
      ...document.unmarkedTags,
    ]
    return strings.reduce((total, value) => total + value.length * 2, 0)
  }
}
