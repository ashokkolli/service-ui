import {
  getStreamPulseApiBaseUrl,
  getStreamPulseObservabilityUrl,
  fetchStreamPulseObservability,
  isMockObservability,
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
});
