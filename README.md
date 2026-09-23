# SlopLens — Agent Project Dashboard

SlopLens is a local browser dashboard for projects worked on by Codex and Claude Code. It reads their local JSONL history and the current project folders. Session transcripts stay local. The optional Jev review sends only the goal, basic project metadata, and document excerpts shown in the Review view when you click **Analyze with Jev**.

For development guidance and release history, see [`AGENTS.md`](AGENTS.md) and the [`plans/` index](plans/README.md). The configured Git remote identifies the private source repository.

## Run on Windows

Requires Node.js 20 or newer and Git on your PATH. From this folder in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:4380**. The first scan may take around a minute on a large history; progress appears in the UI. Press **Refresh** to rescan after new agent work. `Ctrl+C` stops the local servers.

The dashboard opens in a charcoal dark theme. Use the sun/moon button in the header to switch themes; the choice is saved in this browser. Overview, Review, and project detail use compact headings so the project data appears near the top.

Open **Review** to see a deterministic queue ordered by age multiplied by recorded effort. This is a priority for deciding what to inspect, not a recommendation to keep working. The queue uses the last agent activity, bounded active agent time, token records, and distinct session count. Missing usage can understate effort. Dollar equivalents are displayed for context but never used as a reason to continue.

To enable the optional Jev assessment, put `TYPESAFE_API_KEY=...` in this app's `.env.local` (Git ignored) or set it in the server process environment. Select one project, read the exact excerpts shown, edit the goal, then click **Analyze with Jev**. The app reads only top-level `CURRENT_MILESTONE.md`, `PROJECT_STATE.md`, and `README.md`, capped at 5,600 characters total; no session transcripts or source files are sent. Jev scores next-release clarity and evidence for the goal. Only assessed projects enter the **Jev assessed** ranking. Results remain in memory until the local server restarts or you press Refresh, and changing the goal requires reassessment. Each click makes one API request and may consume TypeSafe credits. [TypeSafe API documentation](https://docs.typesafe.ai/api).

For a production build:

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4381** for the built version. Only `127.0.0.1` is used.

## What the numbers mean

- **Project association:** A session belongs to the working directory recorded by its agent. If that directory is inside a Git repository, SlopLens groups it under the repository root. This indicates work associated with a project, not proof that an agent created it or edited every file there.
- **Last activity / last commit:** The latest local agent event and latest Git commit are separate dates.
- **Source lines:** Nonblank lines in current recognized source and config files. Comments count. Git repositories include tracked and untracked nonignored files. Generated folders, lockfiles, binary files, large files, and unknown file types are excluded. Bounded or inaccessible scans are marked partial; deleted folders retain history but have no current code count.
- **Sessions and tokens:** Unique session IDs per provider and project. Codex cumulative token counters are differenced; repeated Claude message snapshots are deduplicated. Input, cache, and output tokens are separated where records permit. Missing usage is marked, not turned into zero.
- **Time:** Observed active agent time sums bounded Codex tasks and Claude Code requests. Incomplete turns make it a lower bound. Session span runs from the first to the last recorded event and includes idle gaps; it is not human coding time.
- **USD:** A dated API price equivalent for priced model tokens, **not actual billed spend**. Rates are in [`server/pricing.ts`](server/pricing.ts) and came from [OpenAI](https://developers.openai.com/api/docs/pricing) and [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) public standard rates on September 23, 2026. Subscription fees, discounts, alternate service tiers, tool fees, and unpriced models are outside the estimate. `From` means a partial estimate; `Unpriced` or `Unknown` means no dollar total can be inferred.

The app reads `%USERPROFILE%\.codex\sessions` and `%USERPROFILE%\.claude\projects` by default. For fixture-based testing, override `AGENT_DASH_CODEX_DIR` and `AGENT_DASH_CLAUDE_DIR` before starting the server. Its APIs are `GET /api/projects`, `GET /api/projects/:id`, `GET /api/status`, same-origin `POST /api/refresh`, `GET /api/reviews`, `GET /api/review/:id`, and same-origin `POST /api/review/:id` with JSON `{ "goal": "..." }`.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The tests cover both log formats, repeated usage records, unknown prices, missing usage, incomplete timing, source counting in ordinary and Git folders, review ranking, bounded document preview, and Jev response validation.

## Known limits

Windows is the verified platform. Older or unusual log formats may lack usage or model data. SlopLens does not read billing accounts, remote/cloud agent runs, or other agents. Large project scans are bounded and visibly marked partial.
