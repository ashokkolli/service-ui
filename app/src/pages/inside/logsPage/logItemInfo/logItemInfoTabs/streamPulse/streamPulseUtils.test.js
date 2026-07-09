import { hasSectionContent, shouldAutoExpandSection } from './streamPulseUtils';

describe('streamPulseUtils', () => {
  test('hides empty sections', () => {
    expect(hasSectionContent({ type: 'kpi_table', data: { rows: [] } })).toBe(false);
    expect(hasSectionContent({ type: 'network', data: { slow_requests: [] } })).toBe(false);
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
