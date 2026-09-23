import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowLeft, ArrowRight, Clock3, Code2, Compass, ExternalLink, GitCommitHorizontal, Layers3, Moon, RefreshCw, Search, Sparkles, Sun, Timer, Waves } from 'lucide-react';
import type { DashboardData, ProjectSummary, Provider } from './types.ts';
import { ageDays, reviewPriority, type JevReview, type ReviewPreview } from './review.ts';
import './style.css';
import './dark.css';
import './layout.css';

type Status = { state: 'loading' | 'ready' | 'error'; progress: string; lastError: string | null; generatedAt: string | null };
const number = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const date = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unavailable';
const exactDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'Unavailable';
const money = (value: number) => value === 0 ? '$0.00' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
const compactMoney = (value: number) => value >= 1000 ? `$${(value / 1000).toFixed(2)}K` : money(value);
const duration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? '<1 min' : '0 min';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, (mins || (!days && !hours)) && `${mins}m`].filter(Boolean).join(' ');
};
const costLabel = (project: ProjectSummary) => {
  if (project.tokens === 0 && project.usageMissing) return 'Unknown';
  if (project.estimatedUsd === 0 && project.unpricedTokens > 0) return 'Unpriced';
  return `${project.unpricedTokens || project.usageMissing ? 'From ' : ''}${money(project.estimatedUsd)}`;
};

function ProviderBadges({ providers }: { providers: Provider[] }) {
  return <div className="badges">{providers.map((provider) => <span className={`badge ${provider === 'Codex' ? 'codex' : 'claude'}`} key={provider}>{provider}</span>)}</div>;
}

