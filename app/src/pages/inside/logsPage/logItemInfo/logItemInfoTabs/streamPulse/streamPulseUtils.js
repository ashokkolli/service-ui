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
  // MEASURED, BUT NOT JUDGED HERE. A KPI whose budget belongs to a different
  // scenario -- e.g. an ad-impression budget on the Home-tab test, where no ad
  // playback occurs. The value is REAL and is still shown; only the verdict is
  // withheld, and the backend deliberately omits the threshold so no meter can
  // be drawn for a budget it refuses to apply.
  //
  // This entry is load-bearing: `kpiDisplayState` below gates on
  // KPI_STATE_FALLBACK[display_state] BEFORE trusting the backend, so without a
  // key here an 'out_of_scope' KPI falls through to the observed branch and
  // renders "No budget defined" -- a false statement about a KPI that HAS a
  // budget. Deleting this line reintroduces that lie.
  out_of_scope: { state: 'out_of_scope', glyph: '◇', label: 'Not judged here' },
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

// ── RCA panel ──────────────────────────────────────────────────────────────
// The panel reconciles TWO independent classifiers that can disagree, so neither
// may be rendered as "the" confidence without naming which engine produced it:
//
//   rules      nba-automation/observability/rca_rules.py publishes the insight the
//              payload's `category` / `confidence` / `suggested_owner` come from.
//   signatures streampulse fastbreak/rca_grounding.py produces `grounded` — the
//              deterministic signature library, with signatures_evaluated and an
//              evidence_hash.
//
// They really do disagree in live data: session 142920 carries PLAYBACK_BLACK_SCREEN
// at 0.9 from the rules engine while `grounded` is UNCLASSIFIED at 0.0.
//
// BOTH engines emit 0.0 as their NO-BASIS value when nothing matched. Rendering that
// as "0%" asserts a measurement nobody made, so `confidence` is null in every
// unmatched state and the caller must print a reason instead — never a number.
const RCA_NO_VERDICT = ['', 'NONE', 'UNKNOWN', 'UNCLASSIFIED'];

// 'NONE' is the API schema default and 'UNKNOWN' the column default; both mean
// "never classified". Neither is a category, so neither may render as one.
export const isRcaNoVerdict = (category) =>
  RCA_NO_VERDICT.includes(text(category).trim().toUpperCase());

export const RCA_CLASSIFIER_RULES = 'deterministic KPI rules (observability/rca_rules.py)';
export const RCA_CLASSIFIER_SIGNATURES = 'signature library (fastbreak/rca_grounding.py)';

// FOUR states:
//   matched            an engine returned a category AND earned a confidence
//   nothing_to_explain no KPI breached, so no question was asked
//   degraded           `grounded` is absent: classify_session raised, and we cannot
//                      tell "matched" from "no match" — we must say so
//   unmatched          the library ran over real breaches and nothing matched
export const rcaVerdict = (data = {}, breachCount = 0) => {
  const grounded = data.grounded || null;
  const groundedMatched = Boolean(
    grounded &&
      grounded.signature_id !== null &&
      grounded.signature_id !== undefined &&
      !isRcaNoVerdict(grounded.category),
  );
  // The rules engine only counts as matched when it ALSO earned a confidence: its
  // unmatched branch returns category UNCLASSIFIED with a hardcoded 0.0.
  const rulesMatched = !isRcaNoVerdict(data.category) && Number(data.confidence) > 0;

  let state = 'unmatched';
  if (groundedMatched || rulesMatched) {
    state = 'matched';
  } else if (breachCount === 0) {
    state = 'nothing_to_explain';
  } else if (!grounded) {
    state = 'degraded';
  }

  const evaluated = grounded ? Number(grounded.signatures_evaluated) : NaN;
  const verdict = {
    state,
    category: '',
    confidence: null,
    classifier: '',
    owner: '',
    ownerRouted: false,
    signaturesEvaluated: Number.isFinite(evaluated) ? evaluated : null,
    evidenceHash: text(grounded && grounded.evidence_hash),
    // true  — the signature library independently reached the same verdict
    // false — it ran and did NOT corroborate the rules engine
    // null  — it did not run, so corroboration is unknown (never "disproved")
    corroborated: null,
  };

  if (groundedMatched) {
    verdict.category = text(grounded.category);
    verdict.confidence = Number(grounded.confidence);
    verdict.classifier = `${RCA_CLASSIFIER_SIGNATURES} · signature #${grounded.signature_id}`;
    verdict.owner = text(grounded.owner_team);
    verdict.corroborated = true;
  } else if (rulesMatched) {
    verdict.category = text(data.category);
    verdict.confidence = Number(data.confidence);
    verdict.classifier = RCA_CLASSIFIER_RULES;
    verdict.owner = text(data.suggested_owner);
    verdict.corroborated = grounded ? false : null;
  }

  verdict.ownerRouted = Boolean(verdict.owner) && verdict.owner.toLowerCase() !== 'unassigned';
  return verdict;
};

