# 004 — Explicit summary for a project without overview documents

**Status:** Proposed next release; not implemented.

## Problem and first useful action

Some older projects have no readable top-level overview. In Review, select one such project, enter a short next-release summary, inspect the exact payload preview, and request one Jev assessment.

## Finish line

- The summary is entered for one selected project and is shown in full before transmission.
- The server accepts a bounded summary only after the explicit review action; validation explains empty or oversized input.
- The result identifies that the assessment used a user-written summary, not repository evidence. Confidence and evidence limits remain visible.
- A goal or summary change invalidates the old result until reassessment.
- Typecheck, focused tests, build, and desktop/narrow browser flow pass.

## Boundary

No automatic summary generation, transcript access, bulk requests, or permanent storage. Never copy the real summary into fixtures, plans, logs, or Git.
