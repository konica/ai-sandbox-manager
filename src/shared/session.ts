/**
 * One Claude session backup on the host, as the renderer needs to describe it.
 *
 * Lives in shared/ because both the main process (which writes archives) and the renderer
 * (which lists and exports them) depend on the shape — the renderer must never import from
 * main/, and duplicating the type would let the two drift.
 */
export interface ArchiveEntry {
  /** Absolute path to the archive directory on the host. */
  dir: string
  /** The instance the sessions were captured from. */
  sbxName: string
  /** ISO capture time, recovered from the directory name. */
  capturedAt: string
}
