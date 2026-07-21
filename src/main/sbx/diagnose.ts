// Parse `sbx diagnose -o json` for the Docker sign-in / governance registration
// state. When the sbx client isn't registered, Docker's remote governance layer
// denies ALL sandbox access — network AND filesystem mounts — surfacing as a
// cryptic "403 … client not registered" when a sandbox tries to start. Checking
// this before a launch lets us show an actionable message instead.

export type AuthCheck = 'pass' | 'fail' | 'unknown'

interface DiagnoseCheck {
  name?: string
  status?: string
}

/**
 * Read the "Authentication" check status out of the diagnose JSON.
 *
 * Returns 'unknown' when the output is unparseable, the check is absent, or its
 * status is anything other than an explicit pass/fail (e.g. warn/skip). Callers
 * MUST NOT treat 'unknown' as a failure — blocking on it would falsely gate a
 * launch whenever diagnostics can't run (daemon down, old CLI), where the real
 * error should surface at run time instead.
 */
export function parseDiagnoseAuth(stdout: string): AuthCheck {
  let data: { checks?: DiagnoseCheck[] }
  try {
    data = JSON.parse(stdout)
  } catch {
    return 'unknown'
  }
  const check = data.checks?.find((c) => c.name === 'Authentication')
  if (!check) return 'unknown'
  if (check.status === 'pass') return 'pass'
  if (check.status === 'fail') return 'fail'
  return 'unknown'
}
