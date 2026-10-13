import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SalesforceClient, SalesforceError } from './client.js'

export { SalesforceClient, SalesforceError } from './client.js'
export type { SalesforceAccount, SalesforceAccountPage, SalesforceClientOptions } from './client.js'

export const name = 'dsh-tool-salesforce'
export const inject = ['tools']

export interface SalesforcePluginConfig {
  accessToken?: string
  token?: string
  instanceUrl?: string
  apiVersion?: string
  timeoutMs?: number
}

export function apply(ctx: Context, config: SalesforcePluginConfig = {}) {
  for (const tool of createTools(new SalesforceClient(config))) ctx.tools.register(tool)
}

function text(value: string) { return [{ type: 'text' as const, text: value }] }
function errorMessage(error: unknown): string {
  return error instanceof SalesforceError ? error.message : 'Salesforce request failed.'
}
function boundedText(value: unknown): string { return String(value ?? '').slice(0, 240) }
function failedAccountPage(reason = 'Salesforce access token and instance URL are required.') {
  return { ok: false, reason, totalSize: 0, done: true, offset: 0, records: [] }
}

const accountProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  type: { type: 'string' },
  industry: { type: 'string' },
  website: { type: 'string' },
  phone: { type: 'string' },
  billingCity: { type: 'string' },
  billingState: { type: 'string' },
  billingCountry: { type: 'string' },
  lastModifiedDate: { type: 'string' },
} as const

function emptyAccount() {
  return { id: '', name: '', type: '', industry: '', website: '', phone: '', billingCity: '', billingState: '', billingCountry: '', lastModifiedDate: '' }
}

export function createTools(client: SalesforceClient) {
  return [
    defineTool({
      name: 'salesforce_auth_test',
      description: 'Verify Salesforce access using the limits endpoint without returning quota details.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, status: { type: 'integer' }, apiVersion: { type: 'string' } } },
        render: (_args, value) => value.ok ? text('Salesforce connection verified with API ' + boundedText(value.apiVersion) + '.') : text('Salesforce authentication failed: ' + boundedText(value.reason)),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Verify Salesforce connection', kind: 'read' } },
      async execute(_args, exec) {
        if (!client.isConfigured()) return { ok: false, reason: 'Salesforce access token and instance URL are required.', status: 0, apiVersion: '' }
        try { return { ...await client.authTest(exec?.signal), reason: '' } }
        catch (error) { return { ok: false, reason: errorMessage(error), status: error instanceof SalesforceError ? error.status : 0, apiVersion: '' } }
      },
    }),
    defineTool({
      name: 'salesforce_accounts_list',
      description: 'List a bounded page of Salesforce accounts using a fixed, read-only SOQL query.',
      parameters: {
        limit: { type: 'integer', description: 'Records to return, from 1 to 50; defaults to 25.' },
        offset: { type: 'integer', description: 'Records to skip, from 0 to 2000; defaults to 0.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, totalSize: { type: 'integer' }, done: { type: 'boolean' }, offset: { type: 'integer' }, records: { type: 'array', items: { type: 'object', additionalProperties: false, properties: accountProperties } } } },
        render: (_args, value) => !value.ok ? text('Salesforce account list failed: ' + boundedText(value.reason)) : text((value.records ?? []).map((item: { id?: string; name?: string; industry?: string }) => boundedText(item.name) + ' (' + boundedText(item.id) + ') ' + boundedText(item.industry)).join('\n') || 'No Salesforce accounts found.'),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Salesforce accounts', kind: 'search' } },
      async execute(args, exec) {
        if (!client.isConfigured()) return failedAccountPage()
        try { return { ok: true, reason: '', ...await client.listAccounts({ limit: args.limit as number, offset: args.offset as number, signal: exec?.signal }) } }
        catch (error) { return failedAccountPage(errorMessage(error)) }
      },
    }),
    defineTool({
      name: 'salesforce_account_get',
      description: 'Retrieve a single Salesforce account by a validated 15- or 18-character ID.',
      parameters: { accountId: { type: 'string', required: true, description: 'Salesforce Account record ID.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, found: { type: 'boolean' }, account: { type: 'object', additionalProperties: false, properties: accountProperties } } },
        render: (_args, value) => !value.ok ? text('Salesforce account lookup failed: ' + boundedText(value.reason)) : value.found ? text(boundedText(value.account?.name) + ' (' + boundedText(value.account?.id) + ') ' + boundedText(value.account?.industry)) : text('Salesforce account not found.'),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Get Salesforce account ' + boundedText(args.accountId), kind: 'read' } },
      async execute(args, exec) {
        if (!client.isConfigured()) return { ok: false, reason: 'Salesforce access token and instance URL are required.', found: false, account: emptyAccount() }
        try {
          const account = await client.getAccount(args.accountId as string, exec?.signal)
          return { ok: true, reason: '', found: account !== null, account: account ?? emptyAccount() }
        } catch (error) { return { ok: false, reason: errorMessage(error), found: false, account: emptyAccount() } }
      },
    }),
  ]
}
