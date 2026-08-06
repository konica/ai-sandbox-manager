import { TagInput } from '../../components/TagInput'
import { useT } from '../../i18n'
import { formatRelativeTime } from '@shared/format-time'

/**
 * Metadata tab: per-instance metadata. Shows the created date (read-only) and the Tags editor
 * (organize/filter an instance). Presentational — the parent owns the tags state and persists
 * changes through onChange.
 */
export function MetadataTab({ tags, onChange, createdAt }: {
  tags: string[]
  onChange: (tags: string[]) => void
  createdAt: string | null
}): JSX.Element {
  const t = useT()
  const rel = formatRelativeTime(createdAt)
  return (
    <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-1)' }}>{t('detail.createdLabel')}</div>
        {rel && createdAt
          ? <span style={{ fontSize: 13, color: 'var(--text-secondary)' }} title={new Date(createdAt).toLocaleString()}>{rel}</span>
          : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('detail.createdUnknown')}</span>}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{t('detail.tagsTitle')}</div>
        <TagInput
          tags={tags}
          onChange={onChange}
          placeholder={t('detail.tagsPlaceholder')}
          ariaLabel="Edit instance tags"
        />
        <p className="section-desc" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('detail.tagsHint')}</p>
      </div>
    </div>
  )
}
