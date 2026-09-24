import type { Evidence, PortfolioReview, ReviewPackage } from '../server/portfolio-review.ts';

export type ReviewDimension = 'workingOutput' | 'nextRelease' | 'useCase';
type Note = { text: string; source: string; section?: string };

export function isFutureNote(note: Note): boolean {
  return note.source === 'BACKLOG.md' || /\b(?:backlog|future|vision|not (?:part|included)|out of scope|archived|historical)\b/i.test(note.section ?? '');
}

export function isNavigation(text: string): boolean {
  return /^(?:[-*]\s*|\d+[.)]\s*)?`?(?:open|read|see|click|go to|refer to|start with|follow|npx|npm|pnpm|yarn|node|python|git)\b/i.test(text)
    || /^\s*(?:```|\|?\s*[-:]{3,})/.test(text);
}

export function isOpenItem(note: Note): boolean {
  return !isFutureNote(note) && /^[-*]\s+\[ \]/.test(note.text);
}

export function isNextAction(note: Note): boolean {
  return !isFutureNote(note) && !/^[-*]\s+\[x\]/i.test(note.text)
    && /\b(?:next (?:action|step|move)|immediate (?:action|priority))\b/i.test(note.text + ' ' + (note.section ?? ''));
}

/** A local eligibility check. The typed model judgment still decides relevance. */
export function eligibleForDimension(note: Note, dimension: ReviewDimension): boolean {
  if (note.source === 'AGENTS.md' || isFutureNote(note) || isNavigation(note.text) || note.text.length < 25) return false;
  if (dimension === 'nextRelease') return isNextAction(note) || isOpenItem(note)
    || /\b(?:next|current|small|bounded) (?:release|milestone|deliverable)|\b(?:finish line|acceptance|remaining|blocker)\b/i.test(note.text + ' ' + (note.section ?? ''));
  if (dimension === 'workingOutput') return !isOpenItem(note)
    && !/\b(?:not (?:yet )?(?:working|implemented|tested|verified)|will|planned|should|must|needs? to|to do)\b/i.test(note.text)
    && /\b(?:working|verified|tested|passed|shipped|released|implemented|deployed|completed|works|supports)\b|\[x\]/i.test(note.text);
  return /\b(?:(?:user|customer|designer|developer|player|creator|writer|student|team)s?|audience|use case|purpose)\b/i.test(note.text)
    && !/\b(?:no (?:known |distinct )?(?:user|use case)|user unknown)\b/i.test(note.text);
}

/** Never resolve a base answer against excerpts that only appeared in the deep preview. */
export function reviewedEvidence(review: PortfolioReview, pkg: ReviewPackage | null): Evidence[] {
  if (!pkg || pkg.fingerprint !== review.fingerprint) return [];
  return (review.mode === 'deep' && pkg.deep ? pkg.deep : pkg.base).state.evidence as Evidence[];
}

export function auditEvidence(review: PortfolioReview, pkg: ReviewPackage | null): Record<ReviewDimension, Evidence | null> {
  const notes = reviewedEvidence(review, pkg);
  const resolve = (dimension: ReviewDimension) => {
    const citation = review.citations?.[dimension];
    const item = notes.find((note) => note.id === citation?.id);
    return item && citation && citation.confidence >= 0.65
      && eligibleForDimension(item, dimension) && item.id !== review.concernId ? item : null;
  };
  return { workingOutput: resolve('workingOutput'), nextRelease: resolve('nextRelease'), useCase: resolve('useCase') };
}
