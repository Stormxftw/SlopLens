# Current Milestone

**Goal:** Configure Jev safely in the app and complete project review automatically after one batch approval.

**User-visible result:** Analyze all selects relevant notes, assesses projects, checks citations, and presents a readable explanation and a recorded next step. Missing evidence and failed deeper calls are handled without a manual scorecard or assistant handoff.

## Completion checklist

- [x] Current actions, open acceptance, and long safe notes reach the bounded preview
- [x] Each rating has a checked citation and an automatic explanation
- [x] Empty evidence uses no remote call; failed expansion preserves the base result
- [x] Regression tests, typecheck, and build pass
- [x] A bounded live assessment and desktop/narrow browser workflow pass
- [x] README explains the grading rubric with a graphic matched to the implemented rules
- [x] In-app key entry uses Windows encryption and explains storage, replacement, removal, and fallback
- [x] Key lifecycle, actual DPAPI, redacted connection testing, and origin protections pass automated tests
- [x] Key settings are verified in the browser at desktop and narrow widths

**Release closeout:** The automatic review and encrypted key settings are released. The README rubric rendering correction uses a self-contained SVG, keeps editable Mermaid source, and moves detailed scoring scales into a text table. It is verified at README and narrow widths in light and dark surroundings. Local caches, credentials, and identifying screenshots stay excluded.

**Not part of this milestone:** A second model provider, autonomous code execution in other projects, scheduled background calls, or automatic archive decisions.

**Previous milestones:** See the plan index. The old unscreened one-project send endpoint was retired; all live Jev requests use the previewed batch path.
