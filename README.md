# @libai168/dsh-tool-salesforce

Read-only Salesforce REST tools for DeepSeek Harness. Configure an OAuth access token and its organization instance URL with SALESFORCE_ACCESS_TOKEN and SALESFORCE_INSTANCE_URL, or pass the same values in plugin configuration.

Tools:

- salesforce_auth_test checks the token through Salesforce's limits endpoint and returns only the HTTP status and API version.
- salesforce_accounts_list lists at most 50 Accounts with a fixed SOQL field list and an offset capped at 2,000.
- salesforce_account_get reads one Account using a validated 15- or 18-character record ID.

The plugin does not accept arbitrary SOQL, follow server-provided continuation URLs, or modify Salesforce data. Instance URLs must be HTTPS Salesforce organization hosts. Requests reject redirects and destinations resolving to private or reserved IP ranges.
