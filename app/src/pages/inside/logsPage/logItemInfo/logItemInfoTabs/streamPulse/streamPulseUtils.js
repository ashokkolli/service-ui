export const text = (value) => (value === null || value === undefined ? '' : String(value));

export const statusClass = (status) => {
  const normalized = text(status).toLowerCase();

  if (['failed', 'fail', 'critical', 'error', 'high'].includes(normalized)) {
    return 'failed';
  }

  if (['warning', 'warn', 'regressed', 'medium'].includes(normalized)) {
    return 'warning';
  }

  // Only genuinely-passing statuses read green. Everything the UI does not
  // explicitly recognise as pass/warn/fail falls to a NEUTRAL 'info' badge — never
  // green. Otherwise an 'unknown'/'no data' section or a diagnostic rca_category
  // label (e.g. 'network_cdn_degradation') would render as a reassuring green pass.
  if (['passed', 'pass', 'passing', 'success', 'ok', 'healthy', 'low'].includes(normalized)) {
    return 'passed';
  }

  return 'info';
};

export const isWarningOrFail = (status) => ['warning', 'failed'].includes(statusClass(status));

// Severity glyph so a badge is never color-only (WCAG 1.4.1 Use of Color). The
// neutral 'info' badge stays glyph-free so it does not read as a pass/warn/fail
// signal. Glyphs are decorative (paired with the text label) and rendered
// aria-hidden by the Badge component.
export const severityGlyph = (status) => {
  switch (statusClass(status)) {
    case 'passed':
      return '✓'; // ✓
    case 'warning':
      return '⚠'; // ⚠
    case 'failed':
      return '✗'; // ✗
    default:
      return '';
  }
};

// Honesty: only http(s) URIs may be rendered as openable links. Anything else
// (s3://, gs://, file://, empty) must be shown as selectable text so a
// non-openable location never masquerades as a live, clickable link.
export const isHttpUri = (uri) => /^https?:\/\//i.test(text(uri));

export const percent = (value) => {
  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    return text(value);
  }

  return `${Math.round(numeric * 100)}%`;
};

// Crash-free rate is honesty-critical: keep up to two decimals so a run with
// real crashes never rounds up to a clean-looking 100%. Returns '' for null so
// the caller can render the "Not captured" note instead of a fake percentage.
export const crashFreePercent = (value) => {
  if (value === null || value === undefined) {
    return text(value);
  }

  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    return text(value);
  }

  return `${Math.round(numeric * 10000) / 100}%`;
};

export const hasSectionContent = (section = {}) => {
  const data = section.data || {};

  if (section.type === 'summary') {
    return Boolean((data.areas || []).length);
  }

  if (section.type === 'rca') {
    return Boolean(
      data.summary ||
        data.reasoning ||
        (data.evidence || []).length ||
        (data.slow_url_api_cdn_evidence || []).length ||
        (data.timeline_correlation || []).length ||
        (data.related_kpis || []).length ||
        data.jira_ready,
    );
  }

  if (section.type === 'network') {
    return Boolean(data.summary || (data.slow_requests || data.rows || []).length);
  }

  if (section.type === 'kpi_table') {
    return Boolean((data.rows || []).length);
  }

  if (section.type === 'artifacts') {
    return Boolean((data.artifacts || data.rows || []).length);
  }

  if (section.type === 'history') {
    return Boolean((data.rows || data.history || []).length);
  }

  if (section.type === 'app_health') {
    // Always render App-Health: even a not-captured section must surface its
    // honest "Not captured" note rather than being silently hidden.
    return true;
  }

  return Boolean(Object.keys(data).length);
};

export const shouldAutoExpandSection = (section = {}) => {
  if (section.title === 'Performance Session Summary') {
    return true;
  }

  if (section.title === 'AI RCA & Insights') {
    return isWarningOrFail(section.status);
  }

  if (section.title === 'Network Intelligence') {
    return isWarningOrFail(section.status) || Boolean((section.data?.slow_requests || []).length);
  }

  if (section.type === 'kpi_table') {
    return isWarningOrFail(section.status);
  }

  if (section.type === 'app_health') {
    // Expand when stability actually failed (crash/native/ANR present); stay
    // collapsed for passed and not-captured ('info') runs.
    return isWarningOrFail(section.status) || Boolean(section.default_expanded);
  }

  return Boolean(section.default_expanded);
};
