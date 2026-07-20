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
  crashFreePercent,
  hasSectionContent,
  isHttpUri,
  isWarningOrFail,
  kpiDisplayName,
  kpiDisplayState,
  percent,
  severityGlyph,
  shouldAutoExpandSection,
  statusClass,
  text,
} from './streamPulseUtils';
import { Sparkline } from './sparkline';
import styles from './streamPulseObservabilityTab.scss';

const cx = classNames.bind(styles);

const fmtClock = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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

const AiRcaInsights = ({
  section,
  rpItemId = null,
  functionalStatus = '',
  actionsDisabled = false,
  actionsDisabledReason = '',
}) => {
  const data = section.data || {};
  const slowEvidence = data.slow_url_api_cdn_evidence || data.slow_requests || data.evidence || [];
  const timeline = data.timeline_correlation || data.timeline || data.correlations || [];
  const relatedKpis = data.related_kpis || data.kpis || [];
  const actions = data.recommended_action || data.suggested_actions || [];

  return (
    <div className={cx('rca')}>
      <div className={cx('summary-grid')}>
        <div>
          <span>Category</span>
          <b>{text(data.category || section.status)}</b>
        </div>
        <div>
          <span>Confidence</span>
          <b>{percent(data.confidence)}</b>
        </div>
        <div>
          <span>Impact</span>
          <b>{text(data.impact)}</b>
        </div>
        <div>
          <span>Owner</span>
          <b>{text(data.suggested_owner)}</b>
        </div>
      </div>
      {data.summary && <p>{text(data.summary)}</p>}
      {data.reasoning && (
        <Fragment>
          <h4 className={cx('section-subtitle')}>Detailed reasoning</h4>
          <p>{text(data.reasoning)}</p>
        </Fragment>
      )}
      <ListBlock
        title="Slow API / URL / CDN evidence"
        items={slowEvidence}
        renderItem={(item) =>
          typeof item === 'string'
            ? text(item)
            : `${text(item.host || item.sanitized_url)} ${text(item.sanitized_path)} ${text(
                item.duration_ms,
              )}ms - ${text(item.impact)}`
        }
      />
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
      <ListBlock
        title="Related KPIs"
        items={relatedKpis}
        renderItem={(item) =>
          typeof item === 'string' ? (
            text(item)
          ) : (
            <Fragment>
              {text(item.display_name || item.key)} <Badge value={item.status} />
            </Fragment>
          )
        }
      />
      <ListBlock title="Recommended action" items={Array.isArray(actions) ? actions : [actions]} />
      {data.jira_ready && (
        <Fragment>
          <h4 className={cx('section-subtitle')}>Jira-ready draft</h4>
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
        </Fragment>
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
};

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

// Honest by construction:
//  - `no_data` renders as an em-dash on a hatched, dashed-border card with no shadow.
//    It can never be mistaken for a measurement, and a real measured 0 renders as a
//    normal solid card reading "0%".
//  - "Observed" (measured, no budget) is visually separate from "Within budget". We
//    never show a pass swatch for a number nothing was checked against.
//  - Never color alone (WCAG 1.4.1): every state carries glyph + word + color.
// Display-only. Nothing here changes pass/fail; gating lives in the test's
// PASS_CRITERIA_ASSERTED and the KPI catalog budgets.
const KpiTile = ({ kpi }) => {
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
    </div>
  );
};

KpiTile.propTypes = { kpi: PropTypes.object.isRequired };

const TopKpiGrid = ({ kpis = [] }) => {
  if (!kpis.length) return null;

  const breached = kpis.filter((k) => kpiDisplayState(k).state === 'breached').length;
  const absent = kpis.filter((k) => kpiDisplayState(k).state === 'no_data').length;

  return (
    <div className={cx('panel')}>
      <div className={cx('panel-head')}>
        <h3 className={cx('panel-title')}>Top KPIs</h3>
        <span className={cx('panel-sub')}>catalog-ranked · release-gate weighted</span>
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
          <KpiTile kpi={kpi} key={kpi.id || kpi.key} />
        ))}
      </div>
    </div>
  );
};
TopKpiGrid.propTypes = { kpis: PropTypes.array };

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
                {timeline.map((e, i) => (
                  <button
                    type="button"
                    className={cx('replay-evchip', statusClass(e.status))}
                    key={`ev-${e.offset_ms}-${i}`}
                    onClick={() => this.seekTo(e.offset_ms)}
                  >
                    {fmtClock(e.offset_ms)} {text(e.name)}
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
            {session.rca_category && session.rca_category !== 'UNKNOWN' && (
              <Badge value={session.rca_category} />
            )}
          </div>
        </div>

        <VerdictCards session={session} topKpis={topKpis} verdict={data.verdict} />
        <TopKpiGrid kpis={topKpis} />

        {rcaSection && (
          <FoldableCard
            title="AI RCA & Insights"
            badge={<Badge value={rcaSection.status} />}
            defaultOpen={isWarningOrFail(rcaSection.status)}
          >
            <AiRcaInsights
              section={rcaSection}
              rpItemId={rpItemId}
              functionalStatus={session.functional_status}
              actionsDisabled={isSample}
              actionsDisabledReason={actionsDisabledReason}
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
