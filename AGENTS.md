# SlopLens agent guide

## Purpose and current result

SlopLens is a local browser dashboard for developers reviewing projects associated with coding-agent sessions. The current Windows release reads Codex and Claude Code history, groups sessions by recorded working directory or Git root, and shows activity, source size, languages, models, tokens, time, and dated API price equivalents. Its Review page provides a deterministic inspection queue and optional, one-project-at-a-time Jev assessment. It does not decide whether past effort was worthwhile.

Keep the next change a complete, demonstrable slice. Start with the user-visible result and its verification; update `CURRENT_MILESTONE.md` and a single plan file. Finish that slice before expanding the source list or architecture. The completed and proposed plans are indexed in [`plans/README.md`](plans/README.md).

The larger vision is a cross-agent project dashboard that helps a developer choose what to finish, archive, or stop intentionally. Preserve new ideas in `BACKLOG.md` or a separate plan. A new integration or rewrite needs a concrete blocker or verified user need; do not replace a working path merely because a new approach is attractive. If a project seems stale, identify its working state and closest demonstrable finish line before recommending finish, archive, or stop. A new standalone product needs a short start gate: problem, first user, first useful action, demo, exact release finish line, and why the feature does not belong in an existing product.

## Working map

| Area | File | Responsibility |
| --- | --- | --- |
| Local HTTP server | `server/index.ts` | Loopback API, refresh, review requests, static build |
| History parsing | `server/parse.ts` | Separate Codex and Claude Code JSONL handling |
| Project aggregation | `server/projects.ts` | Path grouping, session summaries, source scan |
| Price table | `server/pricing.ts` | Dated public API rates and token categories |
| Optional assessment | `server/review.ts` | Bounded document preview and Jev request |
| UI | `src/main.tsx`, `src/review.ts`, `src/types.ts` | Pages, review priority, shared data shapes |
| Styling | `src/style.css`, `src/dark.css`, `src/layout.css` | Layout and theme |
| Tests | `tests/` | Parsing, aggregation, pricing, review behavior |

The browser uses Vite and React; the API uses Node and TypeScript. The dev UI is on `127.0.0.1:4380`, and the local API and built app are on `127.0.0.1:4381`. Read [`README.md`](README.md) for exact run commands. The server must remain bound to loopback; state-changing requests must retain same-origin checks.

The visual direction is calm and editorial: washed charcoal and warm off-white, restrained faded blue and coral accents, generous type, compact headings, restrained charts, and plainly labeled data. Dark mode is the default with a saved light choice. Keep information and controls visible at narrow widths; decoration must not displace project data.

## Data meanings that must remain explicit

- A **project agents worked on** is inferred from a session's recorded working directory. Use the Git root when available and merge equivalent Windows paths. This does not prove an agent created a repository or changed every file.
- Show last agent activity and last Git commit as separate dates. Missing or deleted folders retain historical sessions and show unavailable current code metrics.
- Source size means **nonblank lines** in current recognized, nonignored source and configuration files. Comments count. Mark bounded or inaccessible scans partial; do not turn them into exact totals.
- Count distinct sessions per project and provider. Difference Codex cumulative usage counters; deduplicate Claude Code assistant message usage. Preserve input, cached input, cache writes, and output where recorded. Unknown model or absent usage remains unknown.
- Price is a dated **standard public API price equivalent**, never billed spend. Keep prices and their source date in `server/pricing.ts`. Show a partial estimate and unpriced token count when usage cannot all be priced. Do not convert unknown to zero or imply a complete total.
- Observed active agent time uses bounded turns or requests and may be partial. Session span is first-to-last recorded event and includes idle gaps. Neither is human coding time.

## Review and decision boundaries

The review priority is a queue for inspection: age of last agent activity multiplied by capped, recorded effort from active time, tokens, and session count. It is not a future-value score. Sunk cost alone is never a reason to continue a project. The optional Jev score concerns clarity of a bounded next release and evidence that it serves the stated goal; it must ignore past effort and dollar estimates. Display confidence and source limitations.

Jev runs only after a deliberate click for one project. Preview the exact document excerpts and goal before a request. The current server reads only top-level milestone, project-state, and README documents with a total character cap; it never sends session transcripts or source files. Reviews are in memory and clear on restart or refresh. No automatic bulk assessment or retry. Any future document source or transmission change needs a specific user-visible preview and verification.

## Privacy and repository hygiene

- Read local history without modifying it. Keep session content local and out of UI responses, logs, fixtures, documentation, and Git.
- Keep API keys in the ignored `.env.local` or server process environment. Never put a real value in source, browser code, tests, plans, screenshots, tool output, or commits. Document variable names and placeholders only.
- Treat document excerpts as potentially private. Do not copy real project text into plans or bug reports. Avoid personal names, account handles, absolute machine paths, real repository names, session IDs, exact private usage figures, or identifying screenshots in `AGENTS.md`, `CURRENT_MILESTONE.md`, `BACKLOG.md`, `plans/`, and any future PRD.
- Do not commit `node_modules/`, `dist/`, `.env*` secrets, session logs, or generated local data. Review an explicit staged-file allowlist and scan for identifiers and credentials before committing. In a dirty worktree, protect unrelated work; never reset, stash, clean, or broadly format it.
- A private repository reduces exposure but does not make committed sensitive material safe. Changes to current files do not erase older Git history.

## Development and finish line

Use `npm.cmd install` then `npm.cmd run dev` on Windows. For a change, run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`; verify the affected route in a real browser at desktop and narrow widths, including theme behavior when styling changes. Check error states and console output. Update run instructions when commands or ports change. Stop optional testing once the actual risk is covered.

Before a release, inspect the staged diff, run `git diff --cached --check`, confirm ignored local secrets are absent, and commit only reviewed files. If a push is requested or already authorized for the release, verify local `HEAD`, the tracking branch, and the remote branch point to the same commit. Report what is implemented, verified, partial, or unavailable.

## Scope

This release is local, single-user, and Windows-verified. Cloud sync, accounts, GitHub data access, billing reconciliation, packaged installers, and more agent sources are future work. Add one source only after its real log semantics can be validated. Prefer a small end-to-end addition over a generic plugin system.
