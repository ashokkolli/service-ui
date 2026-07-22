/*
 * KpiTrendChart — ACROSS-RUN trend for ONE KPI. Sibling of `sparkline.jsx`, never a
 * replacement for it: Sparkline is a WITHIN-session series bound to the replay master
 * clock, and it joins every point with an `L` command (sparkline.jsx:57-59), so a run
 * that measured nothing would be silently bridged. This chart is built the other way
 * round — a gap is a first-class point that can never be drawn as a value.
 *
 * HONESTY RULES, enforced structurally (not by convention):
 *   1. A run that did not measure this KPI arrives as `{ value: null }` and renders as a
 *      HATCHED SLOT + em-dash tick + a BREAK in the line. Nothing is interpolated,
 *      nothing is carried forward, and 0 is never substituted. Note that `null` coerces
 *      to 0 through Math.min/Math.max and through arithmetic — it does NOT produce NaN —
 *      so every consumer of a value goes through `isMeasured()` first. That guard is the
 *      whole defence; removing it puts gap runs on the baseline as if they measured 0.
 *   2. Fewer than 3 measured points => NO LINE IS DRAWN. Two points always render a
 *      confident straight slope, which asserts a direction two points cannot support.
 *      The points are still shown; the copy says why there is no line.
 *   3. The x-axis is CATEGORICAL (run order, oldest -> newest). Runs are minutes apart or
 *      hours apart; a time axis would smear a soak into a spike. The caption always
 *      states the real oldest/newest timestamps so the ordinal axis cannot mislead.
 *   4. Devices are never blended. One line per device, distinguished by dash pattern AND
 *      marker shape AND an explicit legend — never by colour alone (WCAG 1.4.1).
 *   5. The budget is READ-ONLY CONTEXT: a neutral dashed rule, never red, never a datum.
 *      When the budget is orders of magnitude off the measured range it is NOT forced on
 *      to the canvas (that would flatten the real series into a dead line); it is
 *      declared off-scale in words instead.
 *   6. A run whose TEST failed is marked. "The app got 6x slower" and "the test fell over
 *      and this is what a dying run measured" are different stories and must not look
 *      identical. Only rendered when the payload actually carries run status.
 *
 * Presentational only. Nothing here changes a verdict or a budget.
 */
import PropTypes from 'prop-types';
import classNames from 'classnames/bind';
import { kpiDisplayState, text } from './streamPulseUtils';
import styles from './streamPulseObservabilityTab.scss';

const cx = classNames.bind(styles);

const W = 640;
const H = 168;
const PAD = { l: 56, r: 20, t: 16, b: 34 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

// A trend line is an assertion about direction. Two points cannot support one.
export const MIN_POINTS_FOR_LINE = 3;
// How far outside the measured range a budget may sit before forcing it on to the
// canvas would compress the real series into an unreadable flat line.
const BUDGET_OFFSCALE_FACTOR = 4;
const MAX_TICK_LABELS = 12;

// Colour is never the only carrier: each device also gets a dash pattern and a marker
// shape, and the legend spells both out in words.
const DEVICE_DASH = ['', '6 3', '2 3', '9 3 2 3'];
const DEVICE_DASH_WORD = ['solid', 'dashed', 'dotted', 'dash-dot'];
const DEVICE_SHAPE = ['circle', 'square', 'diamond'];
const DEVICE_SHAPE_WORD = ['round', 'square', 'diamond'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/*
 * THE load-bearing guard. `value: null` is the wire form of "this run did not measure
 * this KPI". Every arithmetic path (Math.min, Math.max, subtraction, the y() scale)
 * coerces null to 0 rather than to NaN, so an unguarded null does not blow up — it
 * quietly renders as a real measurement of zero on the baseline. Nothing downstream may
 * touch `point.value` without passing through here first.
 */
export const isMeasured = (p) =>
  !!p &&
  p.value !== null &&
  p.value !== undefined &&
  p.value !== '' &&
  Number.isFinite(Number(p.value));

const num = (v) => Number(v);

export const fmtValue = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return '—';
  }
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return String(Math.round(n));
  }
  if (abs >= 10) {
    return n.toFixed(1).replace(/\.0$/, '');
  }
  return String(Math.round(n * 1000) / 1000);
};

