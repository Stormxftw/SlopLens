import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import type { DashboardData, ProjectSummary } from './types.ts';
import { ageDays, reviewPriority } from './review.ts';
import type { PortfolioReview, ReviewPackage } from '../server/portfolio-review.ts';
import type { BatchJob, BatchPreview } from '../server/review-batch.ts';
import { explanationBrief, hasDocumentedLead, humanGap, minimumConfidence, reviewLanguage, selectedEvidence } from './review-language.ts';
import './portfolio.css';
import JevKeySettings from './JevKeySettings.tsx';

const number = new Intl.NumberFormat('en-US');
const label = (value: PortfolioReview['disposition']) => ({
  finish_candidate: 'Finish candidate', investigate: 'Investigate', deprioritize_candidate: 'Deprioritize candidate',
})[value];
const rating = (score: number) => score.toFixed(1) + ' / 3';
const dollars = (project: ProjectSummary) => {
  if (project.tokens === 0 && project.usageMissing) return 'Unknown';
  if (project.estimatedUsd === 0 && project.unpricedTokens > 0) return 'Unpriced';
  return (project.unpricedTokens || project.usageMissing ? 'From ' : '') + '$' + project.estimatedUsd.toFixed(2);
};
const toolCalls = (project: ProjectSummary) => {
  if (project.tools?.status === 'unavailable') return 'Unknown';
  const count = Object.values(project.tools?.categories ?? {}).reduce((sum, value) => sum + value, 0);
  return number.format(count) + (project.tools?.status === 'partial' ? '+' : '');
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Local review request failed.');
  return body;
}

