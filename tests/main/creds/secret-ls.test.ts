import { describe, it, expect } from 'vitest'
import { parseCustomSecretPlaceholders, customPlaceholdersForScope } from '../../../src/main/creds/secret-ls'

// Real `sbx secret ls` layout (from a live run): a services section (no PLACEHOLDER column) then a
// CUSTOM SECRETS section whose PLACEHOLDER column carries the dynamic per-sandbox `sbx-cs-…` token.
const OUTPUT = `SCOPE                            TYPE      NAME       SECRET
(global)                         service   github     gho_Cw*****...*****0amd
test-embedding-openai-11a2d936   service   openai     sk-pro*****...*****Ft8A
(global)                         service   anthropic  (oauth configured)

CUSTOM SECRETS
SCOPE                            TARGETS                                          ENV                    PLACEHOLDER              SECRET
test-embedding-openai-11a2d936   mgm-datascience-openai-sweden.openai.azure.com   AZURE_OPENAI_API_KEY   sbx-cs-p8kRYpQbR2bGtkyO  GIxeVl*****...*****i2cm
test-embedding-openai-3934605d   mgm-datascience-openai-sweden.openai.azure.com   AZURE_OPENAI_API_KEY   sbx-cs-4smdU8cqXOaiQZYS  GIxeVl*****...*****i2cm
`

describe('parseCustomSecretPlaceholders', () => {
  it('extracts scope/env/placeholder for each CUSTOM SECRETS row, ignoring service rows and headers', () => {
    expect(parseCustomSecretPlaceholders(OUTPUT)).toEqual([
      { scope: 'test-embedding-openai-11a2d936', env: 'AZURE_OPENAI_API_KEY', placeholder: 'sbx-cs-p8kRYpQbR2bGtkyO' },
      { scope: 'test-embedding-openai-3934605d', env: 'AZURE_OPENAI_API_KEY', placeholder: 'sbx-cs-4smdU8cqXOaiQZYS' }
    ])
  })
  it('returns nothing when there are no custom secrets', () => {
    expect(parseCustomSecretPlaceholders('SCOPE   TYPE   NAME   SECRET\n(global)   service   github   gho_x')).toEqual([])
    expect(parseCustomSecretPlaceholders('')).toEqual([])
  })
})

describe('customPlaceholdersForScope', () => {
  it('maps ENV → placeholder only for the requested sandbox scope', () => {
    const map = customPlaceholdersForScope(OUTPUT, 'test-embedding-openai-3934605d')
    expect(map.get('AZURE_OPENAI_API_KEY')).toBe('sbx-cs-4smdU8cqXOaiQZYS')
    expect(map.size).toBe(1)
  })
  it('is empty for a scope with no custom secrets', () => {
    expect(customPlaceholdersForScope(OUTPUT, 'some-other-sandbox').size).toBe(0)
  })
})
