import { describe, it, expect } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { parseCaBuffer, readCaFile } from '../../../src/main/capture/ca'

const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
MIIDkTCCAnmgAwIBAgIUVt29zzF/rVn8kF/GlOAp9K350lswDQYJKoZIhvcNAQEL
BQAwWDELMAkGA1UEBhMCWFgxFTATBgNVBAoMDFRlc3QgRml4dHVyZTEYMBYGA1UE
CwwPVGVzdCBGaXh0dXJlIENBMRgwFgYDVQQDDA9UZXN0IEZpeHR1cmUgQ0EwHhcN
MjYwODI0MDgyOTI3WhcNMzYwODIxMDgyOTI3WjBYMQswCQYDVQQGEwJYWDEVMBMG
A1UECgwMVGVzdCBGaXh0dXJlMRgwFgYDVQQLDA9UZXN0IEZpeHR1cmUgQ0ExGDAW
BgNVBAMMD1Rlc3QgRml4dHVyZSBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBALcvX42grAZLoDaIF8ue+6piLMeDCPxKTXv08wNHUZrKzj1SFfvkA1LL
oQXtLxDknaZTXReQJmgFvvWXUkpSNdFS+vGM57MKJE+x9nmnJCc3c4LcDSRDA4Za
teP1vJv/Hu+Nsyt7/8EHiVe0TRD8Ey5GbUHt1iF8i/7LQ1p/T3O43x3eRLM6+syG
ypi0aZHL3E/1EWRWOWkKYybk6HmugeTAUCWEYGlk83cjYVtO3CGx01CX8gESQ6Ep
UwYQNWHaoiUL1Tuu6/ABERAX2cfABHEAOAnp8OqwVeoNBQUyROwSngB1WZO7bwsE
fhEXjcaapEltknooJE8sph8/RZOIo68CAwEAAaNTMFEwHQYDVR0OBBYEFCVMC2gZ
zeUFX/aQNo4SQ+R6UPAuMB8GA1UdIwQYMBaAFCVMC2gZzeUFX/aQNo4SQ+R6UPAu
MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAJXAuNS9CLdnhPPZ
xcA5Chp2JDE2B7MVYjeS/BPv1ogUSSFy98FHcXs3AkMkaYGcpu1XJETmgmOrc4Bq
PsX6RUkocSBF4m4nlTipmE8254jU25/xdUe4vpGQzJpqY1gZc+Kl8b8ZNVYMRSgn
i1huO8kC8/YvM0QD93lzVayJ5Ox1Fpo7hDaXYJX9fPfZVT0s3l/xhio4LgmuQz2Q
pfd4dtQgHnLVtLEEJBOcXvERZtQfPyc9Wo5BXsfEq2PS4I+9IkP3A8/R7ntmOXwP
dn4emNm03uPYvsv16rdLiObHpRAVOQRmxDPSPxB94XzxoG+p79B55lObqGTRXNht
tYUJ2cI=
-----END CERTIFICATE-----
`

/** The same certificate in DER form, derived from the PEM so there is one source of truth. */
const FIXTURE_DER = Buffer.from(new X509Certificate(FIXTURE_PEM).raw)

describe('parseCaBuffer', () => {
  it('parses a PEM certificate', () => {
    const info = parseCaBuffer(Buffer.from(FIXTURE_PEM))
    expect(info.commonName).toBe('Test Fixture CA')
    expect(info.pem).toContain('-----BEGIN CERTIFICATE-----')
    expect(info.expires).toContain('2036')
  })

  it('parses a DER certificate and re-emits it as PEM (no openssl needed)', () => {
    const info = parseCaBuffer(FIXTURE_DER)
    expect(info.commonName).toBe('Test Fixture CA')
    expect(info.pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true)
  })

  it('produces identical PEM from DER and PEM inputs', () => {
    expect(parseCaBuffer(FIXTURE_DER).pem).toBe(parseCaBuffer(Buffer.from(FIXTURE_PEM)).pem)
  })

  it('throws a readable error on non-certificate input', () => {
    expect(() => parseCaBuffer(Buffer.from('this is not a certificate'))).toThrow(/not a valid certificate/i)
  })

  it('throws on an empty buffer', () => {
    expect(() => parseCaBuffer(Buffer.alloc(0))).toThrow(/not a valid certificate/i)
  })
})

describe('readCaFile', () => {
  it('reads and parses via the injected reader', () => {
    const info = readCaFile('C:/burp.cer', () => Buffer.from(FIXTURE_PEM))
    expect(info.commonName).toBe('Test Fixture CA')
  })

  it('reports the path when the file cannot be read', () => {
    expect(() => readCaFile('C:/missing.cer', () => { throw new Error('ENOENT') }))
      .toThrow(/C:\/missing\.cer/)
  })
})
