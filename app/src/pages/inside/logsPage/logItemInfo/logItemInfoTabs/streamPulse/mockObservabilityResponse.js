export const mockObservabilityResponse = {
  session: {
    id: 'mock-rp-item',
    name: 'StreamPulse local mock session',
    platform: 'android',
    device: 'Pixel 8',
    region: 'Mexico',
    cuj: 'live_playback',
    functional_status: 'passed',
    observability_status: 'warning',
    rca_category: 'network_cdn_degradation',
  },
  top_kpis: [
    {
      id: 'ttff_ms',
      key: 'ttff_ms',
      display_name: 'Time To First Frame',
      formatted_value: '2.84s',
      category: 'QoE',
      status: 'warning',
      release_gate: true,
    },
    {
      id: 'rebuffer_ratio',
      key: 'rebuffer_ratio',
      display_name: 'Rebuffer Ratio',
      formatted_value: '1.8%',
      category: 'QoE',
      status: 'warning',
      release_gate: true,
    },
    {
      id: 'cpu_percent',
      key: 'cpu_percent',
      display_name: 'CPU',
      formatted_value: '42%',
      category: 'Device',
      status: 'passed',
    },
  ],
  accordion_sections: [
    {
      key: 'performance-summary',
      title: 'Performance Session Summary',
      type: 'summary',
      status: 'warning',
      data: {
        areas: [
          {
            area: 'Playback startup',
            status: 'warning',
            finding: 'TTFF exceeded the configured 2500ms warning threshold.',
          },
          {
            area: 'Continuity',
            status: 'warning',
            finding: 'Short rebuffer event correlated with CDN segment latency.',
          },
        ],
      },
    },
    {
      key: 'app_health',
      title: 'App-Health (Stability)',
      type: 'app_health',
      status: 'passed',
      default_expanded: false,
      data: {
        captured: true,
        crash_free_rate: 1,
        crashes: 0,
        native_crashes: 0,
        anrs: 0,
        oom_kills: 0,
        note: 'On-device ApplicationExitInfo snapshot captured — no crashes, native crashes, ANRs, or OOM kills for this run.',
      },
    },
    {
      key: 'ai-rca',
      title: 'AI RCA & Insights',
      type: 'rca',
      status: 'warning',
      data: {
        category: 'network_cdn_degradation',
        confidence: 0.86,
        impact: 'User experience risk during live playback startup.',
        summary:
          'The functional test passed, but playback startup and buffering KPIs regressed because of slow CDN/API responses.',
        reasoning:
          'TTFF and rebuffer warnings line up with slow HLS manifest and media segment requests. Device CPU and memory remained within thresholds, making device pressure less likely.',
        slow_url_api_cdn_evidence: [
          {
            host: 'cdn.example.net',
            sanitized_path: '/live/channel-7/segment-1042.ts',
            request_type: 'cdn_segment',
            status_code: 200,
            duration_ms: 1840,
            threshold_ms: 900,
            impact: 'Delayed media buffer fill before first frame.',
          },
          {
            host: 'api.example.net',
            sanitized_path: '/v1/playback/session',
            request_type: 'api',
            status_code: 200,
            duration_ms: 1220,
            threshold_ms: 700,
            impact: 'Slowed playback authorization.',
          },
        ],
        timeline_correlation: [
          { timestamp_ms: 1480, event: 'PLAY_CLICKED', description: 'Playback request started.' },
          { timestamp_ms: 2840, event: 'FIRST_FRAME', description: 'First frame rendered.' },
        ],
        related_kpis: [
          { key: 'ttff_ms', display_name: 'Time To First Frame', status: 'warning' },
          { key: 'rebuffer_ratio', display_name: 'Rebuffer Ratio', status: 'warning' },
        ],
        suggested_owner: 'Video Delivery / CDN',
        recommended_action: [
          'Review CDN edge latency for live channel traffic in Mexico.',
          'Check playback authorization latency for the affected region.',
        ],
        jira_ready: {
          summary: 'Investigate CDN/API latency causing playback QoE warnings',
          description:
            'StreamPulse correlated TTFF and rebuffer warnings with slow CDN segment and playback API responses.',
        },
      },
    },
    {
      key: 'network-intelligence',
      title: 'Network Intelligence',
      type: 'network',
      status: 'warning',
      data: {
        summary: 'Two slow requests exceeded configured thresholds.',
        slow_requests: [
          {
            host: 'cdn.example.net',
            sanitized_path: '/live/channel-7/segment-1042.ts',
            request_type: 'cdn_segment',
            status_code: 200,
            duration_ms: 1840,
            threshold_ms: 900,
            impact: 'Delayed media buffer fill.',
          },
          {
            host: 'api.example.net',
            sanitized_path: '/v1/playback/session',
            request_type: 'api',
            status_code: 200,
            duration_ms: 1220,
            threshold_ms: 700,
            impact: 'Slowed startup authorization.',
          },
        ],
      },
    },
    {
      key: 'qoe-kpis',
      title: 'QoE KPIs',
      type: 'kpi_table',
      status: 'warning',
      data: {
        rows: [
          {
            key: 'ttff_ms',
            display_name: 'Time To First Frame',
            formatted_value: '2.84s',
            status: 'warning',
            owner: 'Video Playback',
            evidence: 'First frame timestamp was 2840ms.',
          },
        ],
      },
    },
    {
      key: 'artifacts-evidence',
      title: 'Artifacts & Evidence',
      type: 'artifacts',
      status: 'passed',
      data: {
        artifacts: [
          {
            type: 'video',
            name: 'session-replay.mp4',
            storage: 's3',
            uri: 's3://streampulse-artifacts/mock/session-replay.mp4',
          },
        ],
      },
    },
    {
      key: 'history-regression',
      title: 'History / Regression',
      type: 'history',
      status: 'warning',
      data: {
        rows: [
          {
            build: '8.2.0-rc4',
            kpi_key: 'ttff_ms',
            previous: '2.21s',
            current: '2.84s',
            delta_pct: 28.5,
            status: 'regressed',
          },
        ],
      },
    },
  ],
};
