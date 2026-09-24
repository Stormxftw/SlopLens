# 007 — Portfolio Jev review and ranking

**Status:** Implemented; live Jev batch acceptance awaits a user click.

## Problem and first useful action

The one-project assessment left most projects unassessed and made past effort hard to separate from future opportunity. In Review, inspect a single batch preview and click Analyze all to assess every indexed project.

## Included

- A deterministic review-urgency queue based on age and recorded time, tokens, and sessions; dated API price equivalents remain context, not billed cost.
- Structured tool-category and delegation counts, without session text or tool arguments and outputs.
- Screened excerpts from milestone, project-state, README, AGENTS, backlog, and bounded plan documents. Missing and excluded evidence is explicit.
- One compact Jev request per changed project. An inconclusive result can use a larger request only when more safe evidence was omitted. Every possible request is previewable before the batch begins.
- Typed judgments for working output, next-release clarity, use-case evidence, blockers, effort context, and selected supporting or concerning excerpts. Forward candidates, investigate, and deprioritize suggestions remain advisory.
- Bounded batch concurrency, progress and per-project failures, same-origin writes, and an ignored local cache containing results and fingerprints without source excerpts.

## Finish line and evidence

Typecheck, tests, and production build pass. Tests cover privacy filtering, tool-call deduplication, thin evidence, response validation, partial batch success, reuse, and invalidation. A live local index and browser preview show the full batch before transmission. No agent-initiated live Jev batch was sent.

## Boundary

No automatic archive, trading or financial prediction, raw transcript or source transmission, subscription billing claim, or automatic background Jev calls. Automated screening is conservative but cannot recognize every private detail in arbitrary notes; the exact request preview remains the final user check.
