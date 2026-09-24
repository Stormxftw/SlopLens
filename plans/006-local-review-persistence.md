# 006 — Local review persistence

**Status:** Superseded by 007. The portfolio review now stores only result metadata and evidence fingerprints locally.

## Problem and first useful action

If repeated on-demand reviews prove useful, restarting the local server should not erase a still-relevant assessment. Reopen one reviewed project and see the result only while its goal and evidence match the saved assessment.

## Finish line

- Store only the minimum local review metadata needed for this workflow; do not store document excerpts, source text, transcripts, or credentials.
- Fingerprint the goal and previewed evidence. Mark a saved result stale when either changes, and require an explicit click to reassess.
- Provide a clear local removal path and test restart, stale-result, and invalid-data behavior.

## Boundary

No cloud sync, accounts, background assessments, or analytics database. This plan should begin only after a user confirms persistence is worth the added privacy and maintenance cost.
