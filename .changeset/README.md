# Changesets

Run `npm run changeset` from the repository root for user-facing changes to
`iconsmith`. Select the package and describe the change. Documentation and release
infrastructure changes can use `npm run changeset -- --empty`.

Commit the changeset with the change. Do not bump package versions or run
`changeset:version` locally: CI consumes changesets in a Version Packages PR,
updates the npm lockfile, and publishes after that PR merges.

The initial npm release is 0.1.0. This infrastructure setup does not require a
new package version.

## Trusted publishing setup

In npm's iconsmith package settings, register GitHub Actions as the trusted
publisher: owner `mblode`, repository `iconsmith`, workflow `npm-publish.yml`.
No environment is configured. GitHub must allow Actions to create pull requests.
The workflow uses OIDC; no npm token is required.
