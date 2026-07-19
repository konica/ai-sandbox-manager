import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'

function fake(stdout = '') {
  const calls: string[][] = []
  const spawn: SpawnFn = (_c, args) => { calls.push(args); return Promise.resolve({ stdout, stderr: '', code: 0 }) }
  return { spawn, calls }
}

describe('adapter live ports + network', () => {
  it('publishes a port with the full spec', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).publishPort('box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' })
    expect(calls[0]).toEqual(['ports', 'box', '--publish', '8080:3000/tcp'])
  })
  it('unpublishes a port', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).unpublishPort('box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' })
    expect(calls[0]).toEqual(['ports', 'box', '--unpublish', '8080:3000/tcp'])
  })
  it('publishes an ephemeral port (no host part)', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).publishPort('box', { hostPort: null, containerPort: 3000, protocol: 'tcp6' })
    expect(calls[0]).toEqual(['ports', 'box', '--publish', '3000/tcp6'])
  })
  it('allows a network resource live', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).allowNetwork('box', 'localhost:11434')
    expect(calls[0]).toEqual(['policy', 'allow', 'network', '--sandbox', 'box', 'localhost:11434'])
  })
  it('removes a network rule live by resource', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).removeNetwork('box', 'telemetry.example.com')
    expect(calls[0]).toEqual(['policy', 'rm', 'network', '--sandbox', 'box', '--resource', 'telemetry.example.com'])
  })
  it('lists ports from --json, deduping the v4/v6 pair', async () => {
    const json = JSON.stringify([
      { host_ip: '127.0.0.1', host_port: 8080, sandbox_port: 3000, protocol: 'tcp' },
      { host_ip: '::1', host_port: 8080, sandbox_port: 3000, protocol: 'tcp' }
    ])
    const { spawn } = fake(json)
    expect(await createSbxAdapter(spawn).listPorts('box')).toEqual([{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }])
  })
})
