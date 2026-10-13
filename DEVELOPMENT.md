# Development

Run npm ci --ignore-scripts, npm run typecheck, npm run build, and npm pack --dry-run from this package directory.

The client accepts injected fetchImpl and lookupImpl functions. Local checks should use synthetic Salesforce responses and public-address DNS fixtures; do not use credentials from a real organization.

## Publishing

The package is prepared for GitHub Actions Trusted Publishing from `vX.Y.Z` tags. Configure the npm trusted publisher for `LJH-snow/dsh-tool-salesforce` and the workflow filename `publish-npm.yml`; the workflow uses GitHub OIDC and does not store an npm token. The GitHub repository must exist before this publisher can run.
