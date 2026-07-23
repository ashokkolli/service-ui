import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames/bind';
import {
  createBug,
  fetchStreamPulseObservability,
  getStreamPulseApiBaseUrl,
  isMockObservability,
  notifyGate,
  rerunFailed,
} from './streamPulseClient';
import {
  containsSerializedDict,
  crashFreePercent,
  groupSlowRequests,
  hasSectionContent,
  isHttpUri,
  isRcaNoVerdict,
  isWarningOrFail,
  kpiDisplayName,
  kpiDisplayState,
  percent,
  rcaVerdict,
  severityGlyph,
  shouldAutoExpandSection,
  statusClass,
  text,
  topHostShare,
} from './streamPulseUtils';
import { Sparkline } from './sparkline';
import { KpiTrendChart, isMeasured } from './kpiTrendChart';
import styles from './streamPulseObservabilityTab.scss';

const cx = classNames.bind(styles);

const fmtClock = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Consecutive identical events collapse into ONE chip carrying a repeat count.
//
// A locator that polls until it times out emits the SAME event every few hundred ms:
// one real run produced ~120 identical "find nav_home FAILED" chips inside a 150-chip
// strip, which buried every other event and read as the same data pasted twice. The
// count preserves the evidence that actually matters -- that it retried, and for how
// long -- without repeating the row. Only ADJACENT identical events merge, so the same
// event recurring later in the session stays its own chip rather than being folded into
// an earlier, unrelated burst.
const collapseRepeats = (events) => {
  const out = [];
  (events || []).forEach((e) => {
    const prev = out[out.length - 1];
    if (prev && prev.name === e.name && prev.status === e.status) {
      prev.count += 1;
      prev.lastOffsetMs = e.offset_ms;
      return;
    }
    out.push({ ...e, count: 1, lastOffsetMs: e.offset_ms });
  });
  return out;
};

// Step-hold sample of a [{t,v}] series (t in ms) at time `tMs`: the value in effect is
// the last REAL sample at or before it — never interpolated into a value the capture
// did not record. Returns null when nothing is sampleable so the caller shows "—".
const sampleSeriesAt = (series, tMs) => {
  if (!series || !series.length) {
    return null;
  }
  let v = series[0].v;
  for (let i = 0; i < series.length; i += 1) {
    if (series[i].t <= tMs) {
      v = series[i].v;
    } else {
      break;
    }
  }
  return v;
};

const fmtNum = (value) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return text(value);
  }
  if (Math.abs(n) >= 1000) {
    return Math.round(n).toLocaleString();
  }
  return String(Math.round(n * 100) / 100);
};

