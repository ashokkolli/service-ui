import { mockObservabilityResponse } from './mockObservabilityResponse';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

export const getStreamPulseApiBaseUrl = () =>
  trimTrailingSlash(process.env.STREAM_PULSE_API_URL || window.STREAM_PULSE_API_URL || '');

export const getStreamPulseObservabilityUrl = (rpItemId) =>
  `${getStreamPulseApiBaseUrl()}/api/v1/reportportal/items/${encodeURIComponent(
    rpItemId,
  )}/observability`;

export const fetchStreamPulseObservability = async (rpItemId) => {
  const baseUrl = getStreamPulseApiBaseUrl();

  if (!baseUrl || !rpItemId) {
    return mockObservabilityResponse;
  }

  try {
    const response = await fetch(getStreamPulseObservabilityUrl(rpItemId));

    if (!response.ok) {
      throw new Error(`StreamPulse API returned ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return mockObservabilityResponse;
  }
};
