import { useState } from 'react'

/**
 * Controlled free-form tag chip input. Enter or comma commits the current draft;
 * the ✕ on a chip removes it. Case-insensitive duplicates are ignored. Purely
 * presentational — normalization/limits are enforced by the main process on write.
 */
export function TagInput({ tags, onChange, placeholder, ariaLabel }: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  ariaLabel?: string
}): JSX.Element {
  const [draft, setDraft] = useState('')

  function commit(raw: string): void {
    const t = raw.trim()
    if (!t) return
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) { setDraft(''); return }
    onChange([...tags, t])
    setDraft('')
  }
  function remove(tag: string): void {
    onChange(tags.filter((x) => x !== tag))
  }

  return (
    <div className="tag-input" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'var(--accent-soft, rgba(0,120,255,.12))', color: 'var(--accent)', borderRadius: 999, padding: '2px 8px' }}>
          {tag}
          <button type="button" className="tag-remove" aria-label={`Remove tag ${tag}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }} onClick={() => remove(tag)}>✕</button>
        </span>
      ))}
      <input
        className="input"
        aria-label={ariaLabel ?? 'Tags'}
        style={{ flex: 1, minWidth: 100, border: 'none', outline: 'none', background: 'none', fontSize: 13 }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) commit(v.slice(0, -1)) // comma commits
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          else if (e.key === 'Backspace' && draft === '' && tags.length > 0) remove(tags[tags.length - 1])
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  )
}
