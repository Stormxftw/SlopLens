# 003 — SlopLens identity and compact layouts

**Status:** Shipped.

## Problem and first useful action

The dashboard needs to put project information ahead of decorative page banners. Open Overview, Review, or a project detail and see the relevant data near the top.

## Included

- SlopLens product name in the browser title, UI, package metadata, and documentation.
- Removal of oversized Overview, Review, and project-detail heroes; compact headings retain context.
- Tasteful charcoal dark mode by default and a saved light-mode choice, with responsive layouts. The palette uses warm off-white, washed charcoal, faded blue, and muted coral; large editorial type and restrained charts support clear data labels.

## Finish line and evidence

All three routes and both themes were visually checked at desktop and narrow widths. Navigation, no horizontal overflow, browser console, typecheck, tests, and production build passed. The source was committed and pushed to a private repository after an explicit staged-file review.

## Boundary

No redesign of metrics, ranking logic, agent adapters, or pricing semantics.