// A payload string still carrying a serialized Python/JS object. We do NOT prettify
// such a string: a frontend that papers over a fabricating emitter hides the defect
// from every downstream reader of the same field.
export const containsSerializedDict = (value) => /\{\s*['"][a-z_]+['"]\s*:/i.test(text(value));

export const medianMs = (sortedAsc = []) => {
  if (!sortedAsc.length) {
    return null;
  }

  const mid = Math.floor(sortedAsc.length / 2);

  return sortedAsc.length % 2
    ? sortedAsc[mid]
    : Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
};

// Twenty flat rows where ten are the SAME endpoint reads as ten unrelated problems.
// Group by (type, host, path) so repetition becomes the headline. Pure derivation over
// rows the API measured — an empty input yields an empty list, never a zero row.
export const groupSlowRequests = (rows = []) => {
  const groups = new Map();

  rows.forEach((row) => {
    // Pre-formatted string rows (the legacy rca.evidence[] shape) are not groupable
    // and are never rendered by this panel.
    if (!row || typeof row !== 'object') {
      return;
    }

    const host = text(row.host);
    const path = text(row.sanitized_path || row.path || row.sanitized_url);
    const type = text(row.request_type || row.type);
    const id = `${type}|${host}|${path}`;

    if (!groups.has(id)) {
      groups.set(id, { id, type, host, path, durations: [], thresholds: [], codes: new Set(), firstMs: null });
    }

    const group = groups.get(id);
    const duration = Number(row.duration_ms);
    const threshold = Number(row.threshold_ms);
    const start = Number(row.start_ms);

    if (Number.isFinite(duration)) {
      group.durations.push(duration);
    }
    if (Number.isFinite(threshold)) {
      group.thresholds.push(threshold);
    }
    if (row.status_code !== null && row.status_code !== undefined) {
      group.codes.add(String(row.status_code));
    }
    if (Number.isFinite(start) && (group.firstMs === null || start < group.firstMs)) {
      group.firstMs = start;
    }
  });

  return Array.from(groups.values())
    .map((group) => {
      const sorted = group.durations.slice().sort((a, b) => a - b);

      return {
        id: group.id,
        type: group.type,
        host: group.host,
        path: group.path,
        hits: group.durations.length,
        medianMs: medianMs(sorted),
        worstMs: sorted.length ? sorted[sorted.length - 1] : null,
        // min: the tightest threshold any row in the group was judged against.
        thresholdMs: group.thresholds.length ? Math.min(...group.thresholds) : null,
        statusCodes: Array.from(group.codes).sort(),
        firstMs: group.firstMs,
      };
    })
    .sort((a, b) => b.hits - a.hits || (b.worstMs || 0) - (a.worstMs || 0));
};

// Roll-up by host so "identity.nba.com accounts for 11 of 20" is stateable.
export const topHostShare = (groups = []) => {
  const byHost = new Map();
  let total = 0;

  groups.forEach((group) => {
    byHost.set(group.host, (byHost.get(group.host) || 0) + group.hits);
    total += group.hits;
  });

  const ranked = Array.from(byHost.entries()).sort((a, b) => b[1] - a[1]);

  if (!ranked.length || !total) {
    return null;
  }

  return { host: ranked[0][0], hits: ranked[0][1], total, hostCount: ranked.length };
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
