export const text = (value) => (value === null || value === undefined ? '' : String(value));

export const statusClass = (status) => {
  const normalized = text(status).toLowerCase();

  // 'regression' is History/Regression's direction-aware verdict: the KPI moved the
  // BAD way for its own direction (rising rebuffer). It must read as a failure.
  if (['failed', 'fail', 'critical', 'error', 'high', 'regression'].includes(normalized)) {
    return 'failed';
  }

  if (['warning', 'warn', 'regressed', 'medium'].includes(normalized)) {
    return 'warning';
  }

  // Only genuinely-passing statuses read green. Everything the UI does not
  // explicitly recognise as pass/warn/fail falls to a NEUTRAL 'info' badge — never
  // green. Otherwise an 'unknown'/'no data' section or a diagnostic rca_category
  // label (e.g. 'network_cdn_degradation') would render as a reassuring green pass.
  if (
    ['passed', 'pass', 'passing', 'success', 'ok', 'healthy', 'low', 'improvement'].includes(
      normalized,
    )
  ) {
    return 'passed';
  }

  return 'info';
};

export const isWarningOrFail = (status) => ['warning', 'failed'].includes(statusClass(status));

// ── KPI display state (Top-KPI cards) ──────────────────────────────────────
// FIVE states, because the three pass/warn/fail buckets overload two very
// different things onto the same swatch:
//
//   breached  ▲  a budget resolved and the value is outside it
//   at_risk   ◆  a budget resolved and the value is near the edge
//   passed    ●  a budget ACTUALLY RESOLVED and the value is inside it
//   observed  ○  measured, but nothing was checked against it (no budget)
//   no_data   —  not measured at all
//
// 'passed' must require an explicit pass. An unrecognised status is an
// OBSERVATION, never a pass — we do not paint a green tick on a number that
// nothing was judged against, and 'observed' is deliberately neutral slate
// (neither red nor green) so it reads as "recorded", not "fine".
//
// A real measured 0 (e.g. segment_failure_rate = 0.0, a GOOD result) is
// structurally distinct from an absence: it renders as a normal solid card
// reading "0%", while no_data renders as an em-dash on a hatched card.
const KPI_STATE_FALLBACK = {
  critical: { state: 'breached', glyph: '▲', label: 'Breached' },
  failed: { state: 'breached', glyph: '▲', label: 'Breached' },
  fail: { state: 'breached', glyph: '▲', label: 'Breached' },
  error: { state: 'breached', glyph: '▲', label: 'Breached' },
  breached: { state: 'breached', glyph: '▲', label: 'Breached' },
  warning: { state: 'at_risk', glyph: '◆', label: 'At risk' },
  warn: { state: 'at_risk', glyph: '◆', label: 'At risk' },
  regressed: { state: 'at_risk', glyph: '◆', label: 'At risk' },
  at_risk: { state: 'at_risk', glyph: '◆', label: 'At risk' },
  passed: { state: 'passed', glyph: '●', label: 'Within budget' },
  pass: { state: 'passed', glyph: '●', label: 'Within budget' },
  good: { state: 'passed', glyph: '●', label: 'Within budget' },
  ok: { state: 'passed', glyph: '●', label: 'Within budget' },
  no_data: { state: 'no_data', glyph: '—', label: 'Not measured' },
  not_measured: { state: 'no_data', glyph: '—', label: 'Not measured' },
  not_captured: { state: 'no_data', glyph: '—', label: 'Not measured' },
  missing: { state: 'no_data', glyph: '—', label: 'Not measured' },
};

const KPI_STATE_OBSERVED = { state: 'observed', glyph: '○', label: 'Observed' };

export const kpiDisplayState = (kpi = {}) => {
  // The backend already resolves this (display_state/state_glyph/state_label).
  // Prefer it so the card and the API tell exactly the same story; the map above
  // is only a fallback for payloads older than that contract.
  if (kpi.display_state && KPI_STATE_FALLBACK[kpi.display_state]) {
    return {
      state: kpi.display_state,
      glyph: kpi.state_glyph || KPI_STATE_FALLBACK[kpi.display_state].glyph,
      label: kpi.state_label || KPI_STATE_FALLBACK[kpi.display_state].label,
    };
  }

  if (kpi.display_state === 'observed') {
    return {
      state: 'observed',
      glyph: kpi.state_glyph || KPI_STATE_OBSERVED.glyph,
      label: kpi.state_label || KPI_STATE_OBSERVED.label,
    };
  }

  const value = kpi.display_value !== undefined && kpi.display_value !== '' ? kpi.display_value : kpi.value;

  if (value === null || value === undefined || value === '') {
    return KPI_STATE_FALLBACK.no_data;
  }

  return KPI_STATE_FALLBACK[text(kpi.status).toLowerCase()] || KPI_STATE_OBSERVED;
};

// Never print a raw dotted series key at a human. The backend sets
// display_name = key when the KPI catalog has no label for it, so "present"
// is not the same as "human" — detect the machine key and title-case its tail.
export const humanizeKpiKey = (key) => {
  const raw = text(key);

  if (!raw) {
    return 'Unnamed KPI';
  }

  const tail = raw.includes('.') ? raw.split('.').pop() : raw;

  return (
    tail
      .replace(/_(ms|s|pct|percent|ratio|rate|count|mb|kb|bps|fps)$/i, '')
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || raw
  );
};

export const kpiDisplayName = (kpi = {}) => {
  const rawKey = text(kpi.raw_key || kpi.key);
  const label = text(kpi.display_label || kpi.display_name);

  if (!label || label === rawKey || /^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(label)) {
    return humanizeKpiKey(rawKey || label);
  }

  return label;
};

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
    // A history payload with no rows but an explicit no_data_reason must still
    // render — the honest "why there is no history" beats a silently absent panel.
    return Boolean((data.rows || data.history || []).length || data.no_data_reason);
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
