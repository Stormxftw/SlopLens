# 008 — Review explanation

## Objective

Make the existing portfolio judgments understandable to a person making a project decision, while keeping every claim tied to the supplied notes.

## Visible result

After a single preview approval, Review selects the strongest current notes, runs typed Jev judgments, validates a citation for each dimension, and builds a plain-language explanation. It shows the recorded next action when available. No manual labeling, per-project approvals, or second assistant is required. The numeric rubric, source evidence, and optional assistant export remain in details.

## Acceptance checks

- A project with no safe overview note is described as lacking evidence, even when Jev returns a high confidence value for a low score.
- Current next steps and open acceptance items must survive a long document; safe lines up to 1,200 characters retain their full text. Headings provide context and consume no excerpt slots. Deep packages include all base excerpts.
- Source IDs must belong to the actual request. Each dimension requires an eligible citation and sufficient citation confidence; rating confidence separately gates finish recommendations. Uncertainty about rating strength must not erase a clearly cited fact. Future ideas, operating policies, and unchecked tasks cannot prove existing output.
- A project without a checked output or use-case citation cannot enter the possible-leads list. Finish candidates need all three dimensions; lead order uses the documented forward weights after finish status.
- A negative candidate requires a high-confidence blocker judgment and a clear, non-negated, cited concern.
- The v2 rubric invalidates prior cached judgments. Unchanged v2 inputs reuse results; explanations are reconstructed, never persisted as source text.
- Projects without eligible notes are handled locally with no remote call and no displayed numeric rating.
- A failed deeper review retains its successful first assessment. Retry controls target only failed projects or failed expansions.
- The assistant brief includes ratings, uncertainty, gaps, and selected excerpts, but no project name, path, session ID, transcript, or tool content.
- Typecheck, tests, build, and desktop/narrow browser checks pass.

## Limits

The explanation uses deterministic wording and exact excerpts. It checks evidence existence and eligibility, not real-world truth. It does not run project code or tests. Jev confidence comes from its answer distribution; this rubric has not been calibrated against known outcomes. Repeating identical input is not treated as extra evidence. A second model provider remains optional future work. Automatic screening cannot prove arbitrary Markdown private-data-free; the single visible batch preview remains the final transmission check.

## Implementation record

- `server/portfolio-review.ts`: prioritize current evidence; preserve heading context; screen full lines and recognized local identifiers; add three typed citation questions and a local empty-evidence result.
- `src/evidence-quality.ts`: validate role eligibility and resolve citations against the actual base/deep request.
- `src/review-language.ts`: turn validated metadata into supported findings and one next move with an exact citation.
- `server/review-batch.ts`: metadata cache v2, zero-call evidence gaps, saved base results after failed expansion.
- `src/PortfolioReviewView.tsx`: show the explanation directly; group retries; keep evidence, ratings, and assistant export optional.
- `tests/portfolio.test.ts`: synthetic regression cases for missed late tasks, long safe notes, privacy, invalid IDs, contradictory roles, confidence, cache, and partial failures.
- `README.md`: a rendered Mermaid rubric graphic documents the three 0–3 scales, 40/35/25 weighting, citation checks, classification thresholds, and the separate attention order.
- `server/jev-key.ts`, `server/jev-settings.ts`, `src/JevKeySettings.tsx`: the requested in-app Jev key setup uses Windows current-user DPAPI, never returns saved secrets, explains storage/fallback, and provides replace/remove/authentication-test actions.
- `tests/jev-key.test.ts`: synthetic lifecycle and HTTP protection cases plus an actual Windows DPAPI round trip. Existing plain-text environment-file setup stays explicit and unchanged.

## Verification completed

- Typecheck, production build, and all 22 tests passed, including actual DPAPI, key replacement/removal, corrupt-key handling, provider-error redaction, and same-origin settings protections.
- The built key settings passed desktop (1440px) and narrow (390px) browser checks in both themes. An isolated fixture used actual Windows encryption and synthetic credentials to verify save, replacement, persistence after reload, removal, cleared input, and absence from browser storage. Its simulated provider rejection displayed a clear error. The live app separately authenticated with the existing configuration; a synthetic invalid credential was rejected by the real service. No project evidence was sent by these connection tests.
- The README Mermaid rubric was rendered and visually checked for readable labels and agreement with the implemented thresholds.
- One indexed project completed base and automatic deep assessment with the live Jev service. Three cited dimensions were explained automatically; uncertain rating strength kept the project in investigate.
- A batch of projects with no eligible notes completed locally with zero model calls. Metadata-only cache contents were inspected.
- The live project result was reused after a server restart. A changed-input preview remained invalidated.
- Same-origin rejection returned 403; a stale preview returned 409 before transmission.
- The built Review route was exercised at 1440px and 390px, including light and dark themes, evidence disclosure, and the optional export. A cramped next-action layout was corrected. No horizontal overflow or browser console errors remained on the final page.
- These checks verify the automated workflow. They do not establish outcome-level accuracy across the portfolio or independently verify the reviewed project's runtime.