export const fmtRunTime = (iso) => {
  const raw = text(iso);
  if (!raw) {
    return '';
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return raw;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
};

const runFailed = (run = {}) =>
  ['failed', 'fail', 'error', 'crashed', 'interrupted'].includes(
    text(run.functional_status || run.status).toLowerCase(),
  );

const pointState = (p) => kpiDisplayState({ display_state: p.state, status: p.state, value: p.value });

// One entry per device, in first-appearance order. Points keep their GLOBAL index `i`
// so every series sits on the same categorical x-axis.
export const buildDeviceSeries = (runs, points) => {
  const order = [];
  const byDevice = {};
  points.forEach((p, i) => {
    const device = text((runs[i] || {}).device) || 'unknown device';
    if (!byDevice[device]) {
      byDevice[device] = [];
      order.push(device);
    }
    byDevice[device].push({ ...p, i });
  });
  return order.map((device, idx) => ({
    device,
    pts: byDevice[device],
    measured: byDevice[device].filter(isMeasured).length,
    dash: DEVICE_DASH[idx % DEVICE_DASH.length],
    dashWord: DEVICE_DASH_WORD[idx % DEVICE_DASH_WORD.length],
    shape: DEVICE_SHAPE[idx % DEVICE_SHAPE.length],
    shapeWord: DEVICE_SHAPE_WORD[idx % DEVICE_SHAPE_WORD.length],
  }));
};

/*
 * Segments join point k to point k+1 of the SAME device series, and ONLY when BOTH
 * endpoints are measured. This — not the array shape — is what makes a gap visible: the
 * points array is dense (len(points) === len(runs)), so an index-adjacency test alone
 * would happily draw straight through a null.
 */
export const buildSegments = (series) => {
  if (series.measured < MIN_POINTS_FOR_LINE) {
    return [];
  }
  const out = [];
  for (let k = 0; k < series.pts.length - 1; k += 1) {
    const a = series.pts[k];
    const b = series.pts[k + 1];
    if (isMeasured(a) && isMeasured(b)) {
      out.push([a, b]);
    }
  }
  return out;
};

const Marker = ({ shape, x, y, className }) => {
  if (shape === 'square') {
    return <rect className={className} x={x - 3} y={y - 3} width="6" height="6" />;
  }
  if (shape === 'diamond') {
    return (
      <path className={className} d={`M${x},${y - 4} L${x + 4},${y} L${x},${y + 4} L${x - 4},${y} Z`} />
    );
  }
  return <circle className={className} cx={x} cy={y} r="3.2" />;
};
Marker.propTypes = {
  shape: PropTypes.string,
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  className: PropTypes.string,
};
Marker.defaultProps = { shape: 'circle', className: '' };

export const KpiTrendChart = ({ kpi, runs, points, currentSessionId }) => {
  const unit = text(kpi.unit);
  const name = text(kpi.display_name) || text(kpi.kpi_key);

  // Payload invariant: one point per run, gaps carried as an explicit null. If the
  // backend ever ships a sparse array we must NOT chart it — a shorter points array
  // silently shifts every run's value on to a different run.
  if (!runs.length || points.length !== runs.length) {
    return (
      <p className={cx('sp-trend-note')}>
        Not charted: this KPI reports {points.length} point(s) for {runs.length} run(s). A trend can
        only be drawn when every run has a point (a run that measured nothing must arrive as an
        explicit gap), so nothing is shown rather than a series that would attribute values to the
        wrong runs.
      </p>
    );
  }

  const n = runs.length;
  const measuredPts = points.filter(isMeasured);
  const measuredCount = measuredPts.length;
  const gapCount = n - measuredCount;

  if (!measuredCount) {
    return (
      <p className={cx('sp-trend-note')}>
        {name} has not been measured on any of the last {n} runs. Nothing was captured, so nothing
        is plotted — no axes are drawn for a series that does not exist.
      </p>
    );
  }

  const values = measuredPts.map((p) => num(p.value));
  const vMinData = Math.min(...values);
  const vMaxData = Math.max(...values);
  const dataSpan = vMaxData - vMinData || Math.abs(vMaxData) * 0.25 || 1;

  const budget = Number.isFinite(Number(kpi.budget)) && kpi.budget !== null ? Number(kpi.budget) : null;
  // Forcing an order-of-magnitude-distant budget on to the canvas squashes the real
  // series flat: a 114 -> 174 ms regression against a 3000 ms budget becomes an
  // invisible 2%-tall wobble. Declare it off-scale in words instead of erasing the data.
  const budgetOffScale =
    budget !== null &&
    (budget > vMaxData + BUDGET_OFFSCALE_FACTOR * dataSpan ||
      budget < vMinData - BUDGET_OFFSCALE_FACTOR * dataSpan);
  const budgetOnCanvas = budget !== null && !budgetOffScale;

  const lo = budgetOnCanvas ? Math.min(vMinData, budget) : vMinData;
  const hi = budgetOnCanvas ? Math.max(vMaxData, budget) : vMaxData;
  const pad = (hi - lo || Math.abs(hi) * 0.25 || 1) * 0.08;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (i) => (n === 1 ? PAD.l + PLOT_W / 2 : PAD.l + (i / (n - 1)) * PLOT_W);
  const y = (v) => PAD.t + PLOT_H - ((num(v) - yMin) / (yMax - yMin || 1)) * PLOT_H;
  const slot = n > 1 ? PLOT_W / (n - 1) : PLOT_W;
  const gapW = Math.max(6, Math.min(slot * 0.7, 44));

  const deviceSeries = buildDeviceSeries(runs, points);
  const multiDevice = deviceSeries.length > 1;
  const anyLine = deviceSeries.some((s) => s.measured >= MIN_POINTS_FOR_LINE);
  const thinDevices = deviceSeries.filter((s) => s.measured > 0 && s.measured < MIN_POINTS_FOR_LINE);
  const failedRuns = runs.filter(runFailed).length;

  const gapId = `sp-trend-gap-${text(kpi.kpi_key).replace(/[^a-z0-9]+/gi, '-')}`;
  const currentIdx = runs.findIndex(
    (r) => currentSessionId && String(r.session_id) === String(currentSessionId),
  );

  const oldest = fmtRunTime(runs[0].started_at);
  const newest = fmtRunTime(runs[n - 1].started_at);

  const summary =
    `${name} across ${n} runs, oldest ${oldest} to newest ${newest}. ` +
    `${measuredCount} measured, ${gapCount} not measured. ` +
    (budget === null ? 'No budget defined.' : `Budget ${fmtValue(budget)}${unit ? ` ${unit}` : ''}.`);

  return (
    <div className={cx('sp-trend')}>
      <svg
        className={cx('sp-trend-svg')}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        role="img"
        aria-label={summary}
      >
        <defs>
          {/* Same -45deg hatch the no_data KPI tile wears (scss `.kpi-tile.state-no_data`),
              so "not measured" looks the same everywhere on this tab. */}
          <pattern id={gapId} width="6" height="6" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" className={cx('sp-trend-gap-bg')} />
            <line x1="0" y1="0" x2="0" y2="6" className={cx('sp-trend-gap-hatch')} />
          </pattern>
        </defs>

        {/* y guides: only the real data extremes are labelled — no invented gridlines */}
        <line className={cx('sp-trend-axis')} x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + PLOT_H} />
        <line
          className={cx('sp-trend-axis')}
          x1={PAD.l}
          y1={PAD.t + PLOT_H}
          x2={PAD.l + PLOT_W}
          y2={PAD.t + PLOT_H}
        />
        <text className={cx('sp-trend-ylabel')} x={PAD.l - 8} y={y(vMaxData) + 3} textAnchor="end">
          {fmtValue(vMaxData)}
        </text>
        {vMinData !== vMaxData && (
          <text className={cx('sp-trend-ylabel')} x={PAD.l - 8} y={y(vMinData) + 3} textAnchor="end">
            {fmtValue(vMinData)}
          </text>
        )}

        {/* gaps first, so a hatched slot sits UNDER the markers of neighbouring runs */}
        {points.map((p, i) =>
          isMeasured(p) ? null : (
            <rect
              key={`gap-${runs[i].session_id || i}`}
              className={cx('sp-trend-gap')}
              x={x(i) - gapW / 2}
              y={PAD.t}
              width={gapW}
              height={PLOT_H}
              fill={`url(#${gapId})`}
            />
          ),
        )}

        {budgetOnCanvas && (
          <g>
            <line
              className={cx('sp-trend-budget')}
              x1={PAD.l}
              y1={y(budget)}
              x2={PAD.l + PLOT_W}
              y2={y(budget)}
            />
            <text className={cx('sp-trend-budget-label')} x={PAD.l + PLOT_W} y={y(budget) - 4} textAnchor="end">
              budget {fmtValue(budget)}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        )}

        {currentIdx >= 0 && (
          <g>
            <line
              className={cx('sp-trend-current')}
              x1={x(currentIdx)}
              y1={PAD.t - 4}
              x2={x(currentIdx)}
              y2={PAD.t + PLOT_H}
            />
            <text className={cx('sp-trend-current-label')} x={x(currentIdx)} y={PAD.t - 7} textAnchor="middle">
              this run
            </text>
          </g>
        )}

        {deviceSeries.map((s) =>
          buildSegments(s).map(([a, b]) => (
            <line
              key={`seg-${s.device}-${a.i}-${b.i}`}
              className={cx('sp-trend-line')}
              strokeDasharray={s.dash || undefined}
              x1={x(a.i)}
              y1={y(a.value)}
              x2={x(b.i)}
              y2={y(b.value)}
            />
          )),
        )}

        {deviceSeries.map((s) =>
          s.pts.filter(isMeasured).map((p) => {
            const st = pointState(p).state;
            return (
              <g key={`pt-${s.device}-${p.i}`}>
                <Marker
                  shape={s.shape}
                  x={x(p.i)}
                  y={y(p.value)}
                  className={cx('sp-trend-dot', `state-${st}`)}
                />
                {st === 'breached' && (
                  <text className={cx('sp-trend-breach-glyph')} x={x(p.i)} y={y(p.value) - 7} textAnchor="middle">
                    ▲
                  </text>
                )}
              </g>
            );
          }),
        )}

        {/* x ticks: ordinal for a measured run, em-dash for a gap (cue 3 of 3), and a
            cross when the RUN ITSELF failed — a dying run's number is not a trend. */}
        {points.map((p, i) => {
          const showTick = n <= MAX_TICK_LABELS || i === 0 || i === n - 1 || i === currentIdx;
          if (!showTick) {
            return null;
          }
          return (
            <text
              key={`tick-${runs[i].session_id || i}`}
              className={cx('sp-trend-tick', { gap: !isMeasured(p), failed: runFailed(runs[i]) })}
              x={x(i)}
              y={PAD.t + PLOT_H + 14}
              textAnchor="middle"
            >
              {isMeasured(p) ? i + 1 : '—'}
              {runFailed(runs[i]) ? ' ✕' : ''}
            </text>
          );
        })}
        <text className={cx('sp-trend-xlabel')} x={PAD.l + PLOT_W / 2} y={H - 4} textAnchor="middle">
          run (oldest → newest)
        </text>
      </svg>

      {/* The accessible equivalent. `role="img"` prunes the SVG subtree, so the readable
          form is this table — the SVG carries NO focusable descendants (a focusable node
          inside a pruned subtree is focusable-but-unexposed). */}
      <table className={cx('sp-trend-a11y')}>
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">When</th>
            <th scope="col">Device</th>
            <th scope="col">Value</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const st = pointState(p);
            return (
              <tr key={`row-${runs[i].session_id || i}`}>
                <th scope="row">
                  {i + 1}
                  {runFailed(runs[i]) ? ' (test run failed)' : ''}
                </th>
                <td>{fmtRunTime(runs[i].started_at)}</td>
                <td>{text(runs[i].device) || 'unknown device'}</td>
                <td>{isMeasured(p) ? `${fmtValue(p.value)}${unit ? ` ${unit}` : ''}` : 'not measured'}</td>
                <td>
                  {st.label}
                  {!isMeasured(p) && p.no_data_reason ? ` — ${text(p.no_data_reason)}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={cx('sp-trend-legend')}>
        {multiDevice &&
          deviceSeries.map((s) => (
            <span className={cx('sp-trend-legend-item')} key={`lg-${s.device}`}>
              {s.device} — {s.dashWord} line, {s.shapeWord} markers ({s.measured}/{s.pts.length} measured)
            </span>
          ))}
        {gapCount > 0 && (
          <span className={cx('sp-trend-legend-item')}>hatched slot + — = run did not measure this KPI</span>
        )}
        {failedRuns > 0 && (
          <span className={cx('sp-trend-legend-item')}>✕ = the test run itself failed</span>
        )}
      </div>

      <div className={cx('sp-trend-readout')}>
        {/* Every aggregate states its denominator. A median over 5 of 6 runs is not a
            median over 6, and saying so is the difference between a fact and a spin. */}
        <span>
          {n} runs · {measuredCount} measured
          {gapCount > 0 ? ` · ${gapCount} not measured` : ''} · oldest {oldest} → newest {newest}
        </span>
      </div>

      {/* State B — too little history to assert a direction. */}
      {measuredCount < MIN_POINTS_FOR_LINE && (
        <p className={cx('sp-trend-note')}>
          {measuredCount === 1
            ? 'Only 1 run has measured this KPI — not enough history for a trend. A second run will make a value comparable; a third will make a direction readable.'
            : '2 measured runs — both values are shown, but two points do not establish a trend. No line is drawn and no direction is asserted.'}
        </p>
      )}
      {/* Per-device disclosure. A device with 1-2 measured runs gets dots and no line —
          and says so, rather than leaving the reader to wonder why its points are loose.
          Values from different devices are NEVER joined: different hardware is not one
          series, and blending a Pixel with a Samsung invents a trend neither has. */}
      {measuredCount >= MIN_POINTS_FOR_LINE && multiDevice && thinDevices.length > 0 && (
        <p className={cx('sp-trend-note')}>
          No line is drawn for{' '}
          {thinDevices.map((s) => `${s.device} (${s.measured} measured run(s))`).join(', ')} —{' '}
          {MIN_POINTS_FOR_LINE} measured runs on the SAME device are the minimum for a direction.
          {anyLine ? '' : ' No device in this window clears that bar, so the chart shows points only.'}
        </p>
      )}

      {/* State C — gaps. */}
      {gapCount > 0 && (
        <div className={cx('sp-trend-note')}>
          <p className={cx('sp-trend-note-p')}>
            {gapCount} of {n} runs did not measure this KPI. The gap is left empty — no value has
            been carried forward, interpolated, or plotted as zero.
          </p>
          <ul className={cx('sp-trend-gap-list')}>
            {points.map((p, i) =>
              isMeasured(p) ? null : (
                <li key={`gapnote-${runs[i].session_id || i}`}>
                  Run {i + 1} ({fmtRunTime(runs[i].started_at)}
                  {text(runs[i].device) ? `, ${text(runs[i].device)}` : ''}):{' '}
                  {text(p.no_data_reason) || 'KPI not emitted on this run.'}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {/* State D — measured, but nothing judged it. */}
      {budget === null && (
        <p className={cx('sp-trend-note')}>
          No budget defined — this KPI is recorded for observation, not judged. The chart shows
          movement only; nothing here is a pass or a fail.
        </p>
      )}

      {/* State G — the budget exists but is nowhere near the data. */}
      {budgetOffScale && (
        <p className={cx('sp-trend-note')}>
          Budget {fmtValue(budget)}
          {unit ? ` ${unit}` : ''} is {budget > vMaxData ? 'far above' : 'far below'} every measured
          value here, so it is not drawn — putting it on the axis would flatten the real series into
          a straight line and hide the movement this chart exists to show. The budget is unchanged.
        </p>
      )}

      {/* State F — a failed run's number is not a performance story. */}
      {failedRuns > 0 && (
        <p className={cx('sp-trend-note')}>
          {failedRuns} run(s) in this window failed functionally (marked ✕). A value measured by a
          run that fell over is not evidence of a regression — read those points against the run,
          not against the build.
        </p>
      )}
    </div>
  );
};

KpiTrendChart.propTypes = {
  kpi: PropTypes.shape({
    kpi_key: PropTypes.string,
    display_name: PropTypes.string,
    unit: PropTypes.string,
    budget: PropTypes.number,
  }).isRequired,
  runs: PropTypes.array,
  points: PropTypes.array,
  currentSessionId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};
KpiTrendChart.defaultProps = { runs: [], points: [], currentSessionId: null };