function Metric({ label, value, note, icon }: { label: string; value: string; note?: string; icon: React.ReactNode }) {
  return <div className="metric"><div className="metric-top"><span>{label}</span>{icon}</div><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function LangBars({ project, limit = 4 }: { project: ProjectSummary; limit?: number }) {
  if (!project.code.languages.length) return <p className="muted">Language data unavailable</p>;
  const total = project.code.languages.reduce((sum, row) => sum + row.lines, 0) || 1;
  const colors = ['#e7866b', '#8daea9', '#d9b95b', '#777f9a', '#bc9779'];
  return <div className="language-list">{project.code.languages.slice(0, limit).map((row, index) =>
    <div className="lang-row" key={row.name}>
      <span className="lang-name"><i style={{ backgroundColor: colors[index % colors.length] }} />{row.name}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, row.lines / total * 100)}%`, backgroundColor: colors[index % colors.length] }} /></div>
      <span className="lang-percent">{Math.round(row.lines / total * 100)}%</span>
    </div>)}</div>;
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const lead = project.code.languages[0]?.name ?? 'No source data';
  return <button className="project-card" onClick={onOpen} aria-label={`Open ${project.name}`}>
    <div className="card-top"><div className="project-monogram">{project.name.slice(0, 2).toUpperCase()}</div><ArrowUpRight className="card-arrow" size={23} strokeWidth={1.5} /></div>
    <div className="card-title"><span className="eyebrow">PROJECT / {lead.toUpperCase()}</span><h3>{project.name}</h3><p title={project.path}>{project.path}</p></div>
    <ProviderBadges providers={project.providers} />
    <div className="card-stats"><div><strong>{compact.format(project.tokens)}</strong><span>tokens</span></div><div><strong>{costLabel(project)}</strong><span>API equivalent</span></div><div><strong>{number.format(project.sessionCount)}</strong><span>sessions</span></div></div>
    <div className="card-foot"><span><Clock3 size={14} /> {date(project.lastAgentAt)}</span><span>{project.code.lines === null ? 'Lines unavailable' : `${compact.format(project.code.lines)} source lines`}</span></div>
  </button>;
}

function Overview({ data, open }: { data: DashboardData; open: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('activity');
  const [visible, setVisible] = useState(12);
  const projects = useMemo(() => {
    const filtered = data.projects.filter((project) => `${project.name} ${project.path} ${project.providers.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    return filtered.sort((a, b) => sort === 'tokens' ? b.tokens - a.tokens : sort === 'cost' ? b.estimatedUsd - a.estimatedUsd : sort === 'lines' ? (b.code.lines ?? -1) - (a.code.lines ?? -1) : (b.lastAgentAt ?? '').localeCompare(a.lastAgentAt ?? ''));
  }, [data.projects, query, sort]);
  const totals = useMemo(() => data.projects.reduce((acc, project) => {
    acc.tokens += project.tokens; acc.cost += project.estimatedUsd; acc.unpriced += project.unpricedTokens;
    acc.missing ||= project.usageMissing; return acc;
  }, { tokens: 0, cost: 0, unpriced: 0, missing: false }), [data.projects]);
  const uniqueSessions = useMemo(() => new Set(data.projects.flatMap((project) => project.sessions.map((session) => `${session.provider}:${session.id}`))).size, [data.projects]);
  return <>
    <section className="summary-strip" aria-label="Overall statistics"><div><span>01 / PROJECTS</span><strong>{number.format(data.projects.length)}</strong><small>projects with agent activity</small></div><div><span>02 / SESSIONS</span><strong>{number.format(uniqueSessions)}</strong><small>unique across both agents</small></div><div><span>03 / TOKENS</span><strong>{compact.format(totals.tokens)}</strong><small>recorded usage</small></div><div><span>04 / API EQUIVALENT</span><strong>{totals.cost === 0 && totals.unpriced ? 'Unpriced' : `${totals.unpriced || totals.missing ? 'From ' : ''}${compactMoney(totals.cost)}`}</strong><small>{totals.unpriced ? `${compact.format(totals.unpriced)} unpriced tokens` : totals.missing ? 'some usage unavailable' : 'estimated, not billed spend'}</small></div></section>
    <section id="projects" className="projects-section"><div className="section-heading"><div><span className="eyebrow">THE WORK / 01</span><h2>Projects in motion<span className="period">.</span></h2><p>Projects these agents worked on, ordered by the latest activity.</p></div><div className="project-count">{projects.length} PROJECT{projects.length === 1 ? '' : 'S'} FOUND</div></div><p className="source-report">Indexed {data.sources.map((source) => `${number.format(source.files)} ${source.provider} logs`).join(' + ')}.{data.sources.some((source) => source.errors > 0) && <strong> {data.sources.reduce((sum, source) => sum + source.errors, 0)} files could not be read.</strong>}</p>
      <div className="controls"><label className="search-box"><Search size={19} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisible(12); }} placeholder="Search projects, paths, agents…" /></label><label className="sort-box">SORT BY <select value={sort} onChange={(event) => { setSort(event.target.value); setVisible(12); }}><option value="activity">Last activity</option><option value="tokens">Most tokens</option><option value="cost">Highest estimate</option><option value="lines">Most source lines</option></select></label></div>
      {projects.length ? <><div className="project-grid">{projects.slice(0, visible).map((project) => <ProjectCard key={project.id} project={project} onOpen={() => open(project.id)} />)}</div>{projects.length > visible && <button className="load-more" onClick={() => setVisible(visible + 12)}>Show more projects <ArrowRight size={16} /><span>{visible} of {projects.length} shown</span></button>}</> : <div className="empty-state"><Compass size={30} /><h3>No projects found</h3><p>{query ? 'Try a different search.' : 'No readable Codex or Claude Code session history is available.'}</p></div>}
    </section>
  </>;
}

