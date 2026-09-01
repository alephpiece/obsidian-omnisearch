const HAN_CHARACTER = /\p{Script=Han}/u
const HAN_RUN = /\p{Script=Han}+/gu

/**
 * True for all Unicode Han characters, including supplementary-plane Han.
 */
export function containsHan(text: string): boolean {
  return HAN_CHARACTER.test(text)
}

/**
 * Split only when text moves between Han and non-Han scripts.
 *
 * The caller keeps the original token too, so this is additive: a mixed token
 * such as "Obsidian插件v1" remains searchable as a whole and as its useful
 * script parts.
 */
export function splitAtHanBoundaries(text: string): string[] {
  if (!text) return []

  const parts: string[] = []
  let part = ''
  let previousIsHan: boolean | undefined

  for (const character of text) {
    const isHan = containsHan(character)
    if (part && previousIsHan !== isHan) {
      parts.push(part)
      part = ''
    }
    part += character
    previousIsHan = isHan
  }

  if (part) parts.push(part)
  return parts
}

/**
 * Return each contiguous Unicode Han run without crossing punctuation,
 * whitespace, or a Latin/CJK script boundary.
 */
export function getHanRuns(text: string): string[] {
  return text.match(HAN_RUN) ?? []
}

/**
 * Produce overlapping two-Han-character terms for exact CJK substring recall.
 */
export function getHanBigrams(text: string): string[] {
  return getHanRuns(text).flatMap(run => {
    const characters = Array.from(run)
    return characters.slice(1).map((character, index) =>
      characters[index] + character
    )
  })
}

/**
 * Generate Han bigrams independently for each indexed field. This prevents a
 * bigram from being made across a title/body/path boundary.
 */
export function getHanBigramsFromFields(fields: string[]): string[] {
  return fields.flatMap(getHanBigrams)
}

/**
 * Check that every requested Han run appears contiguously inside one indexed
 * source field. Runs may match different fields, as regular multi-term search
 * does, but characters must never be stitched across field boundaries.
 */
export function hasHanRunsInFields(fields: string[], runs: string[]): boolean {
  return runs.every(run => fields.some(field => field.includes(run)))
}
