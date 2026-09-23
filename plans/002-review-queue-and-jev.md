# 002 — Review queue and optional Jev assessment

**Status:** Shipped.

## Problem and first useful action

Old projects with substantial recorded effort can be hard to triage. Open Review to sort by age and recorded effort, then choose one project and decide whether its next small release is clear enough to pursue.

## Included

- A deterministic review priority using age of last agent activity and capped observed effort from active time, tokens, and session count. This orders an inspection queue; it does not estimate future value.
- An explicit goal field and exact document preview for one project. The user initiates one Jev request with a click. Only top-level overview documents, capped in length, are sent; session transcripts and source files are excluded.
- Jev scores release clarity and evidence for the stated goal, with confidence. It ignores prior cost and effort. Only assessed projects appear in the Jev-ranked view.
- Input validation, same-origin request checks, no automatic retry, and in-memory results that clear on restart or refresh.

## Finish line and evidence

The queue, preview, one-project request, result display, invalid-input path, typecheck, tests, build, and desktop/narrow navigation were verified. Live assessments were exercised against local projects, but their names, excerpts, scores, and usage are intentionally omitted here.

## Boundary

No automatic bulk calls, permanent review storage, market-demand prediction, or recommendation based on sunk cost. API price equivalents remain context only.
