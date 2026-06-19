# Release Notes

## Unreleased - 2026-06-19 06:57 +07

Generated before push from commits:

- `569d7ac` Remove tracked backup files

## Unreleased - 2026-06-19

- Fixed the API Keys dashboard so it uses resolved credential API-key stats instead of endpoint names such as `responses`, `completions`, or `*action`.
- Prevented raw API keys from being displayed in collector output, preferring alias/name/label and falling back to a short SHA-256 label.
- Added collector diagnostics for missing CPA-Manager `usage.sqlite` mounts so production deploys no longer silently fall back to hash-only API-key labels.
- Removed committed conflict markers from the collector, dashboard, and compose configuration so the project builds cleanly again.

## Unreleased - 2026-06-06 16:13 +07

Generated before push from commits:

- `1e8e825` Document release notes push policy
