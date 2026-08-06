/**
 * Human-readable byte size, 1024-based: "0 B", "512 B", "1.5 KB", "312.0 MB", "2.0 GB".
 * Bytes render with no decimal; KB and up with one. Negative/NaN/non-finite → "0 B".
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}
