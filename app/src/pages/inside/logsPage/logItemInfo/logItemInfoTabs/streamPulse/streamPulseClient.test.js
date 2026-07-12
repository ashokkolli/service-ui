import {
  getStreamPulseApiBaseUrl,
  getStreamPulseObservabilityUrl,
  fetchStreamPulseObservability,
  isMockObservability,
  createBug,
  notifyGate,
  rerunFailed,
} from './streamPulseClient';
import { mockObservabilityResponse } from './mockObservabilityResponse';

describe('streamPulseClient', () => {
  const originalFetch = global.fetch;
  const originalProcessEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalProcessEnv };
    delete process.env.FASTBREAK_API_URL;
    delete process.env.STREAM_PULSE_API_URL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalProcessEnv;
    global.fetch = originalFetch;
  });

  test('builds observability URL from configured API base URL and ReportPortal item id', () => {
    process.env.STREAM_PULSE_API_URL = 'http://127.0.0.1:8000/';

    expect(getStreamPulseApiBaseUrl()).toBe('http://127.0.0.1:8000');
    expect(getStreamPulseObservabilityUrl(123)).toBe(
      'http://127.0.0.1:8000/api/v1/reportportal/items/123/observability',
    );
  });

  test('FASTBREAK_API_URL takes precedence over the deprecated STREAM_PULSE_API_URL', () => {
    process.env.FASTBREAK_API_URL = 'http://fastbreak:9000';
    process.env.STREAM_PULSE_API_URL = 'http://legacy:8000';

    expect(getStreamPulseApiBaseUrl()).toBe('http://fastbreak:9000');
  });

  test('returns tagged sample data (never silently mock) when no API URL is configured', async () => {
    const response = await fetchStreamPulseObservability('rp-item-1');

    expect(isMockObservability(response)).toBe(true);
    expect(response.__mock_reason).toBe('no_api_url_configured');
    expect(response.top_kpis).toEqual(mockObservabilityResponse.top_kpis);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns the live payload on a successful fetch (not mock)', async () => {
    process.env.FASTBREAK_API_URL = 'http://127.0.0.1:8000';
    const live = { top_kpis: [{ key: 'ttff_ms', value: 3430 }], __live: true };
    global.fetch.mockResolvedValue({ ok: true, json: async () => live });

    const response = await fetchStreamPulseObservability('rp-item-1');

    expect(isMockObservability(response)).toBe(false);
    expect(response).toBe(live);
  });

  test('falls back to TAGGED sample data when the API request fails', async () => {
    process.env.FASTBREAK_API_URL = 'http://127.0.0.1:8000';
    global.fetch.mockRejectedValue(new Error('network unavailable'));

    const response = await fetchStreamPulseObservability('rp-item-1');

    expect(isMockObservability(response)).toBe(true);
    expect(response.__mock_reason).toContain('fetch_error');
    expect(response.top_kpis).toEqual(mockObservabilityResponse.top_kpis);
  });

  test('createBug POSTs to the bug endpoint with overrides and returns the result', async () => {
    process.env.FASTBREAK_API_URL = 'http://127.0.0.1:8000';
    const result = { ok: false, assignee: 'OTT QA', issue_key: null, result: { reason: 'jira_not_configured' } };
    global.fetch.mockResolvedValue({ ok: true, json: async () => result });

    const r = await createBug('rp-1', { priority: 'Highest' });

    expect(r).toBe(result);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/api/v1/reportportal/items/rp-1/bug');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ priority: 'Highest' });
  });

  test('rerunFailed POSTs to the rerun endpoint', async () => {
    process.env.FASTBREAK_API_URL = 'http://127.0.0.1:8000';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'runner_not_configured' }) });

    const r = await rerunFailed('rp-1');

    expect(r.reason).toBe('runner_not_configured');
    expect(global.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/reportportal/items/rp-1/rerun');
  });

  test('actions throw when no API URL is configured', async () => {
    await expect(notifyGate('rp-1')).rejects.toThrow('not configured');
  });
});
