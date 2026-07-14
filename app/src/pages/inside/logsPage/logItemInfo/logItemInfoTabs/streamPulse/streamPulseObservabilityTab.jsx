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

const HistoryRegression = ({ section }) => {
  const rows = section.data?.rows || section.data?.history || [];

  return (
    <table className={cx('table')}>
      <thead>
        <tr>
          <th>Build</th>
          <th>KPI</th>
          <th>Previous</th>
          <th>Current</th>
          <th>Delta</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.build || row.current_build}-${row.kpi_key || row.display_name}`}>
            <td>{text(row.build || row.current_build)}</td>
            <td>{text(row.kpi_key || row.display_name)}</td>
            <td>{text(row.previous)}</td>
            <td>{text(row.current)}</td>
            <td>{text(row.delta_pct || row.delta)}</td>
            <td>
              <Badge value={row.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

const formatThreshold = (kpi) => {
  if (kpi.threshold_label) return kpi.threshold_label;
  const t = kpi.threshold || {};
  const bound = t.max ?? t.warn ?? t.fail ?? t.value ?? t.min;
  if (bound === undefined || bound === null) return '';
  const op = t.min !== undefined && t.max === undefined ? '≥' : '≤';
  return `${op}${bound}${text(kpi.unit || '')}`;
};

const TopKpiGrid = ({ kpis = [] }) => {
  if (!kpis.length) return null;
  return (
    <div className={cx('panel')}>
      <div className={cx('panel-head')}>
        <h3 className={cx('panel-title')}>Top KPIs</h3>
        <span className={cx('panel-sub')}>catalog-ranked · release-gate weighted</span>
      </div>
      <div className={cx('kpi-grid')}>
        {kpis.map((kpi) => {
          const gate = kpi.release_gate && ['failed', 'critical'].includes(statusClass(kpi.status));
          return (
            <div className={cx('kpi-tile', statusClass(kpi.status), { gate })} key={kpi.id || kpi.key}>
              <div className={cx('kpi-tile-name')}>{text(kpi.display_name || kpi.key)}</div>
              <div className={cx('kpi-tile-value')}>{text(kpi.formatted_value || kpi.value)}</div>
              <div className={cx('kpi-tile-foot')}>
                <span className={cx('kpi-tile-status', statusClass(kpi.status))}>
                  {gate ? 'Critical · gate' : text(kpi.status)}
                </span>
                <span className={cx('kpi-tile-thresh')}>{formatThreshold(kpi)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
TopKpiGrid.propTypes = { kpis: PropTypes.array };

class SessionReplay extends Component {
  static propTypes = { replay: PropTypes.object };

  static defaultProps = { replay: null };

  state = { scrubT: null };

  render() {
    const replay = this.props.replay || {};
    const duration = replay.duration_ms || 0;
    const timeline = replay.timeline || [];
    const sections = replay.sections || [];
    const stall = replay.stall_window || null;
    const { scrubT } = this.state;
    const cur = scrubT === null ? duration : scrubT;

    if (!replay.has_tracks && !timeline.length) {
      return (
        <div className={cx('panel')}>
          <div className={cx('panel-head')}>
            <h3 className={cx('panel-title')}>Session Replay</h3>
          </div>
          <p className={cx('empty-note')}>
            {text(replay.note) || 'No per-KPI time-series captured for this session.'}
          </p>
        </div>
      );
    }

    return (
      <div className={cx('panel')}>
        <div className={cx('panel-head')}>
          <h3 className={cx('panel-title')}>Session Replay</h3>
          <span className={cx('panel-sub')}>video is the master clock · every KPI moves with the scrubber</span>
        </div>
        {timeline.length > 0 && (
          <div className={cx('replay-timeline')}>
            {timeline.map((e, i) => (
              <span className={cx('tl-chip', statusClass(e.status))} key={`${e.offset_ms}-${i}`}>
                {fmtClock(e.offset_ms)} · {text(e.name)}
              </span>
            ))}
          </div>
        )}
        {duration > 0 && (
          <div className={cx('scrubber')}>
            <input
              type="range"
              min="0"
              max={duration}
              value={cur}
              onChange={(ev) => this.setState({ scrubT: Number(ev.target.value) })}
              aria-label="Session replay scrubber"
            />
            <span className={cx('scrub-clock')}>
              {fmtClock(cur)} / {fmtClock(duration)}
            </span>
          </div>
        )}
        {sections.map((sec) => (
          <div className={cx('replay-section')} key={sec.title}>
            <div className={cx('replay-section-head')}>
              <span>{text(sec.title)}</span>
              <span className={cx('panel-sub')}>{(sec.tracks || []).length} tracks</span>
            </div>
            {(sec.tracks || []).map((tr) => (
              <div className={cx('track')} key={tr.key}>
                <div className={cx('track-label')}>
                  <b>{text(tr.display_name)}</b>
                  <span>
                    {text(tr.category)}
                    {tr.unit ? ` · ${tr.unit}` : ''}
                  </span>
                </div>
                <div className={cx('track-spark')}>
                  <Sparkline series={tr.series} stall={stall} duration={duration} scrubT={cur} />
                </div>
                <div className={cx('track-stat')}>
                  <b>
                    {text(tr.current)}
                    <span className={cx('track-unit')}>{text(tr.unit)}</span>
                  </b>
                  <span>
                    avg {text(tr.avg)} · {text(tr.min)}–{text(tr.max)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
}

const KpisBySection = ({ sections = [] }) => {
  if (!sections.length) return null;
  return (
    <div className={cx('panel')}>
      <div className={cx('panel-head')}>
        <h3 className={cx('panel-title')}>KPIs by section</h3>
        <span className={cx('panel-sub')}>full catalog · stat by measurement type</span>
      </div>
      <div className={cx('section-chips')}>
        {sections.map((s) => (
          <span className={cx('section-chip', statusClass(s.status))} key={s.key || s.title}>
            {text(s.title)} <b>{(s.rows || []).length}</b>
          </span>
        ))}
      </div>
      {sections.map((s) => (
        <div className={cx('by-section')} key={s.key || s.title}>
          <h4 className={cx('section-subtitle')}>{text(s.title)}</h4>
          <table className={cx('table')}>
            <tbody>
              {(s.rows || []).map((r) => (
                <tr key={r.key || r.display_name}>
                  <td>{text(r.display_name || r.key)}</td>
                  <td className={cx('num')}>{text(r.formatted_value || r.value)}</td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                  <td className={cx('muted-cell')}>{text(r.measurement || r.owner || '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
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
          <div className={cx('panel')}>
            <div className={cx('panel-head')}>
              <h3 className={cx('panel-title')}>AI RCA &amp; Insights</h3>
              <Badge value={rcaSection.status} />
            </div>
            <AiRcaInsights
              section={rcaSection}
              rpItemId={rpItemId}
              functionalStatus={session.functional_status}
              actionsDisabled={isSample}
              actionsDisabledReason={actionsDisabledReason}
            />
          </div>
        )}

        <SessionReplay replay={data.session_replay} />
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
