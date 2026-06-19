# Release Notes

## Unreleased - 2026-06-19 07:45 +07

Generated before push from commits:

- `32c420b` Clarify GitHub release notes workflow

## Unreleased - 2026-06-19 07:40 +07

- Added collector health diagnostics for the CPA-Manager `usage.sqlite` mount, including configured path, existence, and readability.
- Added warning/app-log visibility when `CPA_USAGE_DB_PATH` is configured but unreadable, so production no longer silently falls back to management API data.
- Documented the production `CPA_USAGE_DATA_DIR`/`CPA_USAGE_DB_PATH` setup needed to resolve API-key aliases from CPA-Manager SQLite.

## Unreleased - 2026-06-19 06:57 +07

Generated before push from commits:

- `569d7ac` Remove tracked backup files

## Unreleased - 2026-06-19

- Fixed the API Keys dashboard so it uses resolved credential API-key stats instead of endpoint names such as `responses`, `completions`, or `*action`.
- Prevented raw API keys from being displayed in collector output, preferring alias/name/label and falling back to a short SHA-256 label.
- Removed committed conflict markers from the collector, dashboard, and compose configuration so the project builds cleanly again.

## Unreleased - 2026-06-06 16:13 +07

Generated before push from commits:

- `1e8e825` Document release notes push policy
