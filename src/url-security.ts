import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { URL } from 'node:url'

export type LookupAddress = { address: string; family: number }
export type LookupImpl = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>

export class UrlSecurityError extends Error {
  constructor(message = 'Unsafe Salesforce destination.') {
    super(message)
    this.name = 'UrlSecurityError'
  }
}

function invalidInstanceUrl(): never {
  throw new UrlSecurityError('Invalid Salesforce instance URL.')
}

export function normalizeInstanceUrl(value?: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !/^https:\/\/[^/]/i.test(value)) {
    return invalidInstanceUrl()
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalidInstanceUrl()
  }

  const hostname = url.hostname.toLowerCase()
  const trustedSalesforceHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:salesforce\.com|salesforce\.mil)$/.test(hostname)
  if (url.protocol !== 'https:' || !trustedSalesforceHost || url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#') || !/^https:\/\/[a-z0-9.-]+\/?$/i.test(value)) {
    return invalidInstanceUrl()
  }

  return url.origin
}

function ipv4Number(value: string): number | undefined {
  if (isIP(value) !== 4) return undefined
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return parts.reduce((result, part) => result * 256 + part, 0) >>> 0
}

function ipv4InRange(value: number, start: number, prefix: number): boolean {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (start & mask)
}

const blockedV4: Array<[number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 4], [0xf0000000, 4],
]

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const value = ipv4Number(address)
    return value !== undefined && !blockedV4.some(([start, prefix]) => ipv4InRange(value, start, prefix))
  }
  if (family !== 6 || isIP(address) !== 6) return false

  let value: string
  try { value = new URL('https://[' + address + ']/').hostname.toLowerCase().replace(/^\[|\]$/g, '') }
  catch { return false }
  const secondGroup = value.split(':')[1] || '0'
  const secondGroupValue = Number.parseInt(secondGroup || '0', 16)
  if (value === '::' || value === '::1' || value.startsWith('::ffff:') || value.startsWith('::')
    || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith('ff')
    || (value.startsWith('2001:') && Number.isFinite(secondGroupValue) && secondGroupValue <= 0x1ff)
    || value.startsWith('2001:db8:')
    || value.startsWith('64:ff9b:') || value.startsWith('100:')) return false
  return true
}

export async function assertSafeSalesforceUrl(url: URL, lookupImpl: LookupImpl = async (hostname, options) => dnsLookup(hostname, options)): Promise<void> {
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:salesforce\.com|salesforce\.mil)$/.test(hostname)) {
    throw new UrlSecurityError()
  }

  const addresses = await lookupImpl(hostname, { all: true }).catch(() => { throw new UrlSecurityError() })
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(item => !item || isIP(item.address) !== item.family || !isPublicAddress(item.address, item.family))) {
    throw new UrlSecurityError()
  }
}
