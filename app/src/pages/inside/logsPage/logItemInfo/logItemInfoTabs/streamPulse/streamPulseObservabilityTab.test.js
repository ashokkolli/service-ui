import { render, mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { KpiAccordionSection } from './streamPulseObservabilityTab';
import { createBug } from './streamPulseClient';

// Mock only the owner-routed action calls; keep the rest of the client real so
// fetch/URL helpers behave normally.
jest.mock('./streamPulseClient', () => {
  const actual = jest.requireActual('./streamPulseClient');
  return {
    __esModule: true,
    ...actual,
    createBug: jest.fn(),
    notifyGate: jest.fn(),
    rerunFailed: jest.fn(),
  };
});

// Flush pending microtasks + a macrotask turn inside act() so async setState from
// the action calls settles without a React "not wrapped in act(...)" warning
// (which jestsetup turns into a thrown error).
const flush = async (wrapper) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  wrapper.update();
};

const capturedSection = {
  key: 'app_health',
  title: 'App-Health (Stability)',
  type: 'app_health',
  status: 'failed',
  default_expanded: true,
  data: {
    captured: true,
    crash_free_rate: 0.982,
    crashes: 2,
    native_crashes: 1,
    anrs: 3,
    oom_kills: 0,
    note: 'Captured 6 process exits — 2 crashes, 1 native crash, 3 ANRs.',
  },
};

const notCapturedSection = {
  key: 'app_health',
  title: 'App-Health (Stability)',
  type: 'app_health',
  status: 'info',
  default_expanded: false,
  data: {
    captured: false,
    crash_free_rate: null,
    crashes: null,
    native_crashes: null,
    anrs: null,
    oom_kills: null,
    note: 'Not captured — no on-device ApplicationExitInfo snapshot for this run.',
  },
};

describe('AppHealth accordion section', () => {
  test('captured: renders the crash-free percentage and every fault count', () => {
    const wrapper = render(<KpiAccordionSection section={capturedSection} />);

    // Crash-free headline shows an honest percentage (never rounded up to 100%).
    expect(wrapper.find('.app-health-metric-value').text()).toBe('98.2%');

    // Fault table renders one column per fault, in order.
    const headers = wrapper.find('th');
    expect(headers.length).toBe(4);
    expect(headers.eq(0).text()).toBe('Crashes');
    expect(headers.eq(1).text()).toBe('Native crashes');
    expect(headers.eq(2).text()).toBe('ANRs');
    expect(headers.eq(3).text()).toBe('OOM kills');

    const cells = wrapper.find('td');
    expect(cells.length).toBe(4);
    expect(cells.eq(0).text()).toBe('2');
    expect(cells.eq(1).text()).toBe('1');
    expect(cells.eq(2).text()).toBe('3');
    expect(cells.eq(3).text()).toBe('0');
  });

  test('not captured: renders the honest note and NO green-zero fault cells', () => {
    const wrapper = render(<KpiAccordionSection section={notCapturedSection} />);

    // The section still renders (hasSectionContent === true) so the honest note shows.
    expect(wrapper.text()).toContain('Not captured');
    expect(wrapper.text()).toContain('no on-device ApplicationExitInfo snapshot');

    // HONESTY: not-captured must NEVER show a fault table with zero counts.
    expect(wrapper.find('table').length).toBe(0);
    expect(wrapper.find('td').length).toBe(0);
    expect(wrapper.find('.app-health-metric-value').text()).toBe('Not captured');
  });
});

const rcaSection = {
  key: 'ai-rca',
  title: 'AI RCA & Insights',
  type: 'rca',
  status: 'warning',
  data: {
    category: 'network_cdn_degradation',
    summary: 'Playback QoE regressed on slow CDN responses.',
    jira_ready: {
      summary: 'Investigate CDN/API latency causing playback QoE warnings',
      description: 'StreamPulse correlated TTFF and rebuffer warnings with slow CDN responses.',
    },
  },
};

const findButton = (wrapper, label) =>
  wrapper.find('button').filterWhere((node) => node.text().includes(label));

