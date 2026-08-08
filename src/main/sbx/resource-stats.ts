import type { ResourceStats } from '@shared/resource-stats'
import { parseResourceStats } from '@shared/resource-stats'
import type { SbxAdapter } from './adapter'

/**
 * Probe script run inside the container. Prints `key value` lines for CPU (two cgroup usage
 * samples ~1s apart + elapsed ns + nproc), memory (cgroup v2 then v1, plus inactive file cache
 * for excluding reclaimable page cache from "used"), and disk (df on /).
 * Each metric is emitted only if its source is readable, so one missing file degrades to a
 * null metric rather than aborting — do NOT add `set -e`.
 *
 * cgroup path: with `cgroupns=host` (the default for these sandboxes) the container's own
 * cgroup is NOT the cgroupfs mount root — it is nested, e.g. `/docker/<id>`. At the root,
 * cgroup v2 deliberately omits `memory.current`/`memory.max`, so reading `/sys/fs/cgroup/…`
 * directly yields no memory data (and a whole-VM CPU figure). `/proc/self/cgroup` (the `0::…`
 * line on v2) gives the container's real relative path, from which we build the correct base.
 * We still fall back to the bare mount root (private cgroupns) and to cgroup v1.
 */
export const RESOURCE_PROBE_SCRIPT = [
  `cgrel=$(awk -F: '$1=="0"{print $3; exit}' /proc/self/cgroup 2>/dev/null); CG="/sys/fs/cgroup$cgrel"`,
  `read_cpu() { if [ -r "$CG/cpu.stat" ]; then awk '/^usage_usec/{print $2}' "$CG/cpu.stat"; elif [ -r /sys/fs/cgroup/cpu.stat ]; then awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat; elif [ -r /sys/fs/cgroup/cpuacct/cpuacct.usage ]; then n=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null); [ -n "$n" ] && echo $((n/1000)); fi; }`,
  `t0=$(date +%s%N); c0=$(read_cpu); sleep 1; t1=$(date +%s%N); c1=$(read_cpu)`,
  `[ -n "$c0" ] && [ -n "$c1" ] && echo "cpu_usec $c0 $c1"`,
  `echo "cpu_elapsed_ns $((t1 - t0))"`,
  `echo "nproc $(nproc 2>/dev/null || echo 1)"`,
  `if [ -r "$CG/cpu.max" ]; then echo "cpu_max $(cat "$CG/cpu.max")"; elif [ -r /sys/fs/cgroup/cpu.max ]; then echo "cpu_max $(cat /sys/fs/cgroup/cpu.max)"; elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then q=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us); p=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null); [ "$q" = "-1" ] && echo "cpu_max max $p" || echo "cpu_max $q $p"; fi`,
  `[ -r /proc/meminfo ] && echo "mem_total $(awk '/^MemTotal:/{print $2*1024}' /proc/meminfo)"`,
  `if [ -r "$CG/memory.current" ]; then MB="$CG"; elif [ -r /sys/fs/cgroup/memory.current ]; then MB="/sys/fs/cgroup"; else MB=""; fi`,
  `if [ -n "$MB" ]; then echo "mem_current $(cat "$MB/memory.current")"; echo "mem_max $(cat "$MB/memory.max")"; [ -r "$MB/memory.stat" ] && echo "mem_inactive $(awk '/^inactive_file /{print $2}' "$MB/memory.stat")"; elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then echo "mem_current $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)"; echo "mem_max $(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"; [ -r /sys/fs/cgroup/memory/memory.stat ] && echo "mem_inactive $(awk '/^total_inactive_file /{print $2}' /sys/fs/cgroup/memory/memory.stat)"; fi`,
  `df -PB1 / 2>/dev/null | awk 'NR==2{print "disk", $2, $3}'`
].join('\n')

/** Run the probe inside <name> and parse the result. Adapter/SbxError propagates on exec failure. */
export async function fetchResourceStats(adapter: Pick<SbxAdapter, 'execCapture'>, name: string): Promise<ResourceStats> {
  const stdout = await adapter.execCapture(name, RESOURCE_PROBE_SCRIPT)
  return parseResourceStats(stdout)
}
