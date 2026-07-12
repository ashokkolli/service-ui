import { mockObservabilityResponse } from './mockObservabilityResponse';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

// FASTBREAK_API_URL is the primary configuration; STREAM_PULSE_API_URL is kept as a
// deprecated compatibility fallback (CLAUDE.md §11 — support both during migration,
// do not silently drop the old one). Both process.env (build-time) and window
// (runtime) injection are honored, primary-then-fallback.
export const getStreamPulseApiBaseUrl = () =>
  trimTrailingSlash(
    process.env.FASTBREAK_API_URL ||
      (typeof window !== 'undefined' && window.FASTBREAK_API_URL) ||
      process.env.STREAM_PULSE_API_URL ||
      (typeof window !== 'undefined' && window.STREAM_PULSE_API_URL) ||
      '',
  );

export const getStreamPulseObservabilityUrl = (rpItemId) =>
  `${getStreamPulseApiBaseUrl()}/api/v1/reportportal/items/${encodeURIComponent(
    rpItemId,
  )}/observability`;

// Explicit mock: the mock is TAGGED (`__mock: true` + reason) so production never
// silently displays mock data as real (CLAUDE.md §11 / §20.6). The UI uses
// `isMockObservability()` to badge it and never mistake it for a live payload.
const asMock = (reason) => ({
  ...mockObservabilityResponse,
  __mock: true,
  __mock_reason: reason,
});

export const isMockObservability = (response) => Boolean(response && response.__mock);

export const fetchStreamPulseObservability = async (rpItemId) => {
  const baseUrl = getStreamPulseApiBaseUrl();

  if (!baseUrl || !rpItemId) {
    return asMock(!baseUrl ? 'no_api_url_configured' : 'no_rp_item_id');
  }

  try {
    const response = await fetch(getStreamPulseObservabilityUrl(rpItemId));

    if (!response.ok) {
      throw new Error(`FastBreak API returned ${response.status}`);
    }

    return response.json();
  } catch (error) {
    // Never silently pass mock off as real: log it and return a TAGGED mock so the
    // UI can surface a "sample data" badge instead of implying it is live.
    // eslint-disable-next-line no-console
    console.warn(
      '[FastBreak] observability fetch failed; returning tagged sample data:',
      (error && error.message) || error,
    );
    return asMock(`fetch_error:${(error && error.message) || 'unknown'}`);
  }
};

// --- action loop: owner-routed Jira bug / Slack notify / re-run --------------
// These POST to the FastBreak backend, which resolves the owner and performs the
// action (honest no-op when Jira/Slack/runner isn't configured server-side).
const postAction = async (rpItemId, action, body) => {
  const baseUrl = getStreamPulseApiBaseUrl();
  if (!baseUrl || !rpItemId) {
    throw new Error('FastBreak API URL not configured');
  }
  const response = await fetch(
    `${baseUrl}/api/v1/reportportal/items/${encodeURIComponent(rpItemId)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`FastBreak API returned ${response.status}`);
  }
  return response.json();
};

export const createBug = (rpItemId, overrides) => postAction(rpItemId, 'bug', overrides || null);
export const notifyGate = (rpItemId) => postAction(rpItemId, 'notify', null);
export const rerunFailed = (rpItemId) => postAction(rpItemId, 'rerun', null);
