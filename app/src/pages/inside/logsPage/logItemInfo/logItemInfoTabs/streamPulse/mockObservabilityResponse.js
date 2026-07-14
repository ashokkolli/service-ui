/*
 * SAMPLE observability payload. Rendered ONLY when the FastBreak API can't be reached,
 * and always TAGGED (streamPulseClient adds __mock:true) so the UI shows a "SAMPLE data"
 * banner — it is never presented as a live measurement. It mirrors the agreed design
 * (TC-NBA-005 · Live Game Playback) so the full tab layout is visible without a live
 * backend. Sparkline series here are illustrative sample curves, not real captures.
 */

// Build an illustrative sample series over `dur` ms, with an optional dip/spike window
// (the 00:38 stall) so the correlated tracks visibly move together with the scrubber.
const mkSeries = (base, { amp = 0.06, drift = 0, stallTo = null, n = 26, dur = 60000 } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const t = Math.round((i / (n - 1)) * dur);
    let v = base + base * amp * Math.sin(i / 1.7) + drift * (i / (n - 1)) * base;
    if (stallTo !== null && t >= 37000 && t <= 40000) v = stallTo;
    return { t, v: Math.round(v * 100) / 100 };
  });

const TL = (offset_ms, name, status = 'info') => ({ offset_ms, name, event_type: 'APP', status });

