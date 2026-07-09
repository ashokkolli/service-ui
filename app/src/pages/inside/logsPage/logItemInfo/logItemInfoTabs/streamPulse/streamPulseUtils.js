export const text = (value) => (value === null || value === undefined ? '' : String(value));

export const statusClass = (status) => {
  const normalized = text(status).toLowerCase();

  if (['failed', 'fail', 'critical', 'error', 'high'].includes(normalized)) {
    return 'failed';
  }

  if (['warning', 'warn', 'regressed', 'medium'].includes(normalized)) {
    return 'warning';
  }

  return 'passed';
};

export const isWarningOrFail = (status) => ['warning', 'failed'].includes(statusClass(status));

export const percent = (value) => {
  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    return text(value);
  }

  return `${Math.round(numeric * 100)}%`;
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

  return Boolean(section.default_expanded);
};