function ProjectDetail({ project, back }: { project: ProjectSummary; back: () => void }) {
  const partial = project.unpricedTokens > 0 || project.usageMissing;
  return <><button className="back-button" onClick={back}><ArrowLeft size={17} /> All projects</button>
    <section className="detail-heading"><div className="detail-heading-main"><span className="eyebrow">PROJECT PROFILE / {project.isGit ? 'GIT REPOSITORY' : 'LOCAL FOLDER'}</span><h1>{project.name}<span className="period">.</span></h1><p className="detail-path" title={project.path}>{project.path}</p><ProviderBadges providers={project.providers} /></div><div className="detail-activity"><span>LAST AGENT ACTIVITY</span><strong>{date(project.lastAgentAt)}</strong><small>{exactDate(project.lastAgentAt)}</small></div></section>
    <section className="detail-metrics"><Metric label="TOTAL TOKENS" value={number.format(project.tokens)} note={project.usageMissing ? 'Some usage unavailable' : 'Recorded across sessions'} icon={<Sparkles size={21} />} /><Metric label="API PRICE EQUIVALENT" value={costLabel(project)} note={partial ? `${number.format(project.unpricedTokens)} unpriced tokens${project.usageMissing ? ' · missing usage' : ''}` : 'Estimate, not billed spend'} icon={<Waves size={21} />} /><Metric label="SESSIONS" value={number.format(project.sessionCount)} note="Unique agent sessions" icon={<Layers3 size={21} />} /><Metric label="SOURCE LINES" value={project.code.lines === null ? 'Unavailable' : number.format(project.code.lines)} note={project.code.status === 'partial' ? 'Partial file count' : 'Nonblank, current files'} icon={<Code2 size={21} />} /></section>
    <section className="detail-two"><div className="panel"><div className="panel-heading"><div><span className="eyebrow">CODE PROFILE</span><h2>Languages</h2></div><span className="panel-side">{project.code.files === null ? 'Folder unavailable' : `${number.format(project.code.files)} source files`}</span></div><LangBars project={project} limit={12} /><p className="panel-note">{project.code.note ?? 'Current files only. Nonblank source lines include comments; generated and ignored files are excluded.'}</p></div><div className="panel time-panel"><div className="panel-heading"><div><span className="eyebrow">TIME IN THE WORK</span><h2>Time & activity</h2></div><Timer size={23} /></div><div className="time-value"><span>OBSERVED ACTIVE AGENT TIME</span><strong>{duration(project.activeMs)}{project.activePartial ? ' +' : ''}</strong><small>{project.activePartial ? 'Some turns lack a recorded end; this is a lower bound.' : 'Bounded agent turns and requests only.'}</small></div><div className="time-value"><span>SUM OF SESSION SPANS</span><strong>{duration(project.spanMs)}{project.spanPartial ? ' +' : ''}</strong><small>First to last event per session; idle gaps are included.</small></div><div className="commit-line"><GitCommitHorizontal size={17} /> Last Git commit <strong>{project.isGit ? date(project.lastCommitAt) : 'No Git repository'}</strong></div></div></section>
    <section className="panel model-panel"><div className="panel-heading"><div><span className="eyebrow">THE MODELS</span><h2>Token & cost breakdown</h2></div><span className="panel-side">Public API equivalent · {project.models.length} models</span></div>{project.models.length ? <div className="model-table"><div className="table-head"><span>MODEL</span><span>INPUT</span><span>CACHED / WRITE</span><span>OUTPUT</span><span>TOKENS</span><span>EST. USD</span></div>{project.models.map((model) => <div className="table-row" key={`${model.provider}:${model.model}`}><div><strong>{model.model}</strong><small>{model.provider}</small></div><span>{number.format(model.usage.input)}</span><span>{number.format(model.usage.cachedInput + model.usage.cacheWrite5m + model.usage.cacheWrite1h)}</span><span>{number.format(model.usage.output)}</span><span>{number.format(model.tokens)}</span><strong>{model.estimatedUsd === null ? 'Unpriced' : money(model.estimatedUsd)}</strong></div>)}</div> : <p className="muted">No token usage was recorded for these sessions.</p>}</section>
    <section className="panel sessions-panel"><div className="panel-heading"><div><span className="eyebrow">THE TIMELINE</span><h2>Sessions</h2></div><span className="panel-side">{project.sessions.length} linked sessions</span></div><div className="sessions-list">{project.sessions.map((session) => <div className="session-row" key={`${session.provider}:${session.id}`}><div><span className={`badge ${session.provider === 'Codex' ? 'codex' : 'claude'}`}>{session.provider}</span><strong title={session.id}>{session.id.slice(0, 15)}</strong><small>{session.models.join(', ') || 'Model unavailable'}</small></div><div><span>LAST EVENT</span><strong title={exactDate(session.endedAt)}>{date(session.endedAt)}</strong></div><div><span>TOKENS</span><strong>{number.format(session.tokens)}{session.usageMissing ? ' +' : ''}</strong></div><div><span>ACTIVE / SPAN</span><strong>{duration(session.activeMs)}{session.activePartial ? '+' : ''} / {session.spanMs === null ? '—' : duration(session.spanMs)}</strong></div><div><span>EST. USD</span><strong>{session.tokens === 0 && session.usageMissing ? 'Unknown' : session.estimatedUsd === 0 && session.unpricedTokens ? 'Unpriced' : `${session.unpricedTokens || session.usageMissing ? 'From ' : ''}${money(session.estimatedUsd)}`}</strong></div></div>)}</div></section>
    <section className="method-note"><strong>How to read these numbers</strong><p>Token totals come from local agent records. Dollar figures apply public standard API rates dated September 23, 2026 to priced model tokens, so they are not bills or subscription charges. Tool fees, discounts, and unknown usage are excluded. Source lines describe the project as it exists now.</p><div><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">OpenAI pricing <ExternalLink size={13} /></a><a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer">Anthropic pricing <ExternalLink size={13} /></a></div></section>
  </>;
}