export default function ReviewView({ data, open }: { data: DashboardData; open: (id: string) => void }) {
  const urgency = useMemo(() => [...data.projects].sort((a, b) =>
    (reviewPriority(b) ?? -1) - (reviewPriority(a) ?? -1)), [data]);
  const [selected, setSelected] = useState<string | null>(urgency[0]?.id ?? null);
  const [mode, setMode] = useState<'urgency' | 'candidates'>('urgency');
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [configured, setConfigured] = useState(false);
  const [reviews, setReviews] = useState<PortfolioReview[]>([]);
  const [job, setJob] = useState<BatchJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ranked = useMemo(() => reviews.filter((result) => hasDocumentedLead(result,
    preview?.projects.find((item) => item.projectId === result.projectId) ?? null)).sort((a, b) =>
    Number(b.disposition === 'finish_candidate') - Number(a.disposition === 'finish_candidate')
    || b.forwardScore - a.forwardScore || minimumConfidence(b) - minimumConfidence(a)), [reviews, preview]);
  const project = data.projects.find((item) => item.id === selected) ?? null;
  const pkg: ReviewPackage | null = preview?.projects.find((item) => item.projectId === selected) ?? null;
  const review = reviews.find((item) => item.projectId === selected) ?? null;
  const interpretation = review ? reviewLanguage(review, pkg) : null;
  const evidence = review ? selectedEvidence(review, pkg) : null;
  const missingEvidenceCount = reviews.filter((result) => result.gaps.includes('No safe overview evidence was available.')).length;

  async function loadPreview() {
    setLoading(true);
    try {
      const body = await responseJson<{ preview: BatchPreview; configured: boolean; reviews: PortfolioReview[] }>(
        await fetch('/api/review-batch/preview', { cache: 'no-store' }));
      setPreview(body.preview); setConfigured(body.configured); setReviews(body.reviews);
      const status = await responseJson<{ job: BatchJob | null; reviews: PortfolioReview[] }>(
        await fetch('/api/review-batch/status', { cache: 'no-store' }));
      setJob(status.job); setReviews(status.reviews);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Batch preview unavailable.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadPreview(); }, [data.generatedAt]);
  useEffect(() => {
    if (job?.state !== 'running') return;
    const timer = window.setInterval(() => {
      void fetch('/api/review-batch/status', { cache: 'no-store' })
        .then((response) => responseJson<{ job: BatchJob | null; reviews: PortfolioReview[] }>(response))
        .then((body) => { setJob(body.job); setReviews(body.reviews); })
        .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not read batch progress.'));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.state]);
  useEffect(() => { if (job?.state === 'complete') void loadPreview(); }, [job?.id, job?.state]);

  async function analyze(projectIds?: string[], force = false, deep = false) {
    if (!preview || job?.state === 'running') return;
    setError(null);
    try {
      const body = await responseJson<{ job: BatchJob }>(await fetch('/api/review-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: preview.fingerprint, projectIds, force, deep }),
      }));
      setJob(body.job);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start Jev analysis.'); }
  }

  function selectProject(id: string) {
    setSelected(id);
    setCopied(false);
    if (window.innerWidth <= 900) window.setTimeout(() =>
      document.querySelector('.review-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  const itemList = mode === 'urgency' ? urgency.map((item) => ({ item, review: reviews.find((r) => r.projectId === item.id) ?? null }))
    : ranked.flatMap((result) => {
      const item = data.projects.find((candidate) => candidate.id === result.projectId);
      return item ? [{ item, review: result }] : [];
    });

  return <section className="review-page">
    <div className="review-heading"><span className="eyebrow">THE NEXT MOVE / 02</span><h1>Review projects<span className="period">.</span></h1>
      <p>One click gathers the evidence, assesses your projects, and explains the next move. Uncertain projects stay visible without requiring a decision.</p></div>
    <section className="batch-panel" aria-label="Jev batch review">
      <div><span className="eyebrow">ANALYZE ALL</span><h2>One review pass across your projects</h2>
        <p>{loading ? 'Preparing the exact Jev packages…' : preview
          ? number.format(preview.projects.length) + ' projects · ' + number.format(preview.cached) + ' reusable results · up to '
            + number.format(preview.maxCalls) + ' new calls including possible deep reviews'
          : 'Batch preview unavailable.'}</p>
        <p>Current milestones and unfinished acceptance items take priority. Citation checks and plain-language explanations run automatically. {preview?.localOnly ?? 0} remaining projects with no eligible notes can be handled locally, without a Jev call.</p>
        <p>The exact material eligible for sending is expandable below. Inspect it before this single batch approval; automatic screening cannot catch every private detail.</p>
      </div>
      <button className="primary-action" disabled={!preview || (!configured && preview.maxCalls > 0) || loading || job?.state === 'running'}
        onClick={() => void analyze()}>{job?.state === 'running' ? 'Analyzing…' : 'Analyze all'} <ArrowRight size={16} /></button>
      <JevKeySettings busy={job?.state === 'running'} onConfigured={setConfigured} />
      {job && <div className="batch-progress" role="status">
        <strong>{job.state === 'running' ? 'Running' : 'Complete'}: {job.done} / {job.total}</strong>
        <span>{job.succeeded} assessed · {job.local} handled locally · {job.reused} reused · {job.failed.length} failed</span>
        {job.failed.length > 0 && <details><summary>Failures</summary><ul>{job.failed.map((failure) =>
          <li key={failure.projectId}>{data.projects.find((item) => item.id === failure.projectId)?.name ?? 'Project'}: {failure.error}</li>)}</ul>
          <button className="review-open" disabled={job.state === 'running'} onClick={() => void analyze(job.failed.map((item) => item.projectId), true)}>Retry failed projects</button></details>}
        {job.warnings.length > 0 && <details><summary>{job.warnings.length} results saved with a limited review</summary><ul>{job.warnings.map((warning) =>
          <li key={warning.projectId}>{data.projects.find((item) => item.id === warning.projectId)?.name ?? 'Project'}: {warning.error}</li>)}</ul>
          <button className="review-open" disabled={job.state === 'running'} onClick={() => void analyze(job.warnings.map((item) => item.projectId), true, true)}>Retry deeper reviews</button></details>}
      </div>}
      {error && <div className="error-banner">{error} <button onClick={() => void loadPreview()}>Reload preview</button></div>}
    </section>
    {reviews.length > 0 && <div className="review-explainer" role="note"><strong>{ranked.length} {ranked.length === 1 ? 'direction' : 'directions'} worth considering</strong>
      <span>{missingEvidenceCount} projects have no eligible overview notes and remain unranked. Each explanation is assembled automatically from checked citations. No second assistant or manual scorecard is needed.</span></div>}
    <div className="review-tabs"><button className={mode === 'urgency' ? 'active' : ''} onClick={() => { setMode('urgency'); setSelected(urgency[0]?.id ?? null); }}>Needs a decision <span>{urgency.length}</span></button>
      <button className={mode === 'candidates' ? 'active' : ''} onClick={() => { setMode('candidates'); setSelected(ranked[0]?.projectId ?? null); }}>Possible leads <span>{ranked.length}</span></button></div>
    <div className="review-layout"><div className="review-list">
      {itemList.length ? itemList.map(({ item, review: result }, index) => {
        const score = reviewPriority(item);
        return <button className={'review-row ' + (selected === item.id ? 'selected' : '')} key={item.id} onClick={() => selectProject(item.id)}>
          <span className="review-rank">{String(index + 1).padStart(2, '0')}</span>
          <span className="review-row-main"><strong>{item.name}</strong>
            <small>{mode === 'urgency' ? (ageDays(item) === null ? 'Activity date unknown' : ageDays(item) + ' days since activity') : result ? reviewLanguage(result, preview?.projects.find((pkg) => pkg.projectId === item.id) ?? null).title : 'Unassessed'}</small>
            <span>{number.format(item.tokens)} tokens{item.usageMissing ? ' +' : ''} · {number.format(Math.round(item.activeMs / 60_000))} active min{item.activePartial ? ' +' : ''} · {dollars(item)}</span></span>
          <span className="review-score">{mode === 'urgency' ? score ?? '—' : result?.forwardScore ?? '—'}<small>{mode === 'urgency' ? 'attention order' : 'evidence rating'}</small></span>
        </button>;
      }) : <div className="empty-state"><h3>{mode === 'candidates' && reviews.length ? 'No cited leads yet' : 'No assessments yet'}</h3><p>{mode === 'candidates' && reviews.length
        ? 'The assessed projects remain in “Needs a decision.” None has enough cited evidence for a lead yet; no action is required here.'
        : 'Inspect the batch preview and click Analyze all.'}</p></div>}
    </div><aside className="review-detail">{project && <>
      <span className="eyebrow">PROJECT REVIEW</span><h2>{project.name}</h2><p className="review-path">{project.path}</p>
      <div className="review-facts"><div><span>SESSIONS</span><strong>{project.sessionCount}</strong></div><div><span>API EQUIVALENT</span><strong>{dollars(project)}</strong></div>
        <div><span>TOOL CALLS</span><strong>{toolCalls(project)}</strong></div><div><span>DELEGATION CALLS</span><strong>{project.tools?.delegationCount ?? 'Unknown'}</strong></div></div>
      {review && interpretation && <div className="jev-result"><span className="eyebrow">{review.engine === 'local' ? 'EVIDENCE GAP · NO JEV CALL' : label(review.disposition).toUpperCase() + ' · ' + review.mode.toUpperCase() + ' REVIEW'}</span>
        <h3>{interpretation.title}</h3><p>{interpretation.summary}</p>
        {interpretation.findings.length > 0 && <ul className="review-findings">{interpretation.findings.map((finding) =>
          <li key={finding.label}><b>{finding.label}</b><span>{finding.text}</span></li>)}</ul>}
        <div className="review-next"><p><b>Suggested next move:</b> {interpretation.next}</p>
          {interpretation.nextEvidence && <blockquote><span>{interpretation.nextEvidence.text}</span><small>Recorded in {interpretation.nextEvidence.source}, line {interpretation.nextEvidence.line}</small></blockquote>}</div>
        {review.engine !== 'local' && <details className="review-rating-details"><summary>Evidence and automatic checks</summary>
          <p>{interpretation.checkedCount} of 3 judgment citations passed the checks for source ID, eligible content, citation confidence, and conflicting citation use. Rating confidence separately controls finish recommendations. These checks do not independently prove the notes are true.</p>
          {interpretation.findings.map((finding) => finding.evidence && <blockquote key={finding.label}><b>{finding.label}</b><span>{finding.evidence.text}</span><small>{finding.evidence.source}, line {finding.evidence.line}</small></blockquote>)}
          {evidence?.concern && <blockquote><b>Potential concern selected by Jev</b><span>{evidence.concern.text}</span><small>{evidence.concern.source}, line {evidence.concern.line}</small></blockquote>}
          <p>{interpretation.limitations}</p>
        </details>}
        {review.engine !== 'local' && <details className="review-rating-details"><summary>How Jev rated the supplied notes</summary>
          <div><span>Working result</span><b>{rating(review.scores.workingOutput.score)}</b></div>
          <div><span>Small next release</span><b>{rating(review.scores.nextRelease.score)}</b></div>
          <div><span>Specific user or use case</span><b>{rating(review.scores.useCase.score)}</b></div>
          <p>Weighted evidence rating: {review.forwardScore} / 100. Lowest model confidence: {Math.round(minimumConfidence(review) * 100)}%. Confidence is a model judgment, not a measured chance of correctness.</p>
          <small>{review.model} · latest call: {review.inputTokens ?? 'unknown'} input tokens · {review.outputTokens ?? 'unknown'} output tokens</small>
        </details>}
      </div>}
      {review && <details className="payload-preview ai-brief"><summary>Optional: export for another assistant</summary>
        <p>The explanation above is already complete. For a second opinion, this brief can be copied into Codex or Claude. Inspect the exact content before sharing.</p>
        <button className="review-open" onClick={() => void navigator.clipboard.writeText(explanationBrief(review, pkg)).then(() => setCopied(true)).catch(() => setError('Could not copy the review brief.'))}>{copied ? 'Copied' : 'Copy review brief'}</button>
        <pre>{explanationBrief(review, pkg)}</pre></details>}
      {pkg && <><p className="review-send-note">The package sends metrics, recent session counts, and the evidence below without a project name or path. Excluded lines: {pkg.omitted.unsafe} screened, {pkg.omitted.limit} over package limit, {pkg.omitted.oversized} oversized; {pkg.omitted.unreadable} documents unavailable. Base: {number.format(pkg.bytes.base)} bytes{pkg.deep ? '; deep: ' + number.format(pkg.bytes.deep) + ' bytes' : ''}.</p>
        {pkg.gaps.length > 0 && <ul className="review-gaps">{pkg.gaps.map((gap) => <li key={gap}>{humanGap(gap)}</li>)}</ul>}
        <details className="payload-preview"><summary>Preview exact Jev request</summary><pre>{JSON.stringify(pkg.base, null, 2)}</pre>
          {pkg.deep && <details><summary>Possible deep request</summary><pre>{JSON.stringify(pkg.deep, null, 2)}</pre></details>}</details></>}
      <div className="review-actions"><button className="review-open" onClick={() => open(project.id)}>Open project <ArrowUpRight size={15} /></button>
        <button className="review-open" disabled={!preview || !configured || job?.state === 'running'} onClick={() => void analyze([project.id], true, false)}><RefreshCw size={14} /> Reanalyze</button>
        {pkg?.deep && <button className="review-open" disabled={!configured || job?.state === 'running'} onClick={() => void analyze([project.id], true, true)}>Deep review</button>}</div>
    </>}</aside></div>
    <p className="review-method">Attention order uses age and recorded effort (45% active time, 35% tokens, 20% sessions). Possible leads require a checked citation for a working result or specific use case. Finish candidates come first, then the evidence rating: use case 40%, next release 35%, working result 25%. Equal ratings use model confidence. These are documentation judgments, not live verification or a measured chance of success. Estimated dollars and tool counts are context. Suggestions never archive a project.</p>
  </section>;
}
