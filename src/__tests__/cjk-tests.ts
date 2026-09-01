import { describe, expect, it } from 'vitest'
import MiniSearch from 'minisearch'
import type OmnisearchPlugin from '../main'
import { RecencyCutoff, type IndexedDocument } from '../globals'
import {
  getHanBigrams,
  getHanBigramsFromFields,
  getHanRuns,
  hasHanRunsInFields,
  splitAtHanBoundaries,
} from '../search/cjk'
import { Query } from '../search/query'
import { SearchEngine } from '../search/search-engine'
import { Tokenizer } from '../search/tokenizer'

describe('CJK indexing helpers', () => {
  it('splits mixed Chinese and Latin text at script boundaries', () => {
    expect(splitAtHanBoundaries('中文Obsidian插件v1')).toEqual([
      '中文',
      'Obsidian',
      '插件',
      'v1',
    ])
  })

  it('recognizes supplementary-plane Han characters', () => {
    expect(getHanRuns('A𠀀测试B')).toEqual(['𠀀测试'])
  })

  it('generates overlapping Han bigrams without crossing fields', () => {
    expect(getHanBigrams('周五的时候')).toEqual(['周五', '五的', '的时', '时候'])
    expect(getHanBigramsFromFields(['春风', '秋雨'])).toEqual(['春风', '秋雨'])
  })

  it('requires a long Han run to remain contiguous in one source field', () => {
    const fields = ['人工', '工智', '智能']

    expect(getHanBigramsFromFields(fields)).toEqual(getHanBigrams('人工智能'))
    expect(hasHanRunsInFields(fields, ['人工智能'])).toBe(false)
  })
})

describe('Tokenizer CJK additions', () => {
  const tokenizer = new Tokenizer({
    settings: {
      splitCamelCase: false,
      tokenizeUrls: false,
    },
    getChsSegmenter: () => undefined,
  } as unknown as OmnisearchPlugin)

  it('keeps mixed tokens and adds their script parts for indexing', () => {
    const tokens = tokenizer.tokenizeForIndexing('中文Obsidian插件')

    expect(tokens).toContain('中文Obsidian插件')
    expect(tokens).toContain('中文')
    expect(tokens).toContain('Obsidian')
    expect(tokens).toContain('插件')
  })

  it('extracts Latin constraints from mixed queries', () => {
    expect(tokenizer.getNonHanTokens('中文Obsidian插件v1')).toEqual([
      'Obsidian',
      'v1',
    ])
  })

  it('retrieves an internal Han substring without dropping a mixed Latin constraint', () => {
    type TestDocument = {
      content: string
      hanBigrams: string
      path: string
    }

    const index = new MiniSearch<TestDocument>({
      fields: ['content', 'hanBigrams'],
      idField: 'path',
      tokenize: tokenizer.tokenizeForIndexing.bind(tokenizer),
      processTerm: term => term.toLowerCase(),
    })
    index.addAll([
      {
        path: 'with-english.md',
        content: '周五的时候Obsidian',
        hanBigrams: getHanBigramsFromFields(['周五的时候Obsidian']).join(' '),
      },
      {
        path: 'han-only.md',
        content: '周五的时候',
        hanBigrams: getHanBigramsFromFields(['周五的时候']).join(' '),
      },
    ])

    const hanResults = index.search(
      { combineWith: 'AND', queries: getHanBigrams('时候') },
      { fields: ['hanBigrams'], prefix: false, fuzzy: 0, tokenize: text => [text] }
    )
    const latinResults = index.search(
      { combineWith: 'AND', queries: tokenizer.getNonHanTokens('Obsidian时候') },
      { fields: ['content'], tokenize: text => [text] }
    )
    const latinIds = new Set(latinResults.map(result => String(result.id)))

    expect(hanResults.map(result => String(result.id))).toEqual([
      'with-english.md',
      'han-only.md',
    ])
    expect(hanResults.filter(result => latinIds.has(String(result.id))).map(result => String(result.id))).toEqual([
      'with-english.md',
    ])
  })
})

describe('CJK search fallback', () => {
  function createDocument(path: string, content: string): IndexedDocument {
    return {
      path,
      basename: path.replace(/\.md$/, ''),
      displayTitle: '',
      mtime: 0,
      content,
      aliases: '',
      tags: [],
      unmarkedTags: [],
      headings1: '',
      headings2: '',
      headings3: '',
      hanBigrams: getHanBigramsFromFields([content]).join(' '),
    }
  }

  function createEngine(documents: IndexedDocument[]): SearchEngine {
    const documentsByPath = new Map(documents.map(document => [document.path, document]))
    const plugin = {
      settings: {
        fuzziness: '0',
        weightBasename: 10,
        weightDirectory: 7,
        weightH1: 6,
        weightH2: 5,
        weightH3: 4,
        weightUnmarkedTags: 2,
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
        metadataCache: {
          getCache: () => null,
          isUserIgnored: () => false,
        },
      },
      documentsRepository: {
        getDocument: async (path: string) => documentsByPath.get(path),
      },
      getChsSegmenter: () => undefined,
    } as unknown as OmnisearchPlugin
    const engine = new SearchEngine(plugin)
    const index = (engine as unknown as {
      minisearch: MiniSearch<IndexedDocument>
    }).minisearch
    index.addAll(documents)
    return engine
  }

  function makeQuery(text: string): Query {
    return new Query(text, {
      ignoreDiacritics: false,
      ignoreArabicDiacritics: false,
    })
  }

  it('requires Latin terms and preserves contiguous Han matching', async () => {
    const engine = createEngine([
      createDocument('mixed.md', '周五的时候Obsidian'),
      createDocument('han-only.md', '周五的时候'),
    ])

    const results = await engine.search(makeQuery('Obsidian时候'), {
      prefixLength: 1,
    })

    expect(results.map(result => String(result.id))).toEqual(['mixed.md'])
  })

  it('rejects a long query whose bigrams appear only in separate locations', async () => {
    const engine = createEngine([
      createDocument('exact.md', '人工智能'),
      createDocument('stitched.md', '人工 工智 智能'),
    ])

    const results = await engine.search(makeQuery('人工智能'), {
      prefixLength: 1,
    })

    expect(results.map(result => String(result.id))).toEqual(['exact.md'])
  })
})
