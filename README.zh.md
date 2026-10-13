# @libai168/dsh-tool-salesforce

面向 DeepSeek Harness 的 Salesforce REST 只读工具。配置 OAuth access token 和其组织实例地址：SALESFORCE_ACCESS_TOKEN、SALESFORCE_INSTANCE_URL；也可以在插件配置中传入。

工具：

- salesforce_auth_test：通过 Salesforce limits 端点检查令牌，只返回 HTTP 状态和 API 版本，不返回配额详情。
- salesforce_accounts_list：使用固定 SOQL 字段列表读取 Account，每次最多 50 条，offset 限制在 0 到 2000。
- salesforce_account_get：通过校验过的 15 或 18 位记录 ID 查询单个 Account。

插件不接受任意 SOQL，不跟随服务端分页 URL，也不修改 Salesforce 数据。实例 URL 必须是 HTTPS Salesforce 组织主机；请求拒绝重定向、私有地址和保留地址。
