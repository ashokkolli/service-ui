import {
  getStreamPulseApiBaseUrl,
  getStreamPulseObservabilityUrl,
  fetchStreamPulseObservability,
} from './streamPulseClient';
import { mockObservabilityResponse } from './mockObservabilityResponse';

describe('streamPulseClient', () => {
  const originalFetch = global.fetch;
  const originalProcessEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalProcessEnv };
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

  test('falls back to local mock response when API request fails', async () => {
    process.env.STREAM_PULSE_API_URL = 'http://127.0.0.1:8000';
    global.fetch.mockRejectedValue(new Error('network unavailable'));

    const response = await fetchStreamPulseObservability('rp-item-1');

    expect(response).toBe(mockObservabilityResponse);
  });
});
