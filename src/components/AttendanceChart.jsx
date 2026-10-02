import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChartColumn, ChartNoAxesCombined, Check, Minus, MoveHorizontal } from 'lucide-react';
import { CHART_SERIES, createChartGeometry, getPointVariance, normalizeChartPoints, selectChartRange, toggleChartSeries } from './chartData.js';
import './attendance-chart.css';

const countFormat = new Intl.NumberFormat('en-IN');
const axisFormat = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const count = value => countFormat.format(value);
const signed = value => `${value < 0 ? '−' : value > 0 ? '+' : ''}${count(Math.abs(value))}`;
const labels = { reported: 'Reported', observed: 'Observed' };

/** points: [{ time, reported, observed }]; onViewReport: optional navigation callback. */
export default function AttendanceChart({ points = [], onViewReport }) {
  const id = useId().replace(/:/g, '');
  const plotRef = useRef(null);
  const pointRefs = useRef([]);
  const [width, setWidth] = useState(640);
  const [mode, setMode] = useState('line');
  const [range, setRange] = useState('all');
  const [visible, setVisible] = useState({ reported: true, observed: true });
  const [selectedIndex, setSelectedIndex] = useState(null);
  const validPoints = useMemo(() => normalizeChartPoints(points), [points]);
  const shownPoints = useMemo(() => selectChartRange(validPoints, range), [validPoints, range]);
  const geometry = useMemo(() => createChartGeometry(shownPoints, width), [shownPoints, width]);
  const selected = geometry.points.find(point => point.sourceIndex === selectedIndex) || geometry.points.at(-1);
  const variance = selected ? getPointVariance(selected) : null;
  const omitted = Array.isArray(points) ? points.length - validPoints.length : 0;
  const animationKey = `${mode}-${range}-${Number(visible.reported)}${Number(visible.observed)}`;
  const barWidth = Math.min(18, geometry.slotWidth * .26);
  const labelStep = Math.max(1, Math.ceil(geometry.points.length / Math.max(2, Math.floor((geometry.right - geometry.left) / 52))));

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.max(1, node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function chooseRange(nextRange) {
    setRange(nextRange);
    setSelectedIndex(null);
  }

  function handlePointKey(event, index) {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = Math.min(shownPoints.length - 1, index + 1);
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = shownPoints.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      pointRefs.current[nextIndex]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedIndex(shownPoints[index].sourceIndex);
    }
  }

  return (
    <section className="panel attendance-chart" aria-labelledby={`${id}-heading`}>
      <header className="ac-header">
        <div>
          <div className="ac-eyebrow"><span /> THE DAILY PICTURE</div>
          <h2 id={`${id}-heading`}>Attendance, in focus.</h2>
          <p>Centre submissions meet observed presence.</p>
        </div>
        <span className="ac-demo">Synthetic demo</span>
      </header>

      <div className="ac-toolbar">
        <div className="ac-segmented" role="group" aria-label="Attendance time range">
          <button type="button" aria-pressed={range === 'all'} onClick={() => chooseRange('all')}>All points</button>
          <button type="button" aria-pressed={range === 'recent'} onClick={() => chooseRange('recent')}>Last 4 points</button>
        </div>
        <div className="ac-segmented ac-mode" role="group" aria-label="Chart display">
          <button type="button" aria-pressed={mode === 'line'} onClick={() => setMode('line')}><ChartNoAxesCombined size={14} aria-hidden="true" /> Line</button>
          <button type="button" aria-pressed={mode === 'bar'} onClick={() => setMode('bar')}><ChartColumn size={14} aria-hidden="true" /> Bars</button>
        </div>
      </div>

      <div className="ac-legend" role="group" aria-label="Visible attendance series">
        {CHART_SERIES.map(series => {
          const onlyVisible = visible[series] && CHART_SERIES.every(other => other === series || !visible[other]);
          return <button key={series} type="button" className={`ac-series-toggle ac-${series}`} aria-pressed={visible[series]}
            aria-disabled={onlyVisible} title={onlyVisible ? 'Keep at least one series visible' : `Toggle ${labels[series].toLowerCase()} series`}
            onClick={() => setVisible(current => toggleChartSeries(current, series))}>
            <span className="ac-series-swatch" aria-hidden="true">{visible[series] ? <Check size={10} strokeWidth={3} /> : <Minus size={10} />}</span>
            {labels[series]}
          </button>;
        })}
        <span className="ac-axis-unit">Learners</span>
      </div>

      <div className="ac-plot" ref={plotRef}>
        {selected ? <svg className="ac-svg" viewBox={`0 0 ${width} 212`} role="group" aria-labelledby={`${id}-chart-title`} aria-describedby={`${id}-hint`}>
          <title id={`${id}-chart-title`}>{mode === 'line' ? 'Line' : 'Bar'} chart of synthetic attendance</title>
          <defs>
            <linearGradient id={`${id}-observed-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4057dd" stopOpacity=".24" />
              <stop offset="100%" stopColor="#4057dd" stopOpacity=".015" />
            </linearGradient>
            <linearGradient id={`${id}-reported-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#8b94b7" stopOpacity=".14" />
              <stop offset="100%" stopColor="#8b94b7" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-bar-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4057dd" />
              <stop offset="100%" stopColor="#697be9" />
            </linearGradient>
          </defs>
          <g className="ac-grid" aria-hidden="true">
            {geometry.ticks.map(tick => <g key={tick.value}>
              <line x1={geometry.left} x2={geometry.right} y1={tick.y} y2={tick.y} />
              <text x={geometry.left - 9} y={tick.y + 3} textAnchor="end">{axisFormat.format(tick.value)}</text>
            </g>)}
          </g>
          <rect className="ac-selected-band" aria-hidden="true" x={selected.x - geometry.slotWidth / 2 + 1} y={geometry.top} width={Math.max(1, geometry.slotWidth - 2)} height={geometry.bottom - geometry.top} rx="4" />
          <g key={animationKey} className={`ac-drawing ac-drawing-${mode}`} aria-hidden="true">
            {CHART_SERIES.filter(series => visible[series]).map(series => mode === 'line' ? <g key={series} data-series={series}>
              <path className="ac-area" d={geometry.paths[series].area} fill={`url(#${id}-${series}-fill)`} />
              <path className={`ac-line ac-line-${series}`} d={geometry.paths[series].line} pathLength="1" />
            </g> : <g key={series} data-series={series}>
              {geometry.points.map((point, index) => <rect key={point.sourceIndex} className={`ac-bar ac-bar-${series}`}
                x={point.x + (visible.reported && visible.observed ? (series === 'reported' ? -barWidth - 1.5 : 1.5) : -barWidth / 2)}
                y={point[`${series}Y`]} width={barWidth} height={geometry.bottom - point[`${series}Y`]}
                rx="2" fill={series === 'observed' ? `url(#${id}-bar-fill)` : '#a2aac5'}
                style={{ '--ac-delay': `${index * 35}ms` }} />)}
            </g>)}
          </g>
          <line className="ac-crosshair" aria-hidden="true" x1={selected.x} x2={selected.x} y1={geometry.top} y2={geometry.bottom} />
          {geometry.points.map((point, index) => {
            const active = point.sourceIndex === selected.sourceIndex;
            const gap = getPointVariance(point);
            const lastIndex = geometry.points.length - 1;
            const showLabel = index === 0 || index === lastIndex || (index % labelStep === 0 && lastIndex - index >= labelStep);
            return <g key={point.sourceIndex} className={`ac-point ${active ? 'ac-point-active' : ''}`} role="button" tabIndex="0"
              aria-label={`${point.time}: reported ${count(point.reported)}, observed ${count(point.observed)}; ${gap.description.toLowerCase()}`}
              aria-pressed={active} aria-controls={`${id}-details`} ref={node => { pointRefs.current[index] = node; }}
              onPointerEnter={() => setSelectedIndex(point.sourceIndex)} onFocus={() => setSelectedIndex(point.sourceIndex)}
              onClick={() => setSelectedIndex(point.sourceIndex)} onKeyDown={event => handlePointKey(event, index)}>
              <rect className="ac-hit-area" x={point.x - geometry.slotWidth / 2 + 1} y={geometry.top - 4}
                width={Math.max(1, geometry.slotWidth - 2)} height={geometry.bottom - geometry.top + 26} rx="4" />
              {mode === 'line' && CHART_SERIES.filter(series => visible[series]).map(series => <circle key={series}
                className={`ac-marker ac-marker-${series}`} cx={point.x} cy={point[`${series}Y`]} r={active ? 5 : 3.2} aria-hidden="true" />)}
              {showLabel && <text className="ac-time-label" x={point.x} y={geometry.bottom + 21} textAnchor="middle" aria-hidden="true">{point.time}</text>}
            </g>;
          })}
        </svg> : <div className="ac-empty"><ChartNoAxesCombined size={28} aria-hidden="true" /><strong>No attendance samples yet</strong><span>Valid reported and observed counts will appear here.</span></div>}
      </div>

      {selected && <div id={`${id}-details`} className="ac-details" role="status" aria-live="polite" aria-atomic="true">
        <div className="ac-detail-heading"><span className="ac-selected-time">{selected.time}</span><span>Selected sample</span><span className="ac-detail-context">{variance.description}</span></div>
        <dl>
          <div className="ac-detail-observed"><dt>Observed</dt><dd>{count(selected.observed)}</dd></div>
          <div><dt>Reported</dt><dd>{count(selected.reported)}</dd></div>
          <div className="ac-detail-variance"><dt>Variance <span>(obs. − rep.)</span></dt><dd>{signed(variance.difference)}<small>{variance.percent === null ? 'No reported baseline' : `${variance.percent < 0 ? '−' : variance.percent > 0 ? '+' : ''}${Math.abs(variance.percent).toFixed(1)}%`}</small></dd></div>
        </dl>
      </div>}

      <footer className="ac-footer">
        <div>
          <p id={`${id}-hint`}><MoveHorizontal size={12} aria-hidden="true" /> Hover, tap, or focus a point. Use ← → to explore.</p>
          <span>{selected ? `${shownPoints[0].time}–${shownPoints.at(-1).time} · ${shownPoints.length} samples · ` : ''}Synthetic data, not live statistics.</span>
          {omitted > 0 && <span className="ac-omitted">{omitted} invalid sample{omitted === 1 ? '' : 's'} not plotted.</span>}
        </div>
        {typeof onViewReport === 'function' && <button type="button" className="ac-report" onClick={onViewReport}>View report <ArrowRight size={14} aria-hidden="true" /></button>}
      </footer>
    </section>
  );
}
