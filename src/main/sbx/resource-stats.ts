import type { ResourceStats } from '@shared/resource-stats'
import { parseResourceStats } from '@shared/resource-stats'
import type { SbxAdapter } from './adapter'

/**
 * Probe script run inside the container. Prints `key value` lines for CPU (two cgroup usage
 * samples ~1s apart + elapsed ns + nproc), memory (cgroup v2 then v1), and disk (df on /).
 * Each metric is emitted only if its source is readable, so one missing file degrades to a
 * null metric rather than aborting — do NOT add `set -e`.
 */
export const RESOURCE_PROBE_SCRIPT = [
  `read_cpu() { if [ -r /sys/fs/cgroup/cpu.stat ]; then awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat; elif [ -r /sys/fs/cgroup/cpuacct/cpuacct.usage ]; then n=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null); [ -n "$n" ] && echo $((n/1000)); fi; }`,
  `t0=$(date +%s%N); c0=$(read_cpu); sleep 1; t1=$(date +%s%N); c1=$(read_cpu)`,
  `[ -n "$c0" ] && [ -n "$c1" ] && echo "cpu_usec $c0 $c1"`,
  `echo "cpu_elapsed_ns $((t1 - t0))"`,
  `echo "nproc $(nproc 2>/dev/null || echo 1)"`,
  `if [ -r /sys/fs/cgroup/memory.current ]; then echo "mem_current $(cat /sys/fs/cgroup/memory.current)"; echo "mem_max $(cat /sys/fs/cgroup/memory.max)"; elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then echo "mem_current $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)"; echo "mem_max $(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"; fi`,
  `df -PB1 / 2>/dev/null | awk 'NR==2{print "disk", $2, $3}'`
].join('\n')

/** Run the probe inside <name> and parse the result. Adapter/SbxError propagates on exec failure. */
export async function fetchResourceStats(adapter: Pick<SbxAdapter, 'execCapture'>, name: string): Promise<ResourceStats> {
  const stdout = await adapter.execCapture(name, RESOURCE_PROBE_SCRIPT)
  return parseResourceStats(stdout)
}