export const mockObservabilityResponse = {
  session: {
    id: 'mock-tc-nba-005',
    name: 'TC-NBA-005 · Live Game Playback',
    platform: 'android',
    device: 'Pixel 8',
    os_version: '15',
    region: 'Mexico',
    network_profile: '5G',
    cuj: 'live_playback',
    functional_status: 'passed',
    observability_status: 'warning',
    rca_category: 'CDN_SEGMENT_LATENCY',
  },
  verdict: {
    functional_headline: 'Passed',
    functional_note: 'All 14 assertions passed — never rewritten by experience signals.',
    experience_headline: 'Warning',
    experience_note: "QoE degraded by a rebuffer at 00:38 — the user saw it, the test didn't fail.",
    gate_headline: '1 critical KPI',
    gate_note: 'Segment latency p95 breached. Feeds the run gate — not a per-test block.',
  },
  top_kpis: [
    { id: 'exp', key: 'experience_score', display_name: 'Experience score', formatted_value: '71/100', status: 'warning', category: 'QoE', threshold_label: '≥80' },
    { id: 'ttff', key: 'ttff_ms', display_name: 'Time to first frame', formatted_value: '3.43s', status: 'warning', category: 'QoE', release_gate: true, threshold_label: '≤3.0s' },
    { id: 'reb', key: 'rebuffer_ratio', display_name: 'Rebuffer ratio', formatted_value: '1.8%', status: 'warning', category: 'QoE', release_gate: true, threshold_label: '≤1%' },
    { id: 'seg', key: 'segment_latency_p95', display_name: 'Segment latency p95', formatted_value: '1.45s', status: 'failed', category: 'QoS', release_gate: true, threshold_label: '≤0.8s' },
    { id: 'cpu', key: 'peak_cpu', display_name: 'Peak CPU', formatted_value: '64%', status: 'passed', category: 'Device', threshold_label: '≤75%' },
    { id: 'mem', key: 'peak_memory', display_name: 'Peak memory', formatted_value: '643MB', status: 'passed', category: 'Device', threshold_label: '≤900MB' },
    { id: 'bat', key: 'battery_drain', display_name: 'Battery drain', formatted_value: '2.8%', status: 'warning', category: 'Device', threshold_label: '≤2.5%' },
  ],
  session_replay: {
    captured: true,
    has_tracks: true,
    duration_ms: 60000,
    stall_window: { start_ms: 38000, end_ms: 39800 },
    timeline: [
      TL(1000, 'Home visible'),
      TL(6000, 'Play tapped'),
      TL(9000, 'First frame', 'passed'),
      TL(38000, 'Slow 1080p segment · 1450ms', 'failed'),
      TL(38000, 'Rebuffer start · 1.8s', 'warning'),
      TL(40000, 'Rebuffer end'),
    ],
    sections: [
      { title: 'QoE · Playback', tracks: [
        { key: 'buffer_health', display_name: 'Buffer health', category: 'seconds buffered', unit: 's', current: 0, avg: 6.28, min: 0, max: 12, series: mkSeries(6.3, { stallTo: 0 }) },
        { key: 'dropped_frames', display_name: 'Dropped frames', category: 'per second', unit: '', current: 0, avg: 2, min: 0, max: 42, series: mkSeries(2, { stallTo: 42 }) },
      ] },
      { title: 'Device', tracks: [
        { key: 'cpu', display_name: 'CPU', category: 'processor load', unit: '%', current: 37, avg: 47.36, min: 34, max: 65, series: mkSeries(46, { stallTo: 64 }) },
        { key: 'memory', display_name: 'Memory', category: 'resident set', unit: 'MB', current: 500, avg: 573.1, min: 500, max: 641, series: mkSeries(560, { drift: 0.14 }) },
        { key: 'frame_rate', display_name: 'Frame rate', category: 'render fps', unit: 'fps', current: 60, avg: 41.53, min: 9.5, max: 60, series: mkSeries(58, { stallTo: 9.5 }) },
      ] },
      { title: 'Video Quality', tracks: [
        { key: 'blackness', display_name: 'Blackness', category: 'black-frame ratio', unit: '', current: 0.92, avg: 0.14, min: 0.04, max: 0.92, series: mkSeries(0.12, { stallTo: 0.92 }) },
        { key: 'sharpness', display_name: 'Sharpness', category: 'focus index', unit: '', current: 40, avg: 231.28, min: 40, max: 270, series: mkSeries(240, { stallTo: 40 }) },
        { key: 'brightness', display_name: 'Brightness', category: 'luminance', unit: '', current: 8, avg: 78.03, min: 8, max: 90, series: mkSeries(80, { stallTo: 8 }) },
      ] },
      { title: 'Network', tracks: [
        { key: 'throughput', display_name: 'Throughput', category: 'downstream', unit: 'kbps', current: 260, avg: 10654, min: 25, max: 26600, series: mkSeries(12000, { amp: 0.2, stallTo: 260 }) },
      ] },
    ],
  },
  ai_rca_insights: {
    category: 'CDN_SEGMENT_LATENCY',
    confidence: 0.87,
    impact: '1 rebuffer · 1.8s stall',
    suggested_owner: 'Streaming / CDN Team',
    summary:
      'Functional playback passed, but the experience degraded: a 1080p HLS segment took 1,450 ms to arrive at 00:38, overrunning the 800 ms budget, and the player rebuffered for 1.8s. CPU (64%), memory (643 MB) and API latency (260 ms) were all healthy at that moment — so this is CDN / video delivery, not device or app instability.',
    reasoning:
      'The strongest signal is a slow CDN segment request correlated with the rebuffer start; device planes stayed within thresholds, ruling out device pressure.',
    slow_url_api_cdn_evidence: [
      { host: 'cdn.nba.example.com', sanitized_path: '/hls/live/game123/video_1080p_0042.m4s', request_type: 'cdn_segment', status_code: 200, duration_ms: 1450, threshold_ms: 800, impact: 'Overran the segment budget; rebuffer start at 00:38.' },
    ],
    timeline_correlation: [
      { timestamp_ms: 38000, event: 'Slow 1080p segment (1450ms)' },
      { timestamp_ms: 38000, event: 'Rebuffer start (1.8s)' },
    ],
    related_kpis: [
      { key: 'ttff_ms', display_name: 'Time to first frame', status: 'warning' },
      { key: 'rebuffer_ratio', display_name: 'Rebuffer ratio', status: 'warning' },
      { key: 'segment_latency_p95', display_name: 'Segment latency p95', status: 'failed' },
    ],
    recommended_action: [
      'Pre-warm the 1080p CDN edge for Mexico — the stalled segment came from a cold edge; add MX to the pre-warm set. [Streaming / CDN]',
      'Cap the opening ABR rung on variable 5G — hold 720p until buffer ≥ 4s so a slow 1080p fetch can’t stall startup. [Player]',
      'Add a segment-latency SLO alert at 800 ms p95 / region — trip before users see it. [SRE]',
    ],
    jira_ready: {
      summary: 'Investigate CDN/API latency causing playback QoE warnings',
      description:
        'StreamPulse correlated TTFF and rebuffer warnings with a slow CDN segment (cdn.nba.example.com/hls/live/game123/video_1080p_0042.m4s, 1450ms vs 800ms budget) at 00:38 in region Mexico on 5G.',
    },
  },
  kpi_sections: [
    { key: 'playback-qoe', title: 'Playback / QoE', status: 'warning', default_expanded: true, rows: [
      { key: 'ttff_ms', display_name: 'Time to first frame', formatted_value: '3.43s', status: 'warning', measurement: 'EVENT' },
      { key: 'rebuffer_ratio', display_name: 'Rebuffer ratio', formatted_value: '1.8%', status: 'warning', measurement: '1 stall · 1.8s' },
      { key: 'rebuffer_count', display_name: 'Rebuffer count', formatted_value: '1', status: 'warning', measurement: 'TOTAL' },
      { key: 'experience_score', display_name: 'Experience score', formatted_value: '71', status: 'warning', measurement: 'SESSION' },
    ] },
    { key: 'qos', title: 'QoS · Streaming', status: 'failed', default_expanded: false, rows: [
      { key: 'segment_latency_p95', display_name: 'Segment latency p95', formatted_value: '1.45s', status: 'failed', measurement: 'p95 · gate' },
      { key: 'manifest_latency', display_name: 'Manifest latency', formatted_value: '210ms', status: 'passed', measurement: 'avg' },
    ] },
    { key: 'device', title: 'Device', status: 'passed', default_expanded: false, rows: [
      { key: 'peak_cpu', display_name: 'Peak CPU', formatted_value: '64%', status: 'passed', measurement: 'peak' },
      { key: 'peak_memory', display_name: 'Peak memory', formatted_value: '643MB', status: 'passed', measurement: 'peak' },
    ] },
  ],
  accordion_sections: [
    {
      key: 'app_health', title: 'App-Health (Stability)', type: 'app_health', status: 'passed', default_expanded: false,
      data: { captured: true, crash_free_rate: 1, crashes: 0, native_crashes: 0, anrs: 0, oom_kills: 0, note: 'ApplicationExitInfo snapshot captured — no crashes, native crashes, ANRs, or OOM kills.' },
    },
    {
      key: 'network-intelligence', title: 'Network Intelligence', type: 'network', status: 'warning',
      data: { summary: 'One CDN segment exceeded its budget at 00:38.', slow_requests: [
        { host: 'cdn.nba.example.com', sanitized_path: '/hls/live/game123/video_1080p_0042.m4s', request_type: 'cdn_segment', status_code: 200, duration_ms: 1450, threshold_ms: 800, impact: 'Rebuffer start at 00:38.' },
      ] },
    },
    {
      key: 'artifacts-evidence', title: 'Artifacts & Evidence', type: 'artifacts', status: 'passed',
      data: { artifacts: [{ type: 'video', name: 'session-replay.mp4', storage: 's3', uri: 's3://streampulse-artifacts/mock/session-replay.mp4' }] },
    },
    {
      key: 'history-regression', title: 'History / Regression', type: 'history', status: 'warning',
      data: { rows: [{ build: '8.2.0-rc4', kpi_key: 'ttff_ms', previous: '2.21s', current: '3.43s', delta_pct: 55.2, status: 'regressed' }] },
    },
  ],
};
