/** Normalise an arbitrary definition/session name into a safe sbx sandbox name. */
export function toSbxName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'sandbox'
}

/**
 * Compose the base sandbox name from a definition name plus tags:
 * `<definition-slug>-<tag1>-<tag2>-…`. Each part is slugified with toSbxName rules.
 * Tags are appended in entry order only while the result stays within `maxLen`
 * (appending stops at the first tag that would overflow); the definition slug is
 * always kept. A launch hash is added separately by hashedSandboxName().
 */
export function composeInstanceBaseName(definitionName: string, tags: string[], maxLen = 40): string {
  let base = toSbxName(definitionName)
  for (const tag of tags) {
    const slug = toSbxName(tag)
    if (slug === 'sandbox' && tag.trim() === '') continue
    if (!slug) continue
    const next = `${base}-${slug}`
    if (next.length > maxLen) break
    base = next
  }
  return base
}
