import type { QueryCombination } from 'minisearch'
import { BRACKETS_AND_SPACE, SPACE_OR_PUNCTUATION } from '../globals'
import { logVerbose, removeBase64Images, splitCamelCase, splitHyphens } from '../tools/utils'
import type OmnisearchPlugin from '../main'
import { containsHan, splitAtHanBoundaries } from './cjk'

// eslint-disable-next-line @typescript-eslint/no-require-imports -- that's how you're supposed to import this package
const markdownLinkExtractor = require('markdown-link-extractor') as (value: string) => string[]

type IntlWordSegmenter = {
  segment: (text: string) => Iterable<{ segment: string; isWordLike?: boolean }>
}

function getIntlChineseSegmenter(): IntlWordSegmenter | undefined {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locales: string,
      options: { granularity: 'word' }
    ) => IntlWordSegmenter
  }).Segmenter
  if (!Segmenter) return undefined

  try {
    return new Segmenter('zh', { granularity: 'word' })
  } catch {
    return undefined
  }
}

export class Tokenizer {
  private readonly intlSegmenter = getIntlChineseSegmenter()

  constructor(private plugin: OmnisearchPlugin) {}

  /**
   * Tokenization for indexing will possibly return more tokens than the original text.
   * This is because we combine different methods of tokenization to get the best results.
   * @param text
   * @returns
   */
  public tokenizeForIndexing(text: string): string[] {
    try {
      text = removeBase64Images(text)
      const words = this.tokenizeWords(text)
      let urls: string[] = []
      if (this.plugin.settings.tokenizeUrls) {
        try {
          urls = markdownLinkExtractor(text)
        } catch (e) {
          logVerbose('Error extracting urls', e)
        }
      }

      // Keep original tokens for backward compatibility, then add script-boundary
      // tokens so a mixed value such as "Obsidian插件" can be found from either side.
      const rawTokens = text.split(SPACE_OR_PUNCTUATION)
      let tokens = rawTokens.flatMap(token => [
        token,
        ...splitAtHanBoundaries(token),
      ])
      tokens = [...tokens.flatMap(token => [
        token,
        ...splitHyphens(token),
        ...(this.plugin.settings.splitCamelCase ? splitCamelCase(token) : []),
      ]), ...words]

      // Add urls
      if (urls.length) {
        tokens = [...tokens, ...urls]
      }

      // Remove duplicates
      // tokens = [...new Set(tokens)]

      // Remove empty tokens
      tokens = tokens.filter(Boolean)

      return tokens
    } catch (e) {
      console.error('Error tokenizing text, skipping document', e)
      return []
    }
  }

  /**
   * Search tokenization will use the same tokenization methods as indexing,
   * but will combine each group with "OR" operators
   * @param text
   * @returns
   */
  public tokenizeForSearch(text: string): QueryCombination {
    // Extract urls and remove them from the query
    const urls: string[] = markdownLinkExtractor(text)
    text = urls.reduce((acc, url) => acc.replace(url, ''), text)

    // Keep an uninterrupted Han query intact when only Intl.Segmenter is
    // available. The Han-bigram fallback handles its substring recall without
    // turning its component words into a broad AND query.
    const tokens = [
      ...this.tokenizeTokens(text, { useIntlSegmenter: false }),
      ...urls,
    ].filter(Boolean)

    return {
      combineWith: 'OR',
      queries: [
        { combineWith: 'AND', queries: tokens },
        {
          combineWith: 'AND',
          queries: this.tokenizeWords(text, {
            useIntlSegmenter: false,
          }).filter(Boolean),
        },
        { combineWith: 'AND', queries: tokens.flatMap(splitHyphens) },
        ...(this.plugin.settings.splitCamelCase
          ? [{ combineWith: 'AND' as const, queries: tokens.flatMap(splitCamelCase) }]
          : []),
      ],
    }
  }

  /**
   * Non-Han terms used to constrain a Han-bigram fallback search. This keeps a
   * query such as "Obsidian时候" from returning a note that only contains "时候".
   */
  public getNonHanTokens(text: string): string[] {
    const urls = markdownLinkExtractor(text)
    text = urls.reduce((acc, url) => acc.replace(url, ''), text)

    return text
      .split(SPACE_OR_PUNCTUATION)
      .flatMap(splitAtHanBoundaries)
      .filter(token => token && !containsHan(token))
  }

  private tokenizeWords(
    text: string,
    { skipChs = false, useIntlSegmenter = true } = {}
  ): string[] {
    const tokens = text.split(BRACKETS_AND_SPACE).flatMap(splitAtHanBoundaries)
    if (skipChs) return tokens
    return this.tokenizeChsWord(tokens, useIntlSegmenter)
  }

  private tokenizeTokens(
    text: string,
    { skipChs = false, useIntlSegmenter = true } = {}
  ): string[] {
    const tokens = text.split(SPACE_OR_PUNCTUATION).flatMap(splitAtHanBoundaries)
    if (skipChs) return tokens
    return this.tokenizeChsWord(tokens, useIntlSegmenter)
  }

  private tokenizeChsWord(
    tokens: string[],
    useIntlSegmenter: boolean
  ): string[] {
    const segmenter = this.plugin.getChsSegmenter() as { cut: (word: string, options: { search: boolean }) => string[] }
    if (segmenter) {
      return tokens.flatMap(word =>
        containsHan(word) ? segmenter.cut(word, { search: true }) : [word]
      )
    }

    const intlSegmenter = useIntlSegmenter ? this.intlSegmenter : undefined
    if (!intlSegmenter) return tokens
    return tokens.flatMap(word => {
      if (!containsHan(word)) return [word]
      const segments = [...intlSegmenter.segment(word)]
        .filter(segment => segment.isWordLike)
        .map(segment => segment.segment)
      return segments.length ? segments : [word]
    })
  }
}
