import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface CaInfo {
  /** The certificate in PEM form, ready to embed in the in-sandbox install script. */
  pem: string
  /** Full subject, newline-separated as Node reports it. */
  subject: string
  /** Just the CN, for the settings card's confirmation line. */
  commonName: string
  /** Human-readable expiry, e.g. "Aug 21 08:29:27 2036 GMT". */
  expires: string
}

/** Pull CN out of Node's newline-separated subject string; falls back to the whole subject. */
function commonNameOf(subject: string): string {
  for (const line of subject.split('\n')) {
    const t = line.trim()
    if (t.startsWith('CN=')) return t.slice(3)
  }
  return subject.trim()
}

/**
 * Parse a Burp CA from raw bytes. Node's X509Certificate accepts DER and PEM alike and
 * re-emits PEM, which is why this feature needs no `openssl` binary on the host.
 */
export function parseCaBuffer(buf: Buffer): CaInfo {
  let cert: X509Certificate
  try {
    cert = new X509Certificate(buf)
  } catch {
    throw new Error('That file is not a valid certificate. Export the Burp CA from Proxy > Proxy settings > Import / export CA certificate.')
  }
  return {
    pem: cert.toString(),
    subject: cert.subject,
    commonName: commonNameOf(cert.subject),
    expires: cert.validTo
  }
}

/** Read and parse a CA file. Read failures name the path so the settings card can show it. */
export function readCaFile(path: string, readFile: (p: string) => Buffer = readFileSync): CaInfo {
  let buf: Buffer
  try {
    buf = readFile(path)
  } catch (e) {
    throw new Error(`Could not read the CA file at ${path}: ${(e as Error).message}`)
  }
  return parseCaBuffer(buf)
}
