/*
 * Sparkline — a small inline-SVG time-series with an optional shaded stall band and a
 * scrubber PLAYHEAD (a vertical accent line + a dot that rides the real curve at the
 * scrubbed instant, matching the FASTBREAK replay design). Pure presentational; draws
 * ONLY the real series it is given — an empty/near-empty series renders an honest "—",
 * never a fabricated curve or a value the capture didn't produce.
 */
import PropTypes from 'prop-types';

const W = 240;
const H = 34;

// Step-hold sample: the value in effect at time `tMs` is the last real sample at or
// before it. Returns null when there is nothing to sample (kept honest by the caller).
const sampleAt = (series, tMs) => {
  if (!series || !series.length) {
    return null;
  }
  let v = series[0].v;
  for (let i = 0; i < series.length; i += 1) {
    if (series[i].t <= tMs) {
      v = series[i].v;
    } else {
      break;
    }
  }
  return v;
};

export const Sparkline = ({ series, stall, duration, scrubT }) => {
  if (!series || series.length < 2) {
    return <span className="sp-spark-empty">—</span>;
  }
  const xs = series.map((p) => p.t);
  const ys = series.map((p) => p.v);
  const t0 = Math.min(...xs);
  const t1 = Math.max(...xs) || t0 + 1;
  const vMin = Math.min(...ys);
  const vMax = Math.max(...ys);
  const span = t1 - t0 || 1;
  const vSpan = vMax - vMin || 1;
  const x = (t) => ((t - t0) / span) * (W - 2) + 1;
  const y = (v) => H - 3 - ((v - vMin) / vSpan) * (H - 6);

  const d = series
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const area = `${d} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`;

  const dur = duration || t1;
  const bandX = stall ? (Math.max(0, stall.start_ms - t0) / span) * (W - 2) + 1 : null;
  const bandW = stall ? Math.max(2, ((stall.end_ms - stall.start_ms) / span) * (W - 2)) : 0;

  // Shared playhead: same scrubbed instant across every plane. The dot rides the REAL
  // curve at that instant (step-hold), so the moving read-out is never interpolated
  // into a value the capture did not record.
  const hasScrub = typeof scrubT === 'number';
  const scrubClamped = hasScrub ? Math.max(t0, Math.min(dur, scrubT)) : null;
  const scrubX = hasScrub ? ((scrubClamped - t0) / span) * (W - 2) + 1 : null;
  const scrubV = hasScrub ? sampleAt(series, scrubClamped) : null;
  const scrubY = scrubV === null ? null : y(scrubV);

  return (
    <svg
      className="sp-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
    >
      {bandX !== null && <rect className="sp-spark-band" x={bandX} y="0" width={bandW} height={H} />}
      <path className="sp-spark-area" d={area} />
      <path className="sp-spark-line" d={d} />
      {scrubX !== null && (
        <line className="sp-spark-scrub" x1={scrubX} y1="0" x2={scrubX} y2={H} />
      )}
      {scrubX !== null && scrubY !== null && (
        <circle className="sp-spark-dot" cx={scrubX} cy={scrubY} r="2.6" />
      )}
    </svg>
  );
};

Sparkline.propTypes = {
  series: PropTypes.arrayOf(PropTypes.shape({ t: PropTypes.number, v: PropTypes.number })),
  stall: PropTypes.shape({ start_ms: PropTypes.number, end_ms: PropTypes.number }),
  duration: PropTypes.number,
  scrubT: PropTypes.number,
};
Sparkline.defaultProps = { series: [], stall: null, duration: 0, scrubT: null };
