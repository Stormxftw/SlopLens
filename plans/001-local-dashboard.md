# 001 — Local agent project dashboard

**Status:** Shipped as the first local release.

## Problem and first useful action

Developers using coding agents need one place to inspect which local projects have agent activity and how much recorded work each contains. Run the app on loopback, open the dashboard, and inspect one real project. This release serves one local Windows user through a browser.

## Included

- Read Codex and Claude Code JSONL with separate adapters. Associate events with recorded working directories, resolve Git roots where present, and merge equivalent Windows paths. Call the results *projects agents worked on*.
- Show last agent event and last Git commit separately; count distinct sessions and model usage per project.
- Scan current nonignored recognized source files for languages and nonblank lines. Retain history but mark code metrics unavailable for missing folders; mark bounded scans partial.
- Calculate token categories from Codex counter changes and deduplicated Claude assistant messages. Leave absent usage and unknown models unknown.
- Show dated public API price equivalents, including partial estimates and unpriced tokens. Never present this as billed spend.
- Separate observed active agent time from first-to-last session span, including idle gaps; mark incomplete timing partial.
- Provide searchable, sortable project cards, detail pages, a session table, and local refresh through `GET /api/projects`, `GET /api/projects/:id`, and `POST /api/refresh`.

## Finish line and evidence

`npm.cmd install` and `npm.cmd run dev` start the local app. Both source adapters, metric edge cases, typecheck, tests, build, refresh, desktop, and narrow layouts were verified before release. Source records were checked locally without copying identifiers or private figures into this plan.

## Boundary

No accounts, cloud sync, GitHub API, billing reconciliation, installer, or additional agent source.