describe('AI RCA action loop', () => {
  let errSpy;
  beforeEach(() => {
    createBug.mockReset();
    // enzyme's mount adapter calls the deprecated ReactDOM.findDOMNode on React
    // 18.3, which logs a console.error the repo's jestsetup turns into a throw.
    // Swallow ONLY that adapter-deprecation noise; real errors still throw.
    const throwing = console.error;
    errSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      // Test-harness deprecation noise on React 18.3 (enzyme's mount adapter calls
      // findDOMNode; react-dom/test-utils' act is deprecated). Format-string tokens
      // land in later args, so scan them all. Real errors still throw.
      const joined = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      if (joined.includes('findDOMNode') || joined.includes('ReactDOMTestUtils.act')) {
        return undefined;
      }
      return throwing(...args);
    });
  });
  afterEach(() => {
    if (errSpy) errSpy.mockRestore();
  });

  test('Create Jira bug success renders the REAL returned issue_key as a link', async () => {
    createBug.mockResolvedValue({
      ok: true,
      issue_key: 'SCRUM-411',
      url: 'https://jira.example/browse/SCRUM-411',
    });

    const wrapper = mount(
      <KpiAccordionSection section={rcaSection} rpItemId="rp-9" functionalStatus="passed" />,
    );

    await act(async () => {
      findButton(wrapper, 'Create Jira bug').simulate('click');
    });
    await flush(wrapper);

    // The exact jira_ready draft is forwarded to the backend.
    expect(createBug).toHaveBeenCalledWith('rp-9', rcaSection.data.jira_ready);

    // The REAL issue key is rendered as an openable link — never fabricated.
    const link = wrapper.find('a.issue-link');
    expect(link.length).toBe(1);
    expect(link.text()).toBe('SCRUM-411');
    expect(link.prop('href')).toBe('https://jira.example/browse/SCRUM-411');
    expect(link.prop('rel')).toBe('noopener noreferrer');
  });

  test('not-configured response renders the honest reason and NO fabricated key', async () => {
    createBug.mockResolvedValue({ ok: false, result: { reason: 'jira_not_configured' } });

    const wrapper = mount(
      <KpiAccordionSection section={rcaSection} rpItemId="rp-9" functionalStatus="passed" />,
    );

    await act(async () => {
      findButton(wrapper, 'Create Jira bug').simulate('click');
    });
    await flush(wrapper);

    // Honest reason is surfaced verbatim.
    expect(wrapper.text()).toContain('jira_not_configured');
    // No fabricated success: no issue link and no SCRUM-#### key anywhere.
    expect(wrapper.find('a.issue-link').length).toBe(0);
    expect(wrapper.find('code.issue-key').length).toBe(0);
    expect(wrapper.text()).not.toMatch(/SCRUM-\d+/);
  });

  test('Re-run failed button is hidden unless functional status is failed', () => {
    const passed = render(
      <KpiAccordionSection section={rcaSection} rpItemId="rp-9" functionalStatus="passed" />,
    );
    expect(passed.text()).not.toContain('Re-run failed');

    const failed = render(
      <KpiAccordionSection section={rcaSection} rpItemId="rp-9" functionalStatus="failed" />,
    );
    expect(failed.text()).toContain('Re-run failed');
  });

  test('actions are disabled (not silently no-op) for SAMPLE data', () => {
    const wrapper = render(
      <KpiAccordionSection
        section={rcaSection}
        rpItemId="rp-9"
        functionalStatus="failed"
        actionsDisabled
        actionsDisabledReason="Actions are disabled for SAMPLE data — connect the FastBreak API."
      />,
    );

    wrapper.find('button').each((_, el) => {
      expect(wrapper.find(el).attr('disabled')).toBeDefined();
    });
    expect(wrapper.text()).toContain('disabled for SAMPLE data');
  });
});

const artifactSection = (artifact) => ({
  key: 'artifacts-evidence',
  title: 'Artifacts & Evidence',
  type: 'artifacts',
  status: 'passed',
  data: { artifacts: [artifact] },
});

describe('Artifacts & Evidence — clickable evidence', () => {
  test('http(s) replay URI renders an openable <a href> with a replay affordance', () => {
    const wrapper = render(
      <KpiAccordionSection
        section={artifactSection({
          type: 'video',
          name: 'session-replay.mp4',
          storage: 'https',
          uri: 'https://cdn.example/replay/session-replay.mp4',
        })}
      />,
    );

    const link = wrapper.find('a.artifact-link');
    expect(link.length).toBe(1);
    expect(link.attr('href')).toBe('https://cdn.example/replay/session-replay.mp4');
    expect(link.attr('rel')).toBe('noopener noreferrer');
    expect(wrapper.text()).toContain('replay');
  });

  test('s3:// URI renders selectable <code> with a copy affordance, never a dead link', () => {
    const wrapper = render(
      <KpiAccordionSection
        section={artifactSection({
          type: 'video',
          name: 'session-replay.mp4',
          storage: 's3',
          uri: 's3://streampulse-artifacts/mock/session-replay.mp4',
        })}
      />,
    );

    // No <a> — an s3:// scheme is not openable, so it must not look clickable.
    expect(wrapper.find('a').length).toBe(0);
    const code = wrapper.find('code.artifact-code');
    expect(code.length).toBe(1);
    expect(code.text()).toBe('s3://streampulse-artifacts/mock/session-replay.mp4');
    // A copy affordance is offered instead.
    expect(wrapper.find('button.copy-btn').length).toBe(1);
  });
});