function ReviewView({ data, open }: { data: DashboardData; open: (id: string) => void }) {
  const ranked = useMemo(() => [...data.projects].sort((a, b) => (reviewPriority(b) ?? -1) - (reviewPriority(a) ?? -1)), [data]);
  const [selected, setSelected] = useState<string | null>(ranked[0]?.id ?? null);
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [configured, setConfigured] = useState(false);
  const [reviews, setReviews] = useState<JevReview[]>([]);
  const [goal, setGoal] = useState('Ship a small working release I can demonstrate.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'queue' | 'potential'>('queue');
  const project = data.projects.find((item) => item.id === selected) ?? null;
  const review = reviews.find((item) => item.projectId === selected) ?? null;
  const assessed = [...reviews].sort((a, b) => b.worthExploring - a.worthExploring);

  useEffect(() => {
    let stopped = false;
    void fetch('/api/reviews').then((response) => response.json()).then((result: { reviews: JevReview[] }) => {
      if (!stopped) setReviews(result.reviews);
    }).catch(() => { if (!stopped) setError('Could not load Jev reviews.'); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    setPreview(null); setError(null);
    void fetch(`/api/review/${encodeURIComponent(selected)}`).then(async (response) => {
      if (!response.ok) throw new Error('Could not load project review preview.');
      return response.json() as Promise<{ preview: ReviewPreview; configured: boolean; review: JevReview | null }>;
    }).then((result) => { if (!stopped) { setPreview(result.preview); setConfigured(result.configured); } })
      .catch((reason) => { if (!stopped) setError(reason instanceof Error ? reason.message : 'Preview unavailable.'); });
    return () => { stopped = true; };
  }, [selected]);

  const analyze = async () => {
    if (!project || !preview) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(project.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }) });
      const result = await response.json() as { review?: JevReview; error?: string };
      if (!response.ok || !result.review) throw new Error(result.error ?? `Jev returned HTTP ${response.status}.`);
      setReviews((current) => [result.review!, ...current.filter((item) => item.projectId !== project.id)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Jev review failed.'); }
    finally { setBusy(false); }
  };

  return <section className="review-page"><div className="review-heading"><span className="eyebrow">THE NEXT MOVE / 02</span><h1>Review projects<span className="period">.</span></h1><p>Start with projects that are old and have substantial recorded agent work. Sixty days without recorded agent activity is a stale signal. Past investment raises review priority; it does not make continuing the right choice.</p></div>
    <div className="review-tabs"><button className={mode === 'queue' ? 'active' : ''} onClick={() => { setMode('queue'); setSelected(ranked[0]?.id ?? null); }}>Review queue <span>{ranked.length}</span></button><button className={mode === 'potential' ? 'active' : ''} onClick={() => { setMode('potential'); setSelected(assessed[0]?.projectId ?? null); }}>Jev assessed <span>{assessed.length}</span></button></div>
    <div className="review-layout"><div className="review-list">
      {mode === 'queue' ? ranked.map((item, index) => { const days = ageDays(item); const priority = reviewPriority(item); return <button className={`review-row ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className="review-rank">{String(index + 1).padStart(2, '0')}</span><span className="review-row-main"><strong>{item.name}</strong><small>{days === null ? 'Activity date unknown' : `${days} days since agent activity`} · {item.sessionCount} sessions</small><span>{duration(item.activeMs)}{item.activePartial ? '+' : ''} observed active · {compact.format(item.tokens)} recorded tokens{item.usageMissing ? ' +' : ''}</span></span><span className="review-score">{priority === null ? '—' : priority}<small>review priority</small></span></button>; }) : assessed.length ? assessed.map((item, index) => { const match = data.projects.find((candidate) => candidate.id === item.projectId); return match ? <button className={`review-row ${selected === item.projectId ? 'selected' : ''}`} key={item.projectId} onClick={() => setSelected(item.projectId)}><span className="review-rank">{String(index + 1).padStart(2, '0')}</span><span className="review-row-main"><strong>{match.name}</strong><small>{date(item.reviewedAt)} · goal: {item.goal}</small><span>Clarity {Math.round(item.releaseClarity.score / 3 * 100)} · value evidence {Math.round(item.valueEvidence.score / 3 * 100)}{Math.min(item.releaseClarity.confidence, item.valueEvidence.confidence) < 0.5 ? ' · low confidence' : ''}</span></span><span className="review-score">{item.worthExploring}<small>forward signal</small></span></button> : null; }) : <div className="empty-state"><h3>No Jev reviews yet</h3><p>Select a project in the review queue, inspect the source excerpts, and analyze it.</p></div>}
    </div><aside className="review-detail">{project && <><span className="eyebrow">PROJECT REVIEW</span><h2>{project.name}</h2><p className="review-path">{project.path}</p><div className="review-facts"><div><span>LAST ACTIVITY</span><strong>{date(project.lastAgentAt)}</strong></div><div><span>LAST COMMIT</span><strong>{date(project.lastCommitAt)}</strong></div><div><span>OBSERVED ACTIVE</span><strong>{duration(project.activeMs)}{project.activePartial ? '+' : ''}</strong></div><div><span>API EQUIVALENT</span><strong>{costLabel(project)}</strong></div></div><p className="review-caveat">Review priority uses age × recorded effort (45% active time, 35% tokens, 20% sessions; each capped). Dollar figures are API price equivalents, never billed spend. Unknown usage makes effort a lower bound.</p>
      {review && <div className="jev-result"><span className="eyebrow">JEV ASSESSMENT · {date(review.reviewedAt)}</span><strong>{review.worthExploring}<small>/ 100 forward signal</small></strong><div><span>Next release clarity</span><b>{Math.round(review.releaseClarity.score / 3 * 100)} / 100</b></div><div><span>Evidence for your goal</span><b>{Math.round(review.valueEvidence.score / 3 * 100)} / 100</b></div><p>{Math.min(review.releaseClarity.confidence, review.valueEvidence.confidence) < 0.5 ? 'Low model confidence: read the source notes and decide yourself.' : 'A structured judgment from the supplied notes, not proof of future value.'} Goal: {review.goal}</p><small>{review.model} · {review.inputTokens === null ? 'input tokens unknown' : `${review.inputTokens} input tokens`} · {review.outputTokens === null ? 'output tokens unknown' : `${review.outputTokens} output tokens`}</small></div>}
      <label className="review-goal">What should this project accomplish next?<textarea value={goal} maxLength={400} onChange={(event) => setGoal(event.target.value)} /></label><p className="review-send-note">Analyze with Jev sends this goal, basic project metadata, and the excerpts below to TypeSafe. Session transcripts and source files are excluded. One request runs only when you click Analyze.</p>
      {preview === null ? <p className="muted">Loading document preview…</p> : preview.documents.length ? <div className="review-docs">{preview.documents.map((document) => <details key={document.name}><summary>{document.name}{document.truncated ? ' · excerpt' : ''}</summary><pre>{document.excerpt}</pre></details>)}</div> : <p className="muted">No readable CURRENT_MILESTONE.md, PROJECT_STATE.md, or README.md is available. Jev cannot assess this project from source notes.</p>}
      {error && <div className="error-banner">{error}</div>}
      <div className="review-actions"><button className="primary-action" disabled={busy || !configured || !preview?.documents.length || !goal.trim()} onClick={() => void analyze()}>{busy ? 'Asking Jev…' : review ? 'Reassess with Jev' : 'Analyze with Jev'} <ArrowRight size={16} /></button><button className="review-open" onClick={() => open(project.id)}>Open project <ArrowUpRight size={15} /></button></div>{!configured && <p className="review-config">Jev is not configured. Add TYPESAFE_API_KEY to this app’s .env.local file or server environment.</p>}</>}</aside></div><p className="review-method">The forward signal combines Jev’s next release clarity (55%) and goal evidence (45%). Only assessed projects appear in the Jev ranking. It cannot know your current priorities, whether you enjoy the work, or actual billed cost; use it to choose what to inspect next.</p></section>;
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [status, setStatus] = useState<Status>({ state: 'loading', progress: 'Connecting to local index…', lastError: null, generatedAt: null });
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(window.location.hash.startsWith('#/project/') ? window.location.hash.slice(10) : null);
  const [reviewPage, setReviewPage] = useState(window.location.hash === '#review');
  const [detail, setDetail] = useState<ProjectSummary | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151b1c' : '#f2efe7');
    try { localStorage.setItem('sloplens-theme', theme); } catch { /* Browser storage may be unavailable. */ }
  }, [theme]);

  useEffect(() => {
    const onHash = () => { setSelectedId(window.location.hash.startsWith('#/project/') ? window.location.hash.slice(10) : null); setReviewPage(window.location.hash === '#review'); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
        const next = await response.json() as Status;
        if (stopped) return;
        setStatus(next); setNetworkError(null);
        if (next.state === 'ready' && next.generatedAt !== data?.generatedAt) {
          const projects = await fetch('/api/projects', { cache: 'no-store' });
          if (projects.ok) setData(await projects.json() as DashboardData);
        }
      } catch (error) { if (!stopped) setNetworkError(error instanceof Error ? error.message : 'Connection failed'); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), status.state === 'loading' ? 1300 : 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [status.state, data?.generatedAt]);

  useEffect(() => {
    if (!selectedId || !data) { setDetail(null); return; }
    let stopped = false;
    void fetch(`/api/projects/${encodeURIComponent(selectedId)}`).then(async (response) => {
      if (!response.ok) throw new Error('Project unavailable');
      if (!stopped) setDetail(await response.json() as ProjectSummary);
    }).catch(() => { if (!stopped) setDetail(null); });
    return () => { stopped = true; };
  }, [selectedId, data]);

  const open = (id: string) => { window.location.hash = `/project/${id}`; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const back = () => { window.location.hash = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const refresh = async () => { try { await fetch('/api/refresh', { method: 'POST' }); setStatus((current) => ({ ...current, state: 'loading', progress: 'Refreshing local history…' })); } catch { setNetworkError('Could not start refresh'); } };
  return <div className="app"><header className="topbar"><div className="topbar-inner"><button className="brand" onClick={back} aria-label="SlopLens dashboard home"><span className="brand-symbol"><span /></span><span>SlopLens<span className="brand-dot">.</span></span></button><nav><button className={!selectedId && !reviewPage ? 'active' : ''} onClick={back}>Overview</button><a href="#projects">Projects</a><a className={reviewPage ? 'active' : ''} href="#review">Review</a></nav><div className="topbar-right"><span className="local-pill"><span /> LOCAL VIEW</span><button className="theme-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="refresh-button" onClick={() => void refresh()} disabled={status.state === 'loading'} title="Refresh local index"><RefreshCw size={17} className={status.state === 'loading' ? 'spinning' : ''} /><span>Refresh</span></button></div></div></header>
    <main className="main">{status.state === 'loading' && <div className="index-banner"><RefreshCw size={16} className="spinning" /> {status.progress}</div>}{status.state === 'error' && <div className="error-banner">{status.progress}: {status.lastError}</div>}{networkError && <div className="error-banner">Local server: {networkError}</div>}{data ? (selectedId ? (detail ? <ProjectDetail project={detail} back={back} /> : <div className="empty-state"><h2>Opening project…</h2><button onClick={back}>Back to overview</button></div>) : reviewPage ? <ReviewView data={data} open={open} /> : <Overview data={data} open={open} />) : <div className="loading-screen"><div className="loading-orbit"><span /></div><span className="eyebrow">READING LOCAL AGENT HISTORY</span><h1>Good work takes <em>a moment.</em></h1><p>{status.progress}</p></div>}</main>
    <footer><div><strong>SlopLens.</strong><span>SEE THE WORK CLEARLY.</span></div><p>Local-first project intelligence · Jev review sends only the previewed notes when requested</p><span>{data ? `Indexed ${date(data.generatedAt)}` : 'Indexing local history'}</span></footer></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
