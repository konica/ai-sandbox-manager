import { TagInput } from '../../components/TagInput'
import { useT } from '../../i18n'

/**
 * Metadata tab: per-instance metadata editing. Currently just Tags (organize/filter an
 * instance); the tab name leaves room for more metadata later. Presentational — the parent
 * owns the tags state and persists changes through onChange.
 */
export function MetadataTab({ tags, onChange }: {
  tags: string[]
  onChange: (tags: string[]) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{t('detail.tagsTitle')}</div>
      <TagInput
        tags={tags}
        onChange={onChange}
        placeholder={t('detail.tagsPlaceholder')}
        ariaLabel="Edit instance tags"
      />
      <p className="section-desc" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('detail.tagsHint')}</p>
    </div>
  )
}