// Resolve a possibly-relative media URL (the API may return `/artifact-store/…/video.mp4`)
// against the configured API base so the <video> src is absolute + CORS-served. Honesty:
// an empty/missing URL stays empty so the UI shows an honest "no video" state, never a
// broken <video> pretending a replay exists.
const resolveMediaUrl = (url, apiBaseUrl) => {
  const u = text(url);
  if (!u) {
    return '';
  }
  if (/^(https?:|data:|blob:)/i.test(u)) {
    return u;
  }
  if (apiBaseUrl) {
    return `${apiBaseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
  }
  return u;
};

// A foldable section card matching the artifact's card pattern. Native <details> gives
// keyboard toggling + focus for free (WCAG 2.1.1 / 2.4.7) — meaning is carried by the
// text title and chevron, never color alone.
const FoldableCard = ({ title, sub = null, badge = null, defaultOpen = true, hero = false, children }) => (
  <details className={cx('card', { hero })} open={defaultOpen}>
    <summary className={cx('card-head')}>
      <h3 className={cx('card-title')}>{title}</h3>
      {sub && <span className={cx('card-sub')}>{sub}</span>}
      <span className={cx('card-spacer')} />
      {badge}
      <span className={cx('chev')} aria-hidden="true" />
    </summary>
    <div className={cx('card-body')}>{children}</div>
  </details>
);

FoldableCard.propTypes = {
  title: PropTypes.node.isRequired,
  sub: PropTypes.node,
  badge: PropTypes.node,
  defaultOpen: PropTypes.bool,
  hero: PropTypes.bool,
  children: PropTypes.node,
};

// Category → plane title for the honest "not captured" planes surfaced from a real
// replay's `unavailable` list (e.g. system sampling is Android-only; no HAR → no network).
const UNAVAILABLE_PLANES = {
  system: {
    title: 'Device',
    note: 'Not captured — on-device system sampling (CPU / memory / fps) is Android-only for this run.',
  },
  network: {
    title: 'Network',
    note: 'Not captured — no HAR was recorded for this session, so no per-request network track exists.',
  },
  quality: { title: 'Video Quality', note: 'Not captured — no per-frame video analysis for this session.' },
  steps: { title: 'Steps', note: 'Not captured — the run did not emit timed engine steps.' },
};

const Badge = ({ value = '' }) => {
  const glyph = severityGlyph(value);

  return (
    <span className={cx('badge', statusClass(value))}>
      {glyph && (
        <span className={cx('badge-glyph')} aria-hidden="true">
          {glyph}
        </span>
      )}
      {text(value)}
    </span>
  );
};

Badge.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

// Copy to clipboard for non-openable URIs (s3://, gs://, …). Guarded so it is a
// no-op in environments without the async clipboard API rather than throwing.
const copyToClipboard = (value) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text(value));
  }
};

// Normalize the honest backend action response into the fields the UI renders.
// NEVER invents an issue key or a success — a missing key stays null so the UI
// falls through to the backend's honest reason.
const readActionResult = (res) => {
  const source = res && typeof res === 'object' ? res : {};
  const nested = source.result && typeof source.result === 'object' ? source.result : {};
  const issueKey =
    source.issue_key || source.issueKey || nested.issue_key || nested.issueKey || null;
  const url =
    source.url || source.issue_url || source.browse_url || nested.url || nested.issue_url || null;
  const reason = source.reason || nested.reason || source.error || nested.error || null;
  const message = source.message || nested.message || null;

  return { ok: source.ok === true, issueKey, url, reason, message };
};

const ACTION_LABELS = {
  bug: 'Create Jira bug',
  notify: 'Notify gate',
  rerun: 'Re-run failed',
};

const ArtifactUri = ({ artifact = {} }) => {
  const uri = text(artifact.uri || artifact.object_key);

  if (!uri) {
    return null;
  }

  const isVideo = artifact.type === 'video' || /\.mp4(\?|#|$)/i.test(uri);

  // Honesty: only http(s) is a real, openable link. Non-http schemes (s3://…)
  // are shown as selectable text with a copy affordance — never a dead link.
  if (isHttpUri(uri)) {
    return (
      <a className={cx('artifact-link')} href={uri} target="_blank" rel="noopener noreferrer">
        {isVideo && (
          <span className={cx('replay-affordance')} aria-hidden="true">
            ▶{' '}
          </span>
        )}
        {isVideo ? 'replay' : uri}
      </a>
    );
  }

  return (
    <span className={cx('artifact-uri')}>
      <code className={cx('artifact-code')}>{uri}</code>
      <button
        type="button"
        className={cx('copy-btn')}
        onClick={() => copyToClipboard(uri)}
        aria-label={`Copy URI ${uri}`}
      >
        Copy
      </button>
    </span>
  );
};

ArtifactUri.propTypes = {
  artifact: PropTypes.object,
};

class RcaActions extends Component {
  static propTypes = {
    rpItemId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    jiraReady: PropTypes.object,
    functionalStatus: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    disabled: PropTypes.bool,
    disabledReason: PropTypes.string,
  };

  static defaultProps = {
    rpItemId: null,
    jiraReady: null,
    functionalStatus: '',
    disabled: false,
    disabledReason: '',
  };

  state = {
    pending: null,
    result: null,
    error: null,
  };

  runAction = (action, invoke) => {
    this.setState({ pending: action, result: null, error: null });
    Promise.resolve()
      .then(invoke)
      .then((res) => this.setState({ pending: null, result: { action, res } }))
      .catch((err) =>
        this.setState({
          pending: null,
          error: { action, message: (err && err.message) || String(err) },
        }),
      );
  };

  handleCreateBug = () =>
    this.runAction('bug', () => createBug(this.props.rpItemId, this.props.jiraReady || undefined));

  handleNotify = () => this.runAction('notify', () => notifyGate(this.props.rpItemId));

  handleRerun = () => this.runAction('rerun', () => rerunFailed(this.props.rpItemId));

  renderResult() {
    const { result, error } = this.state;

    if (error) {
      return (
        <div className={cx('action-result', 'action-result--error')} role="alert">
          <span className={cx('action-glyph')} aria-hidden="true">
            ✗
          </span>
          {ACTION_LABELS[error.action]} failed: {text(error.message)}
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const parsed = readActionResult(result.res);

    if (result.action === 'bug') {
      // HONESTY: a real success requires ok===true AND a returned issue key. Only
      // then do we surface the key; we NEVER fabricate one.
      if (parsed.ok && parsed.issueKey) {
        return (
          <div className={cx('action-result', 'action-result--ok')} role="status">
            <span className={cx('action-glyph')} aria-hidden="true">
              ✓
            </span>
            Created Jira bug{' '}
            {parsed.url ? (
              <a
                className={cx('issue-link')}
                href={parsed.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {text(parsed.issueKey)}
              </a>
            ) : (
              <code className={cx('issue-key')}>{text(parsed.issueKey)}</code>
            )}
          </div>
        );
      }

      // Not configured / failed: show the backend's honest reason, no fake key.
      return (
        <div className={cx('action-result', 'action-result--muted')} role="status">
          <span className={cx('action-glyph')} aria-hidden="true">
            ⚠
          </span>
          Jira bug not created: {text(parsed.reason || parsed.message || 'no reason returned')}
        </div>
      );
    }

    const label = ACTION_LABELS[result.action];

    if (parsed.ok) {
      return (
        <div className={cx('action-result', 'action-result--ok')} role="status">
          <span className={cx('action-glyph')} aria-hidden="true">
            ✓
          </span>
          {label} — {text(parsed.message || parsed.reason || 'done')}
        </div>
      );
    }

    return (
      <div className={cx('action-result', 'action-result--muted')} role="status">
        <span className={cx('action-glyph')} aria-hidden="true">
          ⚠
        </span>
        {label} not completed: {text(parsed.reason || parsed.message || 'no reason returned')}
      </div>
    );
  }

  render() {
    const { functionalStatus, disabled, disabledReason } = this.props;
    const { pending } = this.state;
    // Re-run is offered ONLY when the functional test itself failed.
    const showRerun = statusClass(functionalStatus) === 'failed';
    const busy = Boolean(pending);

    return (
      <div className={cx('rca-actions')}>
        <h4 className={cx('section-subtitle')}>Actions</h4>
        <div className={cx('action-buttons')}>
          <button
            type="button"
            className={cx('action-btn', 'action-btn--primary')}
            onClick={this.handleCreateBug}
            disabled={disabled || busy}
          >
            {pending === 'bug' ? 'Creating Jira bug…' : 'Create Jira bug'}
          </button>
          <button
            type="button"
            className={cx('action-btn')}
            onClick={this.handleNotify}
            disabled={disabled || busy}
          >
            {pending === 'notify' ? 'Notifying gate…' : 'Notify gate'}
          </button>
          {showRerun && (
            <button
              type="button"
              className={cx('action-btn')}
              onClick={this.handleRerun}
              disabled={disabled || busy}
            >
              {pending === 'rerun' ? 'Re-running…' : 'Re-run failed'}
            </button>
          )}
        </div>
        {disabled && disabledReason && <p className={cx('action-hint')}>{text(disabledReason)}</p>}
        {this.renderResult()}
      </div>
    );
  }
}

const PerformanceSessionSummary = ({ section }) => (
  <table className={cx('table')}>
    <tbody>
      {(section.data?.areas || []).map((area) => (
        <tr key={area.area}>
          <td>{text(area.area)}</td>
          <td>
            <Badge value={area.status} />
          </td>
          <td>{text(area.finding)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

PerformanceSessionSummary.propTypes = {
  section: PropTypes.object.isRequired,
};

const ListBlock = ({ title, items = [], renderItem = null }) => {
  if (!items.length) {
    return null;
  }

  return (
    <Fragment>
      <h4 className={cx('section-subtitle')}>{title}</h4>
      <ol className={cx('ordered-list')}>
        {items.map((item, index) => (
          <li key={item.id || item.key || index}>{renderItem ? renderItem(item) : text(item)}</li>
        ))}
      </ol>
    </Fragment>
  );
};

ListBlock.propTypes = {
  title: PropTypes.string.isRequired,
  items: PropTypes.array,
  renderItem: PropTypes.func,
};

// AiRcaInsights is declared further down (after KpiBudgetMeter, whose threshold
// formatting it reuses). Both call sites — SectionBody and the tab's own render —
// resolve the binding at RENDER time, so the later declaration is safe.

const NetworkIntelligence = ({ section }) => {
  const data = section.data || {};
  const rows = data.slow_requests || data.rows || [];

  return (
    <div>
      {data.summary && <p>{text(data.summary)}</p>}
      <table className={cx('table')}>
        <thead>
          <tr>
            <th>Host</th>
            <th>Sanitized path</th>
            <th>Request type</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Threshold</th>
            <th>Impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.host || row.sanitized_url}-${row.sanitized_path || row.url}-${
                row.duration_ms
              }`}
            >
              <td>{text(row.host)}</td>
              <td>
                <code>{text(row.sanitized_path || row.sanitized_url)}</code>
              </td>
              <td>{text(row.request_type || row.type)}</td>
              <td>{text(row.status_code)}</td>
              <td>{text(row.duration_ms)}ms</td>
              <td>{text(row.threshold_ms)}ms</td>
              <td>{text(row.impact)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

NetworkIntelligence.propTypes = {
  section: PropTypes.object.isRequired,
};

const KpiTable = ({ rows = [] }) => (
  <table className={cx('table')}>
    <thead>
      <tr>
        <th>KPI</th>
        <th>Value</th>
        <th>Status</th>
        <th>Owner</th>
        <th>Evidence</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((kpi) => (
        <tr key={kpi.id || kpi.key}>
          <td>{text(kpi.display_name || kpi.key)}</td>
          <td>{text(kpi.formatted_value || kpi.value)}</td>
          <td>
            <Badge value={kpi.status} />
          </td>
          <td>{text(kpi.owner)}</td>
          <td>{text(kpi.evidence)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

KpiTable.propTypes = {
  rows: PropTypes.array,
};

const ArtifactsEvidence = ({ section }) => {
  const rows = section.data?.artifacts || section.data?.rows || [];

  return (
    <table className={cx('table')}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Name</th>
          <th>Storage</th>
          <th>URI</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((artifact) => (
          <tr key={artifact.id || artifact.uri || artifact.object_key || artifact.name}>
            <td>{text(artifact.type)}</td>
            <td>{text(artifact.name || artifact.filename)}</td>
            <td>{text(artifact.storage || artifact.storage_backend)}</td>
            <td>
              <ArtifactUri artifact={artifact} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

ArtifactsEvidence.propTypes = {
  section: PropTypes.object.isRequired,
};

// History / Regression: this test's Top KPIs vs the SAME test in prior runs.
// Direction-aware verdicts arrive from the API (rising rebuffer = regression,
// rising bitrate = improvement); 'no_data' renders muted — never a fabricated 0.
const HistoryRegression = ({ section }) => {
  const data = section.data || {};
  const rows = data.rows || [];
  const builds = data.builds || {};

  // Δ column: sign-carrying percent, or an honest "—" when there is no relative scale.
  const fmtDelta = (deltaPct) => {
    if (deltaPct === null || deltaPct === undefined) {
      return '—';
    }
    return `${deltaPct > 0 ? '+' : ''}${deltaPct}%`;
  };

  return (
    <div className={cx('history')}>
      {data.no_data_reason && <p className={cx('history-note')}>{text(data.no_data_reason)}</p>}
      {data.note && <p className={cx('history-note')}>{text(data.note)}</p>}
      {rows.length > 0 && (
        <table className={cx('table')}>
          <thead>
            <tr>
              <th>KPI</th>
              <th>Current</th>
              {/* With one degenerate build label the comparison is run-over-run — the
                  header must say so rather than implying a per-build trend. */}
              <th>{builds.degenerate ? 'Prev run' : 'Prev build'}</th>
              <th>Prev-5 median</th>
              <th>Δ</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kpi_key || row.display_name}>
                <td>{text(row.display_name || row.kpi_key)}</td>
                <td>
                  {fmtNum(row.current)}
                  {row.unit ? <span className={cx('history-unit')}> {text(row.unit)}</span> : null}
                </td>
                <td>{fmtNum(row.previous)}</td>
                <td>{fmtNum(row.prev5_median)}</td>
                <td>{fmtDelta(row.delta_pct)}</td>
                <td>
                  {row.status === 'no_data' ? (
                    <span className={cx('history-nodata')}>no data</span>
                  ) : (
                    <Badge value={row.status} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

HistoryRegression.propTypes = {
  section: PropTypes.object.isRequired,
};

const APP_HEALTH_FAULTS = [
  { key: 'crashes', label: 'Crashes' },
  { key: 'native_crashes', label: 'Native crashes' },
  { key: 'anrs', label: 'ANRs' },
  { key: 'oom_kills', label: 'OOM kills' },
];

const AppHealth = ({ section }) => {
  const data = section.data || {};

  // HONESTY: when nothing was captured we must NEVER render green zeros that
  // imply a clean bill of health. Show only the honest "Not captured" note.
  if (!data.captured) {
    return (
      <div className={cx('app-health', 'not-captured')}>
        <div className={cx('app-health-headline')}>
          <span className={cx('app-health-metric-label')}>Crash-free rate</span>
          <b className={cx('app-health-metric-value', 'muted')}>Not captured</b>
        </div>
        <p className={cx('app-health-note')}>
          {text(data.note) ||
            'Not captured — no on-device ApplicationExitInfo snapshot for this run.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cx('app-health')}>
      <div className={cx('app-health-headline')}>
        <span className={cx('app-health-metric-label')}>Crash-free rate</span>
        <b className={cx('app-health-metric-value')}>{crashFreePercent(data.crash_free_rate)}</b>
      </div>
      <table className={cx('table')}>
        <thead>
          <tr>
            {APP_HEALTH_FAULTS.map((fault) => (
              <th key={fault.key}>{fault.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {APP_HEALTH_FAULTS.map((fault) => (
              <td
                key={fault.key}
                className={cx('fault-cell', { 'fault-cell--nonzero': Number(data[fault.key]) > 0 })}
              >
                {text(data[fault.key])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {data.note && <p className={cx('app-health-note')}>{text(data.note)}</p>}
    </div>
  );
};

AppHealth.propTypes = {
  section: PropTypes.object.isRequired,
};

const SectionBody = ({
  section,
  rpItemId = null,
  functionalStatus = '',
  actionsDisabled = false,
  actionsDisabledReason = '',
  networkStatus = '',
}) => {
  if (section.type === 'summary') {
    return <PerformanceSessionSummary section={section} />;
  }
  if (section.type === 'rca') {
    return (
      <AiRcaInsights
        section={section}
        rpItemId={rpItemId}
        functionalStatus={functionalStatus}
        actionsDisabled={actionsDisabled}
        actionsDisabledReason={actionsDisabledReason}
        networkStatus={networkStatus}
      />
    );
  }
  if (section.type === 'network') {
    return <NetworkIntelligence section={section} />;
  }
  if (section.type === 'kpi_table') {
    return <KpiTable rows={section.data?.rows || []} />;
  }
  if (section.type === 'artifacts') {
    return <ArtifactsEvidence section={section} />;
  }
  if (section.type === 'history') {
    return <HistoryRegression section={section} />;
  }
  if (section.type === 'app_health') {
    return <AppHealth section={section} />;
  }

  return <pre className={cx('pre')}>{JSON.stringify(section.data || {}, null, 2)}</pre>;
};

SectionBody.propTypes = {
  section: PropTypes.object.isRequired,
  rpItemId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  functionalStatus: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  actionsDisabled: PropTypes.bool,
  actionsDisabledReason: PropTypes.string,
  networkStatus: PropTypes.string,
};

export const KpiAccordionSection = ({
  section,
  rpItemId = null,
  functionalStatus = '',
  actionsDisabled = false,
  actionsDisabledReason = '',
}) => {
  if (!hasSectionContent(section)) {
    return null;
  }

  return (
    <details
      className={cx('accordion', statusClass(section.status))}
      open={shouldAutoExpandSection(section)}
    >
      <summary>
        <span>{text(section.title)}</span>
        <Badge value={section.status} />
      </summary>
      <div className={cx('accordion-body')}>
        <SectionBody
          section={section}
          rpItemId={rpItemId}
          functionalStatus={functionalStatus}
          actionsDisabled={actionsDisabled}
          actionsDisabledReason={actionsDisabledReason}
        />
      </div>
    </details>
  );
};

KpiAccordionSection.propTypes = {
  section: PropTypes.object.isRequired,
  rpItemId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  functionalStatus: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  actionsDisabled: PropTypes.bool,
  actionsDisabledReason: PropTypes.string,
};

// ── Design surface: verdict cards, rich KPI grid, session replay, by-section ──

const VERDICT_META = [
  { key: 'functional', eyebrow: 'FUNCTIONAL · PYTEST' },
  { key: 'experience', eyebrow: 'EXPERIENCE · OBSERVABILITY' },
  { key: 'gate', eyebrow: 'RELEASE-GATE CONTRIBUTION' },
];

const VerdictCards = ({ session = {}, topKpis = [], verdict = null }) => {
  const v = verdict || {};
  const gateCrit = topKpis.filter(
    (k) => k.release_gate && ['failed', 'critical'].includes(statusClass(k.status)),
  );
  const cards = {
    functional: {
      status: session.functional_status,
      headline: v.functional_headline || text(session.functional_status) || 'Unknown',
      note:
        v.functional_note ||
        'Functional pass/fail is decided by assertions — never rewritten by experience signals.',
    },
    experience: {
      status: session.observability_status,
      headline: v.experience_headline || text(session.observability_status) || 'Unknown',
      note:
        v.experience_note ||
        'Experience KPIs are observed alongside the functional result and never block it.',
    },
    gate: {
      status: gateCrit.length ? 'failed' : 'passed',
      headline: v.gate_headline || `${gateCrit.length} critical KPI${gateCrit.length === 1 ? '' : 's'}`,
      note:
        v.gate_note ||
        (gateCrit.length
          ? 'Feeds the run-level release gate — not a per-test block.'
          : 'No release-gate KPI breached for this test.'),
    },
  };
  return (
    <div className={cx('verdicts')}>
      {VERDICT_META.map(({ key, eyebrow }) => {
        const c = cards[key];
        return (
          <div className={cx('verdict-card', statusClass(c.status))} key={key}>
            <div className={cx('verdict-eyebrow')}>{eyebrow}</div>
            <div className={cx('verdict-headline')}>{text(c.headline)}</div>
            <p className={cx('verdict-note')}>{text(c.note)}</p>
          </div>
        );
      })}
    </div>
  );
};
VerdictCards.propTypes = {
  session: PropTypes.object,
  topKpis: PropTypes.array,
  verdict: PropTypes.object,
};

// Fallback only — used when the payload predates `threshold_view`. Handles BOTH the
// legacy {max|min|warn|fail|value} shape and the current {budget, direction} shape;
// the old version read only the legacy keys, so it silently rendered an EMPTY budget
// for every KPI the live backend actually serves.
const formatThreshold = (kpi) => {
  if (kpi.threshold_label) return kpi.threshold_label;
  const t = kpi.threshold || {};
  if (t.budget !== undefined && t.budget !== null) {
    return `${t.direction === 'min' ? '≥' : '≤'}${t.budget}${text(kpi.unit === 'fraction' ? '' : kpi.unit)}`;
  }
  const bound = t.max ?? t.warn ?? t.fail ?? t.value ?? t.min;
  if (bound === undefined || bound === null) return '';
  const op = t.min !== undefined && t.max === undefined ? '≥' : '≤';
  return `${op}${bound}${text(kpi.unit || '')}`;
};

// Value-vs-budget row. The budget tick sits at the same x on every card, so the row of
// ticks reads as one shared reference line down the grid. Numbers come from the
// backend's threshold_view, which pins budget and delta to the VALUE's own scale — the
// old footer compared e.g. "873" against a raw "3000.0" from a different unit basis.
const KpiBudgetMeter = ({ view }) => {
  const tick = view.tick_pct === null || view.tick_pct === undefined ? 62 : view.tick_pct;
  const fill = Math.max(0, Math.min(100, view.bar_pct === null || view.bar_pct === undefined ? 0 : view.bar_pct));

  return (
    <div className={cx('kpi-budget')}>
      <div className={cx('kpi-budget-line')}>
        <span className={cx('kpi-budget-target')}>
          {text(view.comparator)} {text(view.budget_text)}
        </span>
        <span className={cx('kpi-budget-delta')}>{text(view.delta_text)}</span>
      </div>
      <div
        className={cx('kpi-meter', { breached: Boolean(view.breached) })}
        role="img"
        aria-label={`${text(view.value_text)} against a budget of ${text(view.comparator)} ${text(
          view.budget_text,
        )}; ${text(view.delta_text)}`}
      >
        <span className={cx('kpi-meter-fill')} style={{ width: `${fill}%` }} />
        <span className={cx('kpi-meter-tick')} style={{ left: `${tick}%` }} aria-hidden="true" />
        {view.overflow && (
          <span className={cx('kpi-meter-overflow')} aria-hidden="true">
            »
          </span>
        )}
      </div>
    </div>
  );
};

KpiBudgetMeter.propTypes = { view: PropTypes.object.isRequired };

// ── AI RCA & Insights ────────────────────────────────────────────────────────
// PANEL CONTRACT — do not relax without a design review.
//  1. NEVER interpolate a dict-shaped payload field (kpi.threshold, jira_ready, …)
//     into prose or a template literal. The API serves threshold as {budget, direction};
//     a template literal prints "{'budget': 3000, 'direction': 'max'}" at a human.
//     Budgets render ONLY as columns of <RcaBudgetTable/>.
//  2. Confidence renders ONLY when an engine actually matched, and is always labelled
//     with WHICH engine produced it — the rules engine and the signature library
//     disagree in live data. Both unmatched branches emit a no-basis 0.0; printing
//     that as "0%" asserts a measurement nobody made.
//  3. ONE accent in this panel: --sp-crit, and only on a MEASURED breach (severity
//     cell, budget-table State/Delta). Diagnosis, evidence, reasoning and owner stay
//     neutral — a missing diagnosis is not an alarm.
//  4. Colour is never the only signal: glyph + word accompany every state.
//  5. No readable copy in --sp-faint (2.2–3.0:1 measured, both themes fail AA).
// Display-only: nothing here gates anything.
const rcaDiagnosisCopy = (verdict) => {
  if (verdict.state === 'matched') {
    return {
      headline: verdict.category,
      note:
        `Matched by the ${verdict.classifier}. A match identifies WHERE to look from ` +
        'measured evidence; it is not proof of the underlying cause, and it never gates the run.',
    };
  }

  if (verdict.state === 'nothing_to_explain') {
    return {
      headline: 'Nothing to diagnose',
      note:
        'No KPI breached on this run, so no root-cause analysis was attempted. Confidence and ' +
        'owner are not shown because no question was asked.',
    };
  }

  if (verdict.state === 'degraded') {
    return {
      headline: 'Classifier did not run',
      note:
        'The signature library could not be evaluated for this session, so no diagnosis exists — ' +
        '“matched” and “no match” are indistinguishable here. The measured KPI breaches below are ' +
        'unaffected and remain valid.',
    };
  }

  const evaluated = verdict.signaturesEvaluated;
  const counted =
    evaluated === null
      ? 'The signature library was evaluated against this session’s evidence; nothing matched.'
      : `${evaluated === 1 ? '1 signature' : `${evaluated} signatures`} in this project’s library ` +
        `${evaluated === 1 ? 'was' : 'were'} evaluated against this session’s evidence; ` +
        'none matched.';

  return {
    headline: 'No matching signature',
    note:
      `${counted} That is not a fault in the run — it means no rule has been authored for this ` +
      'pattern yet. Use the measured breaches and the endpoint evidence below to decide where to ' +
      'look, then author a signature so the next run classifies itself.',
  };
};

// L1. TWO facts, explicitly labelled, never fused into one verdict.
//   left  = how bad is the MEASURED evidence (earned; carries the one accent)
//   right = do we know WHY                   (always neutral, in every state)
const RcaVerdictHeader = ({ verdict, breached, atRisk }) => {
  const copy = rcaDiagnosisCopy(verdict);

  return (
    <div className={cx('rca-verdict')}>
      <div className={cx('rca-verdict-cell', breached > 0 ? 'state-breached' : 'state-passed')}>
        <div className={cx('rca-verdict-label')}>Severity of evidence</div>
        <div className={cx('rca-verdict-headline')}>
          {breached > 0 ? (
            <Fragment>
              <span className={cx('rca-verdict-glyph')} aria-hidden="true">
                ▲
              </span>
              {breached} KPI{breached === 1 ? '' : 's'} breached
            </Fragment>
          ) : (
            'No KPI breached'
          )}
          {atRisk > 0 && <span className={cx('rca-verdict-aside')}> · {atRisk} at risk</span>}
        </div>
        <p className={cx('rca-verdict-note')}>
          {breached > 0
            ? 'Measured against the KPI catalog’s budgets. An experience breach never rewrites the ' +
              'functional pass/fail above.'
            : 'Every KPI that had a budget on this run was inside it.'}
        </p>
      </div>

      <div className={cx('rca-verdict-cell', 'rca-verdict-cell--neutral')}>
        <div className={cx('rca-verdict-label')}>Diagnosis</div>
        <div className={cx('rca-verdict-headline')}>{text(copy.headline)}</div>
        <p className={cx('rca-verdict-note')}>{copy.note}</p>
        {verdict.corroborated === false && (
          <p className={cx('rca-verdict-note')}>
            The signature library ran over the same evidence and did not corroborate this category,
            so it rests on the rules engine alone — a lead to check, not a confirmed diagnosis.
          </p>
        )}
      </div>
    </div>
  );
};

RcaVerdictHeader.propTypes = {
  verdict: PropTypes.object.isRequired,
  breached: PropTypes.number.isRequired,
  atRisk: PropTypes.number.isRequired,
};

// Every absent value states WHY it is absent, in the state's own terms. None of them
// is a number, and none of them is 0 — the payload's 0.0 is a no-basis value.
const RCA_ABSENT_COPY = {
  nothing_to_explain: {
    confidence: 'Not applicable — no breach to explain',
    owner: 'Not applicable — nothing to route',
    classifier: 'Not attempted',
  },
  degraded: {
    confidence: 'Not computed — classifier did not run',
    owner: 'Not routed — classifier did not run',
    classifier: 'Did not run',
  },
  unmatched: {
    confidence: 'Not computed — no rule or signature matched',
    owner: 'Not routed — no rule matched',
    classifier: 'Nothing matched',
  },
};

// L1b. Everything the old summary-grid gave headline weight, demoted to a strip.
// Confidence keeps its ROW but loses its NUMBER whenever nothing matched.
const RcaMetaStrip = ({ verdict }) => {
  const matched = verdict.state === 'matched';
  const absent = RCA_ABSENT_COPY[verdict.state] || RCA_ABSENT_COPY.unmatched;
  const evaluated = verdict.signaturesEvaluated;
  const classifier =
    verdict.state === 'unmatched' && evaluated !== null
      ? `${absent.classifier} · ${evaluated} signature${evaluated === 1 ? '' : 's'} evaluated`
      : absent.classifier;
  const items = [
    matched
      ? { key: 'conf', label: 'Confidence', value: percent(verdict.confidence) }
      : { key: 'conf', label: 'Confidence', value: absent.confidence, absent: true },
    // Owner is deliberately NOT shown here. The rules engine routes a team name
    // ("Mobile App") from the breached KPI's category alone -- it is a routing hint,
    // not a finding, and printed next to a real confidence figure and evidence hash it
    // reads as an accountable assignment the evidence does not support. The routing
    // still travels in the payload (verdict.owner) for whoever consumes it downstream.
    matched
      ? { key: 'by', label: 'Classified by', value: verdict.classifier }
      : { key: 'by', label: 'Classified by', value: classifier, absent: true },
  ];

  return (
    <dl className={cx('rca-meta')}>
      {items.map((item) => (
        <div className={cx('rca-meta-item')} key={item.key}>
          <dt>{item.label}</dt>
          <dd className={cx({ 'rca-meta-absent': Boolean(item.absent) })}>{text(item.value)}</dd>
        </div>
      ))}
      {verdict.evidenceHash && (
        <div className={cx('rca-meta-item')} key="hash">
          <dt>Evidence hash</dt>
          <dd>
            <code className={cx('artifact-code')}>{verdict.evidenceHash.slice(0, 12)}</code>
            <button
              type="button"
              className={cx('copy-btn')}
              onClick={() => copyToClipboard(verdict.evidenceHash)}
              aria-label="Copy the full evidence hash"
            >
              Copy
            </button>
          </dd>
        </div>
      )}
    </dl>
  );
};

RcaMetaStrip.propTypes = { verdict: PropTypes.object.isRequired };

// L2. Budgets as ALIGNED COLUMNS — the reason no budget dict is ever interpolated into
// prose here. `kpi.threshold` is only ever read field-by-field, via threshold_view when
// the payload carries one and formatThreshold() when it does not.
const RcaBudgetTable = ({ kpis }) => {
  if (!kpis.length) {
    return null;
  }

  return (
    <section className={cx('rca-block')} aria-labelledby="rca-breaches">
      <h4 className={cx('rca-block-title')} id="rca-breaches">
        What breached
      </h4>
      <div className={cx('rca-table-wrap')}>
        <table className={cx('rca-table')}>
          <thead>
            <tr>
              <th scope="col">KPI</th>
              <th scope="col" className={cx('rca-num')}>
                Measured
              </th>
              <th scope="col" className={cx('rca-num')}>
                Budget
              </th>
              <th scope="col" className={cx('rca-num')}>
                Delta
              </th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((kpi) => {
              const { state, glyph, label } = kpiDisplayState(kpi);
              const view = kpi.threshold_view;
              const unit = kpi.unit && kpi.unit !== 'fraction' ? ` ${text(kpi.unit)}` : '';
              const measured = text(kpi.formatted_value) || `${fmtNum(kpi.value)}${unit}`;
              const budget = view
                ? `${text(view.comparator)} ${text(view.budget_text)}`
                : formatThreshold(kpi);

              return (
                <tr key={kpi.id || kpi.key}>
                  <th scope="row" className={cx('rca-table-kpi')}>
                    <span className={cx('rca-table-kpi-name')}>{kpiDisplayName(kpi)}</span>
                    <span className={cx('rca-table-kpi-key')}>{text(kpi.raw_key || kpi.key)}</span>
                  </th>
                  <td className={cx('rca-num')}>{measured}</td>
                  <td className={cx('rca-num')}>
                    {budget || <span className={cx('rca-absent')}>no budget</span>}
                  </td>
                  <td
                    className={cx('rca-num', {
                      'rca-delta-breached': Boolean(view && view.breached),
                    })}
                  >
                    {view ? (
                      text(view.delta_text)
                    ) : (
                      <span className={cx('rca-absent')}>not computed</span>
                    )}
                  </td>
                  <td>
                    <span className={cx('rca-state', `state-${state}`)}>
                      <span className={cx('rca-state-glyph')} aria-hidden="true">
                        {glyph}
                      </span>
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={cx('rca-block-note')}>
        Budgets come from the KPI catalog. A breach here is an observation about experience — it
        never rewrites the functional pass/fail above.
      </p>
    </section>
  );
};

RcaBudgetTable.propTypes = { kpis: PropTypes.array.isRequired };

const RCA_EVIDENCE_VISIBLE = 6;

const RcaEvidenceRows = ({ groups }) => (
  // `rca-table-endpoints` opts THIS table into fixed column widths so the visible
  // half and the folded half line up. It must not be on `.rca-table` itself --
  // that class is shared with the What-Breached table, whose wider DELTA text
  // ("8.82 s over budget") overflows a pinned numeric column and collides with
  // the next cell.
  <table className={cx('rca-table', 'rca-table-endpoints')}>
    <thead>
      <tr>
        <th scope="col">Endpoint</th>
        <th scope="col" className={cx('rca-num')}>
          Hits
        </th>
        <th scope="col" className={cx('rca-num')}>
          Median
        </th>
        <th scope="col" className={cx('rca-num')}>
          Worst
        </th>
        <th scope="col" className={cx('rca-num')}>
          Threshold
        </th>
        <th scope="col" className={cx('rca-num')}>
          First seen
        </th>
      </tr>
    </thead>
    <tbody>
      {groups.map((group) => (
        <tr key={group.id}>
          <th scope="row" className={cx('rca-table-kpi')}>
            <span className={cx('rca-table-kpi-name')}>{group.host || 'unknown host'}</span>
            <span className={cx('rca-table-kpi-key')}>
              {group.path}
              {group.type ? ` · ${group.type}` : ''}
              {group.statusCodes.length ? ` · HTTP ${group.statusCodes.join('/')}` : ''}
            </span>
          </th>
          <td className={cx('rca-num', 'rca-num-strong')}>{group.hits}</td>
          <td className={cx('rca-num')}>{group.medianMs === null ? '—' : `${group.medianMs} ms`}</td>
          <td className={cx('rca-num')}>{group.worstMs === null ? '—' : `${group.worstMs} ms`}</td>
          <td className={cx('rca-num')}>
            {group.thresholdMs === null ? '—' : `${group.thresholdMs} ms`}
          </td>
          <td className={cx('rca-num')}>{group.firstMs === null ? '—' : fmtClock(group.firstMs)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

RcaEvidenceRows.propTypes = { groups: PropTypes.array.isRequired };

// L2. Grouped, so "one endpoint, ten hits" is the headline instead of ten of twenty
// rows. Deliberately carries NO accent: an over-threshold request is a lead, not a
// breach — the breach is the KPI, already coloured one block above.
const RcaEvidence = ({ rows, networkStatus }) => {
  const groups = groupSlowRequests(rows);

  if (!groups.length) {
    // Two very different situations reach here; say which one rather than claiming a
    // clean network out of an absent measurement. An absent status is treated as "we
    // cannot tell" — never as "nothing was slow".
    const noCapture = ['', 'unknown'].includes(text(networkStatus).toLowerCase());

    return (
      <section className={cx('rca-block')} aria-labelledby="rca-evidence">
        <h4 className={cx('rca-block-title')} id="rca-evidence">
          Where to look
        </h4>
        <p className={cx('rca-block-note')}>
          {noCapture
            ? 'No network capture is attached to this session, so the network plane offers no lead. ' +
              'This is an absence of measurement, not a clean result.'
            : 'No request exceeded its network threshold on this session. Open Network Intelligence ' +
              'below for the full request list.'}
        </p>
      </section>
    );
  }

  const top = groups[0];
  const totalHits = groups.reduce((sum, group) => sum + group.hits, 0);
  const share = topHostShare(groups);

  return (
    <section className={cx('rca-block')} aria-labelledby="rca-evidence">
      <h4 className={cx('rca-block-title')} id="rca-evidence">
        Where to look
      </h4>
      <p className={cx('rca-lede')}>
        {totalHits} request{totalHits === 1 ? '' : 's'} over threshold across {groups.length}{' '}
        endpoint{groups.length === 1 ? '' : 's'}.{' '}
        {top.hits > 1 ? (
          <Fragment>
            The most repeated is{' '}
            <b>
              {top.host}
              {top.path}
            </b>{' '}
            — {top.hits} hits, median {top.medianMs} ms, worst {top.worstMs} ms against a{' '}
            {top.thresholdMs} ms threshold.
          </Fragment>
        ) : (
          <Fragment>
            No endpoint repeated; the slowest is{' '}
            <b>
              {top.host}
              {top.path}
            </b>{' '}
            at {top.worstMs} ms against a {top.thresholdMs} ms threshold.
          </Fragment>
        )}
      </p>
      {share && share.hostCount > 1 && (
        <p className={cx('rca-block-note')}>
          {share.host} accounts for {share.hits} of {share.total} over-threshold requests.
        </p>
      )}
      <div className={cx('rca-table-wrap')}>
        <RcaEvidenceRows groups={groups.slice(0, RCA_EVIDENCE_VISIBLE)} />
      </div>
      {groups.length > RCA_EVIDENCE_VISIBLE && (
        <details className={cx('rca-fold')}>
          <summary className={cx('rca-fold-more')}>
            Show the remaining {groups.length - RCA_EVIDENCE_VISIBLE} endpoints
          </summary>
          <div className={cx('rca-table-wrap')}>
            <RcaEvidenceRows groups={groups.slice(RCA_EVIDENCE_VISIBLE)} />
          </div>
        </details>
      )}
      <p className={cx('rca-block-note')}>
        Grouped from {totalHits} measured requests in this session only. “Threshold” is the
        network-intelligence threshold for the request type — not a KPI budget.
      </p>
    </section>
  );
};

RcaEvidence.propTypes = {
  rows: PropTypes.array,
  networkStatus: PropTypes.string,
};

// L4. The prose, demoted and collapsed. If it still carries a serialized object we do
// NOT prettify it — we name the emitter and show it raw, because a frontend that papers
// over a fabricating backend hides the defect from everyone reading the same field.
const RcaReasoning = ({ data }) => {
  const prose = text(data.detailed_reasoning || data.reasoning || data.summary);

  if (!prose) {
    return null;
  }

  return (
    <details className={cx('rca-block', 'rca-fold')}>
      <summary className={cx('rca-block-title')}>Reasoning and provenance</summary>
      <div className={cx('rca-fold-body')}>
        {containsSerializedDict(prose) ? (
          <Fragment>
            <p className={cx('rca-block-note')}>
              Shown raw: the emitter serialized a Python object into this text (the KPI budget is a
              dict). Fix the emitter, not this panel — the same string is copied into the
              Jira-ready draft below.
            </p>
            <pre className={cx('pre')}>{prose}</pre>
          </Fragment>
        ) : (
          <p className={cx('rca-prose')}>{prose}</p>
        )}
        <p className={cx('rca-block-note')}>
          Deterministic rules and signatures decide category, owner and confidence. The LLM only
          proposes candidate signatures for human review and can never emit or gate a verdict.
        </p>
      </div>
    </details>
  );
};

RcaReasoning.propTypes = { data: PropTypes.object.isRequired };

const RCA_CHIP_DIAGNOSIS = {
  degraded: 'classifier did not run',
  nothing_to_explain: 'nothing to diagnose',
  unmatched: 'no matching signature',
};

// Neutral by design. The old <Badge value={rcaSection.status}/> printed a red CRITICAL
// whose only basis is a COUNT of measured KPI breaches — beside "0% confidence" it read
// as a diagnosis nobody made. The count says the same thing precisely, without an alarm.
const RcaHeadChip = ({ section }) => {
  const data = section.data || {};
  const relatedKpis = data.related_kpis || data.kpis || [];
  const breached = relatedKpis.filter((k) => kpiDisplayState(k).state === 'breached').length;
  const verdict = rcaVerdict(data, breached);
  const diagnosis =
    verdict.state === 'matched'
      ? text(verdict.category).toLowerCase()
      : RCA_CHIP_DIAGNOSIS[verdict.state] || RCA_CHIP_DIAGNOSIS.unmatched;

  return (
    <span className={cx('rca-head-chip')}>
      {breached > 0 ? `${breached} breached · ${diagnosis}` : diagnosis}
    </span>
  );
};

RcaHeadChip.propTypes = { section: PropTypes.object.isRequired };

const AiRcaInsights = ({
  section,
  rpItemId = null,
  functionalStatus = '',
  actionsDisabled = false,
  actionsDisabledReason = '',
  networkStatus = '',
}) => {
  const data = section.data || {};
  // STRICT source list. `data.evidence` is deliberately NOT a fallback: those are
  // pre-formatted strings that already carry the raw threshold dict, and rendering
  // them is how that dict reaches the screen.
  const slowRows = data.slow_url_api_cdn_evidence || data.slow_requests || [];
  const timeline = data.timeline_correlation || data.timeline || data.correlations || [];
  const relatedKpis = data.related_kpis || data.kpis || [];
  const rawActions = data.recommended_action || data.suggested_actions || [];
  const actions = (Array.isArray(rawActions) ? rawActions : [rawActions]).filter(Boolean);
  const breached = relatedKpis.filter((k) => kpiDisplayState(k).state === 'breached').length;
  const atRisk = relatedKpis.filter((k) => kpiDisplayState(k).state === 'at_risk').length;
  const verdict = rcaVerdict(data, breached);

  return (
    <div className={cx('rca')}>
      <RcaVerdictHeader verdict={verdict} breached={breached} atRisk={atRisk} />
      <RcaMetaStrip verdict={verdict} />
      <RcaBudgetTable kpis={relatedKpis} />
      <RcaEvidence rows={slowRows} networkStatus={networkStatus} />
      {timeline.length > 0 && (
        <div className={cx('rca-block')}>
          <ListBlock
            title="Timeline correlation"
            items={timeline}
            renderItem={(item) =>
              typeof item === 'string'
                ? text(item)
                : `${text(item.timestamp_ms || item.start_ms)}ms - ${text(
                    item.event || item.description || item.type,
                  )}`
            }
          />
        </div>
      )}
      <RcaReasoning data={data} />
      {actions.length > 0 && (
        <div className={cx('rca-block')}>
          <ListBlock title="Standard triage checklist" items={actions} />
          <p className={cx('rca-block-note')}>
            The same steps are attached to every session — a checklist, not a recommendation
            derived from this run.
          </p>
        </div>
      )}
      {data.jira_ready && (
        <details className={cx('rca-block', 'rca-fold')}>
          <summary className={cx('rca-block-title')}>Jira-ready draft</summary>
          <div className={cx('rca-fold-body')}>
            <dl className={cx('jira-draft')}>
              {data.jira_ready.summary && (
                <Fragment>
                  <dt>Summary</dt>
                  <dd>{text(data.jira_ready.summary)}</dd>
                </Fragment>
              )}
              {data.jira_ready.description && (
                <Fragment>
                  <dt>Description</dt>
                  <dd>{text(data.jira_ready.description)}</dd>
                </Fragment>
              )}
            </dl>
          </div>
        </details>
      )}
      <RcaActions
        rpItemId={rpItemId}
        jiraReady={data.jira_ready}
        functionalStatus={functionalStatus}
        disabled={actionsDisabled}
        disabledReason={actionsDisabledReason}
      />
    </div>
  );
};

AiRcaInsights.propTypes = {
  section: PropTypes.object.isRequired,
  rpItemId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  functionalStatus: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  actionsDisabled: PropTypes.bool,
  actionsDisabledReason: PropTypes.string,
  networkStatus: PropTypes.string,
};

// Honest by construction:
//  - `no_data` renders as an em-dash on a hatched, dashed-border card with no shadow.
//    It can never be mistaken for a measurement, and a real measured 0 renders as a
//    normal solid card reading "0%".
//  - "Observed" (measured, no budget) is visually separate from "Within budget". We
//    never show a pass swatch for a number nothing was checked against.
//  - Never color alone (WCAG 1.4.1): every state carries glyph + word + color.
// Display-only. Nothing here changes pass/fail; gating lives in the test's
// PASS_CRITERIA_ASSERTED and the KPI catalog budgets.
const KpiTile = ({ kpi, trendMeasured, onTrend }) => {
  const { state, glyph, label } = kpiDisplayState(kpi);
  const isNoData = state === 'no_data';
  const name = kpiDisplayName(kpi);
  const value =
    kpi.display_value !== null && kpi.display_value !== undefined && kpi.display_value !== ''
      ? kpi.display_value
      : kpi.formatted_value;
  const unit = text(kpi.display_unit);
  const view = kpi.threshold_view;
  const legacyThreshold = view ? '' : formatThreshold(kpi);
  const isGate = Boolean(kpi.release_gate);
  // The `gate` emphasis border is reserved for a release-gate KPI that actually
  // BREACHED. A passing gate KPI still gets the GATE chip, but must not wear the
  // critical border — that would read as a failure it did not have.
  const gate = isGate && state === 'breached';

  return (
    <div className={cx('kpi-tile', `state-${state}`, { gate })} data-state={state} key={kpi.id || kpi.key}>
      <div className={cx('kpi-tile-head')}>
        <span className={cx('kpi-tile-name')} title={name}>
          {name}
        </span>
        {isGate && (
          <span className={cx('kpi-tile-gate')} title="Release-gate KPI">
            GATE
          </span>
        )}
      </div>

      {isNoData ? (
        <div className={cx('kpi-tile-value', 'absent')} aria-hidden="true">
          —
        </div>
      ) : (
        <div className={cx('kpi-tile-value')}>
          {text(value)}
          {unit && <span className={cx('kpi-tile-unit')}>{unit}</span>}
        </div>
      )}

      <div className={cx('kpi-tile-state', `state-${state}`)}>
        <span className={cx('kpi-tile-glyph')} aria-hidden="true">
          {glyph}
        </span>
        {label}
      </div>

      {isNoData && (
        <p className={cx('kpi-tile-note')}>
          {text(kpi.no_data_reason) || 'Not captured on this run — no value was recorded.'}
        </p>
      )}

      {!isNoData && view && <KpiBudgetMeter view={view} />}

      {!isNoData && !view && (
        <p className={cx('kpi-tile-note')}>
          {legacyThreshold
            ? `Budget ${legacyThreshold}`
            : 'No budget defined — recorded for observation, not judged.'}
        </p>
      )}

      {/* Across-run affordance. Never offer a control that leads nowhere: with fewer
          than 2 measured runs there is nothing to chart, so this is static text, not a
          button. `trendMeasured === null` means the payload carries no trend at all. */}
      {trendMeasured !== null && trendMeasured >= 2 && (
        <button
          type="button"
          className={cx('kpi-tile-trend')}
          onClick={() => onTrend(kpi.raw_key || kpi.key)}
        >
          Trend › <span className={cx('kpi-tile-trend-n')}>{trendMeasured} runs</span>
        </button>
      )}
      {trendMeasured !== null && trendMeasured < 2 && (
        <p className={cx('kpi-tile-note')}>
          {trendMeasured === 1
            ? '1 run of history — not enough to trend.'
            : 'No measured history yet — not enough to trend.'}
        </p>
      )}
    </div>
  );
};

KpiTile.propTypes = {
  kpi: PropTypes.object.isRequired,
  trendMeasured: PropTypes.number,
  onTrend: PropTypes.func,
};
KpiTile.defaultProps = { trendMeasured: null, onTrend: () => {} };

// Depth of across-run trend history for one KPI, or null when the payload says
// NOTHING about it. Absence and zero are different claims and must not collapse:
// null -> the tile stays silent; 0 -> "no measured history yet" is a real finding.
const resolveTrendDepth = (trendDepth, key) => {
  if (!trendDepth) return null;
  const d = trendDepth[key];
  return d === undefined || d === null ? null : Number(d);
};

const TopKpiGrid = ({ kpis = [], basis = '', trendDepth = null, onTrend = () => {} }) => {
  if (!kpis.length) return null;

  const breached = kpis.filter((k) => kpiDisplayState(k).state === 'breached').length;
  const absent = kpis.filter((k) => kpiDisplayState(k).state === 'no_data').length;

  return (
    <div className={cx('panel')}>
      <div className={cx('panel-head')}>
        <h3 className={cx('panel-title')}>Top KPIs</h3>
        {/* The basis is whatever the backend actually ranked by, and it says so itself
            when it can. The old hardcoded "catalog-ranked · release-gate weighted" was
            false in both halves on live data: the highest-ranked cards are ordered by
            the framework-supplied attributes.priority (which short-circuits the catalog
            table), and no release-gate weighting can apply to a project with no
            kpi_definitions rows. */}
        <span className={cx('panel-sub')}>{text(basis) || 'ranked by KPI priority'}</span>
        <span className={cx('kpi-rollup')}>
          {breached > 0 ? (
            <b className={cx('state-breached')}>▲ {breached} breached</b>
          ) : (
            <b className={cx('state-passed')}>● none breached</b>
          )}
          {absent > 0 && <span className={cx('state-no_data')}> · — {absent} not measured</span>}
        </span>
      </div>
      <div className={cx('kpi-grid')}>
        {kpis.map((kpi) => (
          <KpiTile
            kpi={kpi}
            key={kpi.id || kpi.key}
            // ABSENT IS NOT ZERO. `trendDepth` only carries keys the backend put in
            // trend.series, so a Top-KPI missing from that block used to fall through
            // `undefined || 0` to 0 -- and the tile then printed "No measured history
            // yet", asserting a measured fact the payload never stated. Undefined must
            // stay null (say nothing); a present 0 is a real, reportable zero.
            trendMeasured={resolveTrendDepth(trendDepth, text(kpi.raw_key || kpi.key))}
            onTrend={onTrend}
          />
        ))}
      </div>
    </div>
  );
};
TopKpiGrid.propTypes = {
  kpis: PropTypes.array,
  basis: PropTypes.string,
  // key -> number of runs in the trend window that MEASURED it. null when the payload
  // carries no across-run trend, so the tile says nothing rather than implying zero.
  trendDepth: PropTypes.object,
  onTrend: PropTypes.func,
};

// ── §3b KPI trend ACROSS RUNS ────────────────────────────────────────────────
// Answers "is this KPI getting worse?" — a question the Top-KPI cards (one run) and the
// replay sparklines (one session, video master clock) structurally cannot answer.
//
// This panel renders ONLY from `data.kpi_trend`, the backend block that carries one
// point per run with an explicit `value: null` for a run that measured nothing. It is
// deliberately NOT synthesised from `history_regression`, whose payload collapses
// history to current / previous / prev5_median: a median is not a point in time, so
// plotting one would fabricate a data point. No trend block => no panel.
export const TREND_WINDOWS = [5, 10, 20];

export const trendDepthByKey = (trend) => {
  if (!trend || !Array.isArray(trend.series)) {
    return null;
  }
  const out = {};
  trend.series.forEach((s) => {
    out[text(s.kpi_key)] = (s.points || []).filter(isMeasured).length;
  });
  return out;
};

class KpiTrendPanel extends Component {
  static propTypes = {
    trend: PropTypes.object.isRequired,
    selectedKey: PropTypes.string,
    onSelect: PropTypes.func,
    headingRef: PropTypes.object,
    currentSessionId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    hasHistorySection: PropTypes.bool,
  };

  static defaultProps = {
    selectedKey: null,
    onSelect: () => {},
    headingRef: null,
    currentSessionId: null,
    hasHistorySection: false,
  };

  state = { windowSize: null }; // null = every run the backend returned

  onChipKeyDown = (event, keys, index) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return;
    }
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length;
    this.props.onSelect(keys[next]);
  };

  render() {
    const { trend, selectedKey, onSelect, headingRef, currentSessionId, hasHistorySection } = this.props;
    const runs = Array.isArray(trend.runs) ? trend.runs : [];
    const allSeries = Array.isArray(trend.series) ? trend.series : [];

    // A KPI with no measured run anywhere in the window gets NO chip and NO empty chart —
    // an empty axis is a lie of implied structure. It is named in words instead.
    const chartable = allSeries.filter((s) => (s.points || []).some(isMeasured));
    const neverMeasured = allSeries
      .filter((s) => !(s.points || []).some(isMeasured))
      .map((s) => text(s.display_name) || text(s.kpi_key))
      .concat((trend.never_measured || []).map((s) => text(s.display_name) || text(s.kpi_key)));

    if (!runs.length || !chartable.length) {
      return (
        <div className={cx('panel')}>
          <div className={cx('panel-head')}>
            <h3 className={cx('panel-title')}>KPI trend across runs</h3>
          </div>
          <p className={cx('empty-note')}>
            No KPI on this test has been measured in more than one run yet. A trend needs at least
            two runs — this window holds {runs.length}.
          </p>
        </div>
      );
    }

    const keys = chartable.map((s) => text(s.kpi_key));
    const active = chartable.find((s) => text(s.kpi_key) === text(selectedKey)) || chartable[0];
    const activeIdx = keys.indexOf(text(active.kpi_key));

    const { windowSize } = this.state;
    const start = windowSize ? Math.max(0, runs.length - windowSize) : 0;
    const shownRuns = runs.slice(start);
    const shownPoints = (active.points || []).slice(start);

    return (
      <div className={cx('panel')}>
        <div className={cx('panel-head')}>
          <h3 className={cx('panel-title')} tabIndex={-1} ref={headingRef} id="sp-trend-title">
            KPI trend across runs
          </h3>
          <span className={cx('panel-sub')}>
            {text(trend.window && trend.window.basis) ||
              'same test, most recent runs first-to-last — not a per-build comparison'}
          </span>
          <span className={cx('sp-trend-window')} role="radiogroup" aria-label="Trend window">
            {TREND_WINDOWS.concat([0]).map((w) => {
              const label = w ? `Last ${w}` : 'All';
              const tooWide = Boolean(w) && w > runs.length;
              const checked = (windowSize || 0) === w;
              return (
                <button
                  type="button"
                  key={label}
                  role="radio"
                  aria-checked={checked}
                  disabled={tooWide}
                  className={cx('sp-trend-window-opt', { on: checked })}
                  onClick={() => this.setState({ windowSize: w || null })}
                >
                  {tooWide ? `${label} (only ${runs.length} runs of history exist)` : label}
                </button>
              );
            })}
          </span>
        </div>

        {/* Chip picker, not a <select>: run depth is the single most decision-relevant
            fact here (whether a trend is readable at all), and a dropdown hides it for
            every KPI but the selected one. */}
        <div className={cx('section-chips')} role="tablist" aria-label="KPI to trend">
          {chartable.map((s, i) => {
            const measured = (s.points || []).filter(isMeasured).length;
            const key = text(s.kpi_key);
            const on = key === text(active.kpi_key);
            return (
              <button
                type="button"
                key={key}
                role="tab"
                id={`sp-trend-tab-${key.replace(/[^a-z0-9]+/gi, '-')}`}
                aria-selected={on}
                aria-controls="sp-trend-panel"
                tabIndex={on ? 0 : -1}
                className={cx('section-chip', 'sp-trend-chip', { on })}
                onClick={() => onSelect(key)}
                onKeyDown={(e) => this.onChipKeyDown(e, keys, i)}
              >
                {text(s.display_name) || key}
                <b>
                  {measured}/{(s.points || []).length} runs
                </b>
              </button>
            );
          })}
        </div>

        <div
          id="sp-trend-panel"
          role="tabpanel"
          aria-labelledby={`sp-trend-tab-${text(active.kpi_key).replace(/[^a-z0-9]+/gi, '-')}`}
        >
          <KpiTrendChart
            kpi={active}
            runs={shownRuns}
            points={shownPoints}
            currentSessionId={currentSessionId}
          />
        </div>

        {neverMeasured.length > 0 && (
          <p className={cx('sp-trend-note')}>
            Never measured on this test, so not offered above:{' '}
            {neverMeasured.join(', ')}. There is no history to plot — nothing was captured, so
            nothing is shown.
          </p>
        )}

        {/* The older History accordion below reports the same KPIs with nulls DROPPED and
            a hard 5-run cap, so its "previous" can silently be two runs ago when the run
            in between measured nothing. Said out loud rather than left to look like a
            contradiction. */}
        {hasHistorySection && (
          <p className={cx('sp-trend-note')}>
            The “History” section further down compares only the last few runs and drops runs that
            measured nothing, so its “previous run” may skip a gap shown here. This chart keeps every
            run in the window, gaps included.
          </p>
        )}
      </div>
    );
  }
}

// ── §4 Session Replay (hero) ─────────────────────────────────────────────────
// The HTML5 <video> is the MASTER CLOCK. Its timeupdate drives one shared playhead
// (`scrubMs`) that every KPI plane's sparkline reads at the same instant, so scrub/play
// moves ALL planes together. Seeking the scrubber or clicking an event chip seeks the
// video. When the API serves no video URL yet, the scrubber itself becomes the clock so
// the correlation is still explorable — but we NEVER draw a fake video/court.
class SessionReplay extends Component {
  static propTypes = { replay: PropTypes.object, apiBaseUrl: PropTypes.string };

  static defaultProps = { replay: null, apiBaseUrl: '' };

  constructor(props) {
    super(props);
    this.videoRef = React.createRef();
    const sections = (props.replay && props.replay.sections) || [];
    // Expand planes that carry a real, drawable track; collapse the rest.
    const open = {};
    sections.forEach((sec, i) => {
      open[i] = (sec.tracks || []).some((tr) => (tr.series || []).length > 1);
    });
    this.state = { open, scrubMs: null, playing: false, videoError: false };
  }

  get duration() {
    return (this.props.replay || {}).duration_ms || 0;
  }

  get cur() {
    return this.state.scrubMs === null ? 0 : this.state.scrubMs;
  }

  seekTo = (ms) => {
    const clamped = Math.max(0, Math.min(this.duration, Math.round(ms)));
    const video = this.videoRef.current;
    if (video && !this.state.videoError && Number.isFinite(video.duration)) {
      try {
        video.currentTime = clamped / 1000;
      } catch (e) {
        /* seeking before metadata is ready — the scrubMs state still drives the planes */
      }
    }
    this.setState({ scrubMs: clamped });
  };

  handleTimeUpdate = () => {
    const video = this.videoRef.current;
    if (video) {
      this.setState({ scrubMs: Math.round(video.currentTime * 1000) });
    }
  };

  togglePlay = () => {
    const video = this.videoRef.current;
    if (!video || this.state.videoError) {
      return;
    }
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } else {
      video.pause();
    }
  };

  handleScrubPointer = (ev) => {
    // Left button drag or a fresh pointerdown; ignore hover moves with no button held.
    if (ev.type === 'pointermove' && ev.buttons === 0) {
      return;
    }
    const rect = ev.currentTarget.getBoundingClientRect();
    const frac = rect.width ? (ev.clientX - rect.left) / rect.width : 0;
    this.seekTo(frac * this.duration);
  };

  togglePlane = (i) =>
    this.setState((s) => ({ open: { ...s.open, [i]: !s.open[i] } }));

  renderPlane = (sec, i, stall, duration, cur) => {
    const tracks = sec.tracks || [];
    const isOpen = Boolean(this.state.open[i]);
    return (
      <div className={cx('plane', { closed: !isOpen })} key={sec.key || sec.title}>
        <button
          type="button"
          className={cx('plane-head')}
          onClick={() => this.togglePlane(i)}
          aria-expanded={isOpen}
        >
          <span className={cx('chev')} aria-hidden="true" />
          <span className={cx('plane-dot', statusClass(sec.status))} aria-hidden="true" />
          <span className={cx('plane-name')}>{text(sec.title)}</span>
          <span className={cx('card-spacer')} />
          <span className={cx('plane-count')}>{tracks.length} tracks</span>
        </button>
        {isOpen && (
          <div className={cx('plane-body')}>
            {tracks.map((tr) => {
              const curV = sampleSeriesAt(tr.series, cur);
              const hasSeries = (tr.series || []).length > 1;
              return (
                <div className={cx('track')} key={tr.key || tr.display_name}>
                  <div className={cx('track-label')}>
                    <b>{text(tr.display_name)}</b>
                    <span>
                      {text(tr.category)}
                      {tr.unit ? ` · ${tr.unit}` : ''}
                    </span>
                  </div>
                  <div className={cx('track-spark')}>
                    <Sparkline
                      series={tr.series}
                      stall={stall}
                      duration={duration}
                      scrubT={cur}
                      step={tr.render === 'step'}
                    />
                  </div>
                  <div className={cx('track-stat')}>
                    <b>
                      {hasSeries ? fmtNum(curV) : fmtNum(tr.current)}
                      {tr.unit ? <span className={cx('track-unit')}>{text(tr.unit)}</span> : null}
                    </b>
                    <span>
                      avg {fmtNum(tr.avg)} · {fmtNum(tr.min)}–{fmtNum(tr.max)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  renderUnavailablePlane = (kind) => {
    const meta = UNAVAILABLE_PLANES[kind] || { title: kind, note: 'Not captured for this session.' };
    return (
      <div className={cx('plane', 'plane--unavailable')} key={`unavail-${kind}`}>
        <div className={cx('plane-head', 'plane-head--static')}>
          <span className={cx('plane-dot', 'info')} aria-hidden="true" />
          <span className={cx('plane-name')}>{meta.title}</span>
          <span className={cx('card-spacer')} />
          <span className={cx('plane-count', 'plane-count--muted')}>not captured</span>
        </div>
        <div className={cx('plane-body')}>
          <p className={cx('plane-note')}>{meta.note}</p>
        </div>
      </div>
    );
  };

  render() {
    const replay = this.props.replay || {};
    const duration = this.duration;
    const timeline = replay.timeline || [];
    const sections = replay.sections || [];
    const stall = replay.stall_window || null;
    const unavailable = Array.isArray(replay.unavailable) ? replay.unavailable : [];
    const videoUrl = resolveMediaUrl(
      replay.video_url || (replay.video && replay.video.url),
      this.props.apiBaseUrl,
    );
    const cur = this.cur;
    const frac = duration ? Math.max(0, Math.min(1, cur / duration)) : 0;

    // Honest empty state: nothing real to show — no tracks, no timeline, no video.
    if (!replay.has_tracks && !timeline.length && !videoUrl && !sections.length) {
      return (
        <FoldableCard
          title="Session Replay — correlated to KPIs"
          sub="video is the master clock · every KPI moves with the scrubber"
          hero
        >
          <p className={cx('empty-note')}>
            {text(replay.note) || 'No per-KPI time-series or replay video captured for this session.'}
          </p>
        </FoldableCard>
      );
    }

    return (
      <FoldableCard
        title="Session Replay — correlated to KPIs"
        sub="video is the master clock · every KPI moves with the scrubber"
        hero
      >
        <div className={cx('replay-stage')}>
          <div className={cx('replay-video-col')}>
            <div className={cx('replay-video')}>
              {videoUrl && !this.state.videoError ? (
                <video
                  ref={this.videoRef}
                  className={cx('replay-video-el')}
                  src={videoUrl}
                  preload="metadata"
                  playsInline
                  onTimeUpdate={this.handleTimeUpdate}
                  onPlay={() => this.setState({ playing: true })}
                  onPause={() => this.setState({ playing: false })}
                  onError={() => this.setState({ videoError: true })}
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className={cx('replay-video-empty')} role="note">
                  <span className={cx('replay-video-empty-icon')} aria-hidden="true">
                    ▶
                  </span>
                  {this.state.videoError ? (
                    <span>Replay video failed to load. The scrubber below still drives every KPI plane.</span>
                  ) : (
                    <span>
                      No replay video is served by the API for this session yet. The scrubber below
                      still drives every KPI plane.
                    </span>
                  )}
                </div>
              )}
              <div className={cx('replay-controls')}>
                <button
                  type="button"
                  className={cx('replay-play')}
                  onClick={this.togglePlay}
                  disabled={!videoUrl || this.state.videoError}
                  aria-label={this.state.playing ? 'Pause replay' : 'Play replay'}
                >
                  {this.state.playing ? '❚❚' : '▶'}
                </button>
                <div
                  className={cx('replay-scrub')}
                  onPointerDown={this.handleScrubPointer}
                  onPointerMove={this.handleScrubPointer}
                  role="slider"
                  tabIndex={0}
                  aria-label="Session replay scrubber"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration / 1000)}
                  aria-valuenow={Math.round(cur / 1000)}
                  aria-valuetext={`${fmtClock(cur)} of ${fmtClock(duration)}`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'ArrowRight') this.seekTo(cur + 1000);
                    if (ev.key === 'ArrowLeft') this.seekTo(cur - 1000);
                  }}
                >
                  <div className={cx('replay-strack')} />
                  {stall && duration > 0 && (
                    <div
                      className={cx('replay-sband')}
                      style={{
                        left: `${(stall.start_ms / duration) * 100}%`,
                        width: `${Math.max(1, ((stall.end_ms - stall.start_ms) / duration) * 100)}%`,
                      }}
                      title="Stall window"
                    />
                  )}
                  <div className={cx('replay-sfill')} style={{ width: `${frac * 100}%` }} />
                  {timeline.map((e, i) => (
                    <span
                      key={`mk-${e.offset_ms}-${i}`}
                      className={cx('replay-mk', statusClass(e.status))}
                      style={{ left: `${duration ? (e.offset_ms / duration) * 100 : 0}%` }}
                      title={`${text(e.name)} @ ${fmtClock(e.offset_ms)}`}
                    />
                  ))}
                  <div className={cx('replay-handle')} style={{ left: `${frac * 100}%` }} />
                </div>
                <span className={cx('replay-tcode')}>
                  {fmtClock(cur)} / {fmtClock(duration)}
                </span>
              </div>
            </div>
            {timeline.length > 0 && (
              <div className={cx('replay-events')}>
                {collapseRepeats(timeline).map((e, i) => (
                  <button
                    type="button"
                    className={cx('replay-evchip', statusClass(e.status))}
                    key={`ev-${e.offset_ms}-${i}`}
                    onClick={() => this.seekTo(e.offset_ms)}
                    title={
                      e.count > 1
                        ? `${e.count}x ${text(e.name)} — ${fmtClock(e.offset_ms)} to ${fmtClock(
                            e.lastOffsetMs,
                          )}`
                        : undefined
                    }
                  >
                    {fmtClock(e.offset_ms)} {text(e.name)}
                    {e.count > 1 ? ` x${e.count}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={cx('replay-planes')}>
            {sections.map((sec, i) => this.renderPlane(sec, i, stall, duration, cur))}
            {unavailable.map((kind) => this.renderUnavailablePlane(kind))}
          </div>
        </div>
        <p className={cx('footnote')}>
          Scrub to a flagged moment: every KPI plane&apos;s playhead moves together and the shaded
          band marks the stall across all planes. Values shown are the real captured samples at that
          instant — un-captured planes read &ldquo;not captured&rdquo;, never a fabricated curve.
        </p>
      </FoldableCard>
    );
  }
}

// One KPI in the by-section grid. Deliberately the SAME vocabulary as KpiTile (the Top
// strip) — kpiDisplayName + kpiDisplayState + threshold_view — because two surfaces that
// describe the same KPI with two different words is how a "UNKNOWN / UNASSIGNED" column
// survived here for months. This is the compact form of the tile, not a second dialect.
//
// Honesty, identical to the tile:
//  - no_data renders an em-dash on a hatched, dashed cell and states WHY. Never a 0.
//  - a measured 0 renders as a solid, ordinary cell reading "0 ms". Structurally distinct.
//  - "Observed" (measured, no budget) never wears a pass swatch.
const KpiGridRow = ({ kpi }) => {
  const { state, glyph, label } = kpiDisplayState(kpi);
  const isNoData = state === 'no_data';
  const name = kpiDisplayName(kpi);
  const view = kpi.threshold_view;
  const provenance = kpi.provenance;
  const value =
    kpi.display_value !== null && kpi.display_value !== undefined && kpi.display_value !== ''
      ? kpi.display_value
      : kpi.formatted_value;
  const unit = text(kpi.display_unit);

  return (
    <div className={cx('kpi-row', `state-${state}`)} data-state={state}>
      <div className={cx('kpi-row-main')}>
        <span className={cx('kpi-row-name')} title={`${name} (${text(kpi.raw_key || kpi.key)})`}>
          {name}
        </span>
        {provenance && (
          <span className={cx('kpi-row-prov')} title={text(provenance.detail)}>
            {text(provenance.label)}
            {provenance.inferred && <em className={cx('kpi-row-inferred')}> · inferred</em>}
          </span>
        )}
      </div>

      {isNoData ? (
        <div className={cx('kpi-row-value', 'absent')}>
          <span aria-hidden="true">—</span>
        </div>
      ) : (
        <div className={cx('kpi-row-value')}>
          <span className={cx('kpi-row-num')}>{text(value)}</span>
          {unit && <span className={cx('kpi-row-unit')}>{unit}</span>}
        </div>
      )}

      <div className={cx('kpi-row-foot')}>
        <span className={cx('kpi-row-state', `state-${state}`)}>
          <span className={cx('kpi-row-glyph')} aria-hidden="true">
            {glyph}
          </span>
          {label}
        </span>
        {isNoData ? (
          <span className={cx('kpi-row-note')}>
            {text(kpi.no_data_reason) || 'Not captured on this run — no value was recorded.'}
          </span>
        ) : (
          <span className={cx('kpi-row-note')}>
            {view ? (
              <Fragment>
                <span className={cx('kpi-row-budget')}>
                  {text(view.comparator)} {text(view.budget_text)}
                </span>
                <span className={cx('kpi-row-delta', { breached: Boolean(view.breached) })}>
                  {text(view.delta_text)}
                </span>
              </Fragment>
            ) : (
              'no budget defined — recorded for observation, not judged'
            )}
          </span>
        )}
      </div>
    </div>
  );
};
KpiGridRow.propTypes = { kpi: PropTypes.object.isRequired };

// Per-section rollup, derived from display_state — the SAME derivation the Top strip's
// rollup uses, so the two can never disagree about how many KPIs breached.
const SectionRollup = ({ rows }) => {
  const counts = rows.reduce((acc, r) => {
    const { state } = kpiDisplayState(r);
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
  const parts = [
    ['breached', '▲', 'breached'],
    ['at_risk', '◆', 'at risk'],
    ['passed', '●', 'within budget'],
    ['observed', '○', 'observed'],
    ['no_data', '—', 'not measured'],
  ]
    .filter(([key]) => counts[key])
    .map(([key, glyph, word]) => (
      <span className={cx('kpi-rollup-part', `state-${key}`)} key={key}>
        <span aria-hidden="true">{glyph}</span> {counts[key]} {word}
      </span>
    ));

  return <span className={cx('kpi-rollup')}>{parts}</span>;
};
SectionRollup.propTypes = { rows: PropTypes.array.isRequired };

const KpisBySection = ({ sections = [] }) => {
  if (!sections.length) return null;
  return (
    <div className={cx('panel')}>
      <div className={cx('panel-head')}>
        <h3 className={cx('panel-title')}>KPIs by section</h3>
        <span className={cx('panel-sub')}>full catalog · every captured KPI, grouped by source</span>
      </div>
      <div className={cx('section-chips')}>
        {sections.map((s) => (
          <span className={cx('section-chip', statusClass(s.status))} key={s.key || s.title}>
            {text(s.title)} <b>{(s.rows || []).length}</b>
          </span>
        ))}
      </div>
      {sections.map((s) => {
        const rows = s.rows || [];
        return (
          <div className={cx('by-section')} key={s.key || s.title}>
            <div className={cx('by-section-head')}>
              <h4 className={cx('section-subtitle')}>{text(s.title)}</h4>
              {rows.length > 0 && <SectionRollup rows={rows} />}
            </div>
            {rows.length === 0 ? (
              // An empty body would read as "nothing wrong here". It is not the same claim.
              <p className={cx('kpi-grid-empty')}>
                not captured — no KPI in this group was recorded on this run
              </p>
            ) : (
              <div className={cx('kpi-rows')}>
                {rows.map((r) => (
                  <KpiGridRow kpi={r} key={r.id || r.key || r.raw_key} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
KpisBySection.propTypes = { sections: PropTypes.array };

export class StreamPulseObservabilityTab extends Component {
  static propTypes = {
    logItem: PropTypes.object,
  };

  static defaultProps = {
    logItem: {},
  };

  state = {
    data: null,
    loading: false,
    trendKey: null,
  };

  trendHeadingRef = React.createRef();

  // Selecting from a Top-KPI tile moves focus to the trend panel: the control must land
  // the reader where the answer is, not scroll silently.
  selectTrendKpi = (key) => {
    this.setState({ trendKey: text(key) }, () => {
      const el = this.trendHeadingRef.current;
      if (el && el.focus) {
        el.focus();
      }
    });
  };

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.logItem?.id !== this.props.logItem?.id) {
      this.fetchData();
    }
  }

  fetchData = () => {
    const { logItem } = this.props;
    // streampulse keys observability by the RP item UUID (the reporter tags it with
    // item.uuid), so prefer uuid; fall back to the numeric id for older data.
    const rpItemId = logItem?.uuid || logItem?.id;

    this.setState({ loading: true });
    fetchStreamPulseObservability(rpItemId).then((data) => {
      this.setState({ data, loading: false });
    });
  };

  render() {
    const { data, loading } = this.state;
    const apiBaseUrl = getStreamPulseApiBaseUrl();

    if (loading && !data) {
      return <div className={cx('empty')}>Loading StreamPulse observability...</div>;
    }

    if (!data) {
      return <div className={cx('empty')}>No StreamPulse observability data available.</div>;
    }

    const session = data.session || {};
    const topKpis = data.top_kpis || [];
    const rpItemId = this.props.logItem?.uuid || this.props.logItem?.id;
    // Honesty: owner-routed actions hit the live backend; disabled (with an honest
    // note) for SAMPLE data so we never pretend to act.
    const isSample = !apiBaseUrl || isMockObservability(data);
    const actionsDisabledReason = isSample
      ? 'Actions are disabled for SAMPLE data — connect the FastBreak API to file a Jira bug, ' +
        'notify the release gate, or re-run.'
      : '';

    const rcaSection =
      (data.accordion_sections || []).find((s) => s.type === 'rca') ||
      (data.ai_rca_insights || data.rca
        ? {
            type: 'rca',
            status: (data.ai_rca_insights || data.rca || {}).category || 'warning',
            data: data.ai_rca_insights || data.rca,
          }
        : null);

    // RCA + kpi_table + summary are promoted into the design panels above; the rest
    // (app-health, network, artifacts, history) stay as honest accordions below.
    const accordions = (data.accordion_sections || []).filter(
      (s) =>
        !['rca', 'kpi_table', 'summary'].includes(s.type) && hasSectionContent(s),
    );

    // Across-run trend. Suppressed ENTIRELY under SAMPLE data: a trend line drawn from
    // mockObservabilityResponse.js is a fabricated regression narrative — worse than the
    // static SAMPLE values the banner above already discloses, because a reader would
    // take a direction from it. No live backend => no trend, and the tiles say nothing
    // about run depth either (trendDepth stays null).
    const trend =
      !isSample && data.kpi_trend && (data.kpi_trend.series || []).length ? data.kpi_trend : null;
    const trendDepth = trendDepthByKey(trend);

    const chips = [
      session.device && session.device !== 'unknown' ? text(session.device) : null,
      session.platform && session.platform !== 'unknown' ? text(session.platform) : null,
      session.region && session.region !== 'unknown' ? text(session.region) : null,
      session.network_profile && session.network_profile !== 'unknown'
        ? text(session.network_profile)
        : null,
      session.cuj && session.cuj !== 'unknown' ? `CUJ ${text(session.cuj)}` : null,
    ].filter(Boolean);

    return (
      <div className={cx('stream-pulse-tab')}>
        {isSample && (
          <div className={cx('notice')}>
            Showing SAMPLE observability data — not a live measurement. Connect the FastBreak API
            for live KPIs.
          </div>
        )}
        <div className={cx('sp-header')}>
          <div className={cx('sp-title')}>{text(session.name || 'Observability & KPIs')}</div>
          <div className={cx('sp-chips')}>
            {chips.map((c, i) => (
              <span className={cx('sp-chip')} key={i}>
                {c}
              </span>
            ))}
            {/* 'NONE' is the API schema default and 'UNKNOWN' the ORM column default;
                'UNCLASSIFIED' is the classifier's honest no-match output. All three
                mean "never classified", so none of them is a category worth a chip —
                the RCA panel below states the no-match case in words. Guarding the
                whole sentinel set (not one hardcoded string) is what stops the next
                sentinel leaking to screen the way 'NONE' did. */}
            {!isRcaNoVerdict(session.rca_category) && <Badge value={session.rca_category} />}
          </div>
        </div>

        <VerdictCards session={session} topKpis={topKpis} verdict={data.verdict} />
        <TopKpiGrid
          kpis={topKpis}
          basis={data.top_kpis_basis}
          trendDepth={trendDepth}
          onTrend={this.selectTrendKpi}
        />

        {trend && (
          <KpiTrendPanel
            trend={trend}
            selectedKey={this.state.trendKey}
            onSelect={this.selectTrendKpi}
            headingRef={this.trendHeadingRef}
            currentSessionId={session.id}
            hasHistorySection={accordions.some((s) => s.type === 'history')}
          />
        )}

        {rcaSection && (
          <FoldableCard
            // "Automated", not "AI": the category, owner and confidence come from a
            // deterministic rule table over measured KPIs (rca_rules.py), and the
            // confidence is a constant on the matched rule, not a model probability.
            // The sub-line always said so; the title claimed otherwise, and the title
            // is what gets read and repeated.
            title="Automated RCA & Insights"
            sub="Deterministic rules over measured KPIs decide category, owner and confidence — any LLM narration is labelled and never changes the verdict"
            badge={<RcaHeadChip section={rcaSection} />}
            defaultOpen={isWarningOrFail(rcaSection.status)}
          >
            <AiRcaInsights
              section={rcaSection}
              rpItemId={rpItemId}
              functionalStatus={session.functional_status}
              actionsDisabled={isSample}
              actionsDisabledReason={actionsDisabledReason}
              networkStatus={(data.network_intelligence || {}).status}
            />
          </FoldableCard>
        )}

        <SessionReplay replay={data.session_replay} apiBaseUrl={apiBaseUrl} />
        <KpisBySection sections={data.kpi_sections || []} />

        {accordions.length > 0 && (
          <div className={cx('sections')}>
            {accordions.map((section) => (
              <KpiAccordionSection
                key={section.key || section.title}
                section={section}
                rpItemId={rpItemId}
                functionalStatus={session.functional_status}
                actionsDisabled={isSample}
                actionsDisabledReason={actionsDisabledReason}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
}
