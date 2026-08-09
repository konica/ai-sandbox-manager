import os from 'node:os'

/** Host resource capacity used to guide sandbox sizing in the wizard. `os` is injected so
 *  tests can supply a fake probe. */
export function readHostCapacity(osMod: Pick<typeof os, 'cpus' | 'totalmem'> = os): {
  cpuCores: number
  totalMemBytes: number
} {
  return { cpuCores: osMod.cpus().length, totalMemBytes: osMod.totalmem() }
}
