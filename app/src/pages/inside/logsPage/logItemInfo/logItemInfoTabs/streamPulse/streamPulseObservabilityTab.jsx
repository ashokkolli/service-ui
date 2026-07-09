import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames/bind';
import {
  fetchStreamPulseObservability,
  getStreamPulseApiBaseUrl,
} from './streamPulseClient';
import {
  hasSectionContent,
  percent,
  shouldAutoExpandSection,
  statusClass,
  text,
} from './streamPulseUtils';
import styles from './streamPulseObservabilityTab.scss';

const cx = classNames.bind(styles);

const Badge = ({ value }) => <span className={cx('badge', statusClass(value))}>{text(value)}</span>;

Badge.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

Badge.defaultProps = {
  value: '',
};

const TopKpiStrip = ({ kpis }) => {
  if (!kpis.length) {
    return null;
  }

  return (
    <div className={cx('top-kpis')}>
      {kpis.map((kpi) => (
        <div className={cx('kpi-card', statusClass(kpi.status))} key={kpi.id || kpi.key}>
          <div className={cx('kpi-name')}>{text(kpi.display_name || kpi.key)}</div>
          <div className={cx('kpi-value')}>{text(kpi.formatted_value || kpi.value)}</div>
          <div className={cx('kpi-meta')}>
            {text(kpi.category)}
            {kpi.release_gate ? ' · gate' : ''}
          </div>
        </div>
      ))}
    </div>
  );
};

TopKpiStrip.propTypes = {
  kpis: PropTypes.array,
};

TopKpiStrip.defaultProps = {
  kpis: [],
};

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

const ListBlock = ({ title, items, renderItem }) => {
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

ListBlock.defaultProps = {
  items: [],
  renderItem: null,
};

const AiRcaInsights = ({ section }) => {
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
          <h4 className={cx('section-subtitle')}>Jira-ready summary</h4>
          <pre className={cx('pre')}>{JSON.stringify(data.jira_ready, null, 2)}</pre>
        </Fragment>
      )}
    </div>
  );
};

AiRcaInsights.propTypes = {
  section: PropTypes.object.isRequired,
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

const KpiTable = ({ rows }) => (
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

KpiTable.defaultProps = {
  rows: [],
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
              <code>{text(artifact.uri || artifact.object_key)}</code>
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

const SectionBody = ({ section }) => {
  if (section.type === 'summary') {
    return <PerformanceSessionSummary section={section} />;
  }
  if (section.type === 'rca') {
    return <AiRcaInsights section={section} />;
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

  return <pre className={cx('pre')}>{JSON.stringify(section.data || {}, null, 2)}</pre>;
};

SectionBody.propTypes = {
  section: PropTypes.object.isRequired,
};

const KpiAccordionSection = ({ section }) => {
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
        <SectionBody section={section} />
      </div>
    </details>
  );
};

KpiAccordionSection.propTypes = {
  section: PropTypes.object.isRequired,
};

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
    const rpItemId = logItem?.id;

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
    const sections = (data.accordion_sections || []).filter(hasSectionContent);

    return (
      <div className={cx('stream-pulse-tab')}>
        <div className={cx('header')}>
          <div>
            <div className={cx('title')}>{text(session.name || 'StreamPulse Observability')}</div>
            <div className={cx('subtitle')}>
              {[session.platform, session.device, session.region, session.cuj]
                .filter(Boolean)
                .map(text)
                .join(' · ')}
            </div>
          </div>
          <div className={cx('status-row')}>
            <Badge value={session.functional_status} />
            <Badge value={session.observability_status} />
            <Badge value={session.rca_category} />
          </div>
        </div>
        {!apiBaseUrl && (
          <div className={cx('notice')}>
            STREAM_PULSE_API_URL is not configured. Showing local mock observability data.
          </div>
        )}
        <TopKpiStrip kpis={data.top_kpis || []} />
        <div className={cx('sections')}>
          {sections.map((section) => (
            <KpiAccordionSection key={section.key || section.title} section={section} />
          ))}
        </div>
      </div>
    );
  }
}
