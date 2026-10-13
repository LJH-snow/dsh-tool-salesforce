import { URL } from 'node:url'
import { assertSafeSalesforceUrl, normalizeInstanceUrl, type LookupImpl } from './url-security.js'

const DEFAULT_API_VERSION = 'v67.0'
const MAX_RECORDS = 50
const MAX_RESPONSE_BYTES = 1_000_000
const ACCOUNT_FIELDS = ['Id', 'Name', 'Type', 'Industry', 'Website', 'Phone', 'BillingCity', 'BillingState', 'BillingCountry', 'LastModifiedDate'] as const

export interface SalesforceClientOptions {
  accessToken?: string
  token?: string
  instanceUrl?: string
  apiVersion?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  lookupImpl?: LookupImpl
}

export interface SalesforceAccount {
  id: string
  name: string
  type: string
  industry: string
  website: string
  phone: string
  billingCity: string
  billingState: string
  billingCountry: string
  lastModifiedDate: string
}

export interface SalesforceAccountPage {
  totalSize: number
  done: boolean
  offset: number
  records: SalesforceAccount[]
}

export class SalesforceError extends Error {
  constructor(message: string, public readonly status = 0, public readonly code = 'request_failed') {
    super(message)
    this.name = 'SalesforceError'
  }
}

type JsonRecord = Record<string, unknown>
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function boundedString(value: unknown, max = 240): string { return typeof value === 'string' ? value.slice(0, max) : '' }
function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback
}

function accountFrom(value: unknown): SalesforceAccount {
  const row = asRecord(value)
  return {
    id: boundedString(row.Id, 18),
    name: boundedString(row.Name),
    type: boundedString(row.Type, 80),
    industry: boundedString(row.Industry, 120),
    website: boundedString(row.Website, 512),
    phone: boundedString(row.Phone, 80),
    billingCity: boundedString(row.BillingCity, 120),
    billingState: boundedString(row.BillingState, 120),
    billingCountry: boundedString(row.BillingCountry, 120),
    lastModifiedDate: boundedString(row.LastModifiedDate, 80),
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new SalesforceError('Salesforce response exceeded the size limit.', response.status, 'response_too_large')
    return text
  }

  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new SalesforceError('Salesforce response exceeded the size limit.', response.status, 'response_too_large')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }

  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(data)
}

export class SalesforceClient {
  private readonly accessToken?: string
  private readonly instanceUrl?: string
  private readonly instanceUrlInvalid: boolean
  private readonly apiVersion: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly lookupImpl?: LookupImpl

  constructor(options: SalesforceClientOptions = {}) {
    this.accessToken = options.accessToken?.trim() || options.token?.trim() || process.env.SALESFORCE_ACCESS_TOKEN?.trim() || undefined
    const configuredUrl = options.instanceUrl?.trim() || process.env.SALESFORCE_INSTANCE_URL?.trim() || undefined
    try {
      this.instanceUrl = configuredUrl ? normalizeInstanceUrl(configuredUrl) : undefined
      this.instanceUrlInvalid = Boolean(configuredUrl) && !this.instanceUrl
    } catch {
      this.instanceUrl = undefined
      this.instanceUrlInvalid = true
    }
    this.apiVersion = (options.apiVersion ?? DEFAULT_API_VERSION).trim()
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.min(120_000, Math.max(250, Math.trunc(options.timeoutMs ?? 30_000))) : 30_000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.lookupImpl = options.lookupImpl
  }

  hasCredentials(): boolean { return Boolean(this.accessToken) }
  isConfigured(): boolean { return Boolean(this.accessToken && this.instanceUrl && !this.instanceUrlInvalid) }

  async authTest(signal?: AbortSignal): Promise<{ ok: true; status: number; apiVersion: string }> {
    const response = await this.request('limits', undefined, signal, false)
    return { ok: true, status: response.status, apiVersion: this.apiVersion }
  }

  async listAccounts(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<SalesforceAccountPage> {
    const limit = this.boundedLimit(options.limit)
    const offset = this.boundedOffset(options.offset)
    const fields = ACCOUNT_FIELDS.join(', ')
    const soql = 'SELECT ' + fields + ' FROM Account ORDER BY Name ASC LIMIT ' + limit + ' OFFSET ' + offset
    const data = await this.request('query', new URLSearchParams({ q: soql }), options.signal)
    const records = asArray(data.data.records).slice(0, limit).map(accountFrom)
    return {
      totalSize: Math.min(nonNegativeInt(data.data.totalSize, records.length), 2_147_483_647),
      done: data.data.done === true,
      offset,
      records,
    }
  }

  async getAccount(id: string, signal?: AbortSignal): Promise<SalesforceAccount | null> {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id)) {
      throw new SalesforceError('Account ID must contain 15 or 18 alphanumeric characters.', 0, 'invalid_input')
    }
    const fields = ACCOUNT_FIELDS.join(', ')
    const soql = 'SELECT ' + fields + " FROM Account WHERE Id = '" + id + "' LIMIT 1"
    const data = await this.request('query', new URLSearchParams({ q: soql }), signal)
    const row = asArray(data.data.records)[0]
    return row === undefined ? null : accountFrom(row)
  }

  private boundedLimit(value: number | undefined): number {
    return Number.isInteger(value) && value !== undefined ? Math.max(1, Math.min(MAX_RECORDS, value)) : 25
  }

  private boundedOffset(value: number | undefined): number {
    return Number.isInteger(value) && value !== undefined ? Math.max(0, Math.min(2_000, value)) : 0
  }

  private async request(path: string, query?: URLSearchParams, callerSignal?: AbortSignal, parseJson = true): Promise<{ status: number; data: JsonRecord }> {
    if (!this.accessToken) throw new SalesforceError('Salesforce access token is not configured.', 0, 'missing_credentials')
    if (this.instanceUrlInvalid) throw new SalesforceError('Salesforce instance URL is invalid.', 0, 'unsafe_url')
    if (!this.instanceUrl) throw new SalesforceError('Salesforce instance URL is not configured.', 0, 'missing_instance_url')
    if (!/^v[0-9]{1,3}\.[0-9]$/.test(this.apiVersion)) throw new SalesforceError('Salesforce API version is invalid.', 0, 'invalid_configuration')

    const target = new URL('/services/data/' + this.apiVersion + '/' + path, this.instanceUrl)
    if (query) target.search = query.toString()
    try {
      await assertSafeSalesforceUrl(target, this.lookupImpl)
    } catch {
      throw new SalesforceError('Salesforce destination failed the URL safety check.', 0, 'unsafe_url')
    }

    const controller = new AbortController()
    const abort = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) controller.abort(callerSignal.reason)
    else callerSignal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(target, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer ' + this.accessToken },
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new SalesforceError('Salesforce request failed (' + response.status + ').', response.status, 'http_error')
      }
      if (!parseJson) {
        await response.body?.cancel().catch(() => undefined)
        return { status: response.status, data: {} }
      }

      const text = await readBoundedText(response)
      if (!text) return { status: response.status, data: {} }
      try {
        return { status: response.status, data: asRecord(JSON.parse(text)) }
      } catch {
        throw new SalesforceError('Salesforce returned invalid JSON.', response.status, 'invalid_json')
      }
    } catch (error) {
      if (error instanceof SalesforceError) throw error
      if (controller.signal.aborted) throw new SalesforceError('Salesforce request was cancelled or timed out.', 0, 'aborted')
      throw new SalesforceError('Salesforce request failed.', 0, 'network_error')
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abort)
    }
  }
}
