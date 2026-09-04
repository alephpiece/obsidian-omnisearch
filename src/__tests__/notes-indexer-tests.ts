import type { TAbstractFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'
import type OmnisearchPlugin from '../main'
import { NotesIndexer } from '../notes-indexer'

describe('NotesIndexer.refreshIndex()', () => {
  it('invalidates a modified document before indexing it', async () => {
    const path = 'notes/update.md'
    const file = { path } as unknown as TAbstractFile
    const calls: string[] = []
    const removeDocument = vi.fn((removedPath: string) => {
      calls.push(`invalidate:${removedPath}`)
    })
    const addDocument = vi.fn()
    const removeFromPaths = vi.fn((paths: string[]) => {
      calls.push(`remove:${paths.join(',')}`)
    })
    const addFromPaths = vi.fn(async (paths: string[]) => {
      calls.push(`add:${paths.join(',')}`)
    })
    const plugin = {
      app: {
        vault: {
          getAbstractFileByPath: vi.fn((candidate: string) =>
            candidate === path ? file : null
          ),
        },
      },
      documentsRepository: { addDocument, removeDocument },
      searchEngine: { removeFromPaths, addFromPaths },
    } as unknown as OmnisearchPlugin
    const indexer = new NotesIndexer(plugin)

    indexer.flagNoteForReindex(file)
    await indexer.refreshIndex()

    expect(calls).toEqual([
      `invalidate:${path}`,
      `remove:${path}`,
      `add:${path}`,
    ])
    expect(addDocument).not.toHaveBeenCalled()
  })
})
