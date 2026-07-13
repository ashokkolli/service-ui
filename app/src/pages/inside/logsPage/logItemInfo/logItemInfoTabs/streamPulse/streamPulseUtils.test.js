import {
  crashFreePercent,
  hasSectionContent,
  shouldAutoExpandSection,
  statusClass,
} from './streamPulseUtils';

describe('streamPulseUtils', () => {
  test('statusClass never greens an unknown status (honesty: unknown != passed)', () => {
    // genuine passes stay green
    ['passed', 'PASS', 'success', 'ok', 'healthy'].forEach((s) =>
      expect(statusClass(s)).toBe('passed'),
    );
    // warn / fail keep their colours
    expect(statusClass('failed')).toBe('failed');
    expect(statusClass('warning')).toBe('warning');
    // not-captured / informational -> neutral
    ['info', 'skipped', 'not_captured', 'na'].forEach((s) =>
      expect(statusClass(s)).toBe('info'),
    );
    // UNKNOWN statuses (incl. a diagnostic rca_category or 'unknown') must be NEUTRAL,
    // never a reassuring green pass.
    ['unknown', 'network_cdn_degradation', '', null, undefined].forEach((s) =>
      expect(statusClass(s)).toBe('info'),
    );
  });

  test('hides empty sections', () => {
    expect(hasSectionContent({ type: 'kpi_table', data: { rows: [] } })).toBe(false);
    expect(hasSectionContent({ type: 'network', data: { slow_requests: [] } })).toBe(false);
  });

  test('always renders app_health sections, even when stability was not captured', () => {
    expect(hasSectionContent({ type: 'app_health', data: { captured: false } })).toBe(true);
    expect(
      hasSectionContent({ type: 'app_health', data: { captured: true, crashes: 0 } }),
    ).toBe(true);
  });

  test('auto-expands app_health only when stability failed', () => {
    expect(
      shouldAutoExpandSection({ type: 'app_health', status: 'failed', default_expanded: false }),
    ).toBe(true);
    expect(
      shouldAutoExpandSection({ type: 'app_health', status: 'passed', default_expanded: false }),
    ).toBe(false);
    expect(
      shouldAutoExpandSection({ type: 'app_health', status: 'info', default_expanded: false }),
    ).toBe(false);
  });

  test('crashFreePercent stays honest: null renders empty, real crashes never round up to 100%', () => {
    expect(crashFreePercent(null)).toBe('');
    expect(crashFreePercent(undefined)).toBe('');
    expect(crashFreePercent(1)).toBe('100%');
    expect(crashFreePercent(0.982)).toBe('98.2%');
    expect(crashFreePercent(0.9985)).toBe('99.85%');
    // A run with a crash must not be rounded up to a clean-looking 100%.
    expect(crashFreePercent(0.998)).not.toBe('100%');
  });

  test('auto-expands performance summary, network issues, and warning/failing sections', () => {
    expect(
      shouldAutoExpandSection({
        title: 'Performance Session Summary',
        type: 'summary',
        status: 'passed',
        data: { areas: [{ area: 'startup' }] },
      }),
    ).toBe(true);
    expect(
      shouldAutoExpandSection({
        title: 'Network Intelligence',
        type: 'network',
        status: 'passed',
        data: { slow_requests: [{ host: 'cdn.example.net' }] },
      }),
    ).toBe(true);
    expect(
      shouldAutoExpandSection({
        title: 'QoE KPIs',
        type: 'kpi_table',
        status: 'warning',
        data: { rows: [{ key: 'ttff_ms' }] },
      }),
    ).toBe(true);
    expect(
      shouldAutoExpandSection({
        title: 'Device KPIs',
        type: 'kpi_table',
        status: 'passed',
        data: { rows: [{ key: 'cpu_percent' }] },
      }),
    ).toBe(false);
  });
});
