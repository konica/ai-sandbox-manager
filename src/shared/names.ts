/** Normalise an arbitrary definition/session name into a safe sbx sandbox name. */
export function toSbxName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'sandbox'
}
