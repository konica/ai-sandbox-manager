import type { Definition } from '@shared/types'
import { useT } from '../i18n'

/**
 * Non-blocking launch-time nudge shown when a definition's Claude agent has no
 * configured credential. Offers a host-side OAuth sign-in, but never blocks the
 * launch — Claude prompts `/login` in-session and the token persists globally.
 */
export function AuthNudge({ definition, onProceed, onSignIn, onUseKey, onCancel }: {
  definition: Definition
  onProceed: () => void
  onSignIn: () => void
  onUseKey: () => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('auth.nudgeTitle', { name: definition.name })} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('auth.nudgeTitle', { name: definition.name })}</h3>
        <p className="modal-desc">{t('auth.nudgeBody')}</p>
        <div className="modal-actions" style={{ marginTop: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={onUseKey}>{t('auth.useKey')}</button>
          <button className="btn btn-secondary" onClick={onSignIn}>{t('auth.signInFirst')}</button>
          <button className="btn btn-primary" onClick={onProceed}>{t('auth.proceed')}</button>
        </div>
      </div>
    </div>
  )
}
