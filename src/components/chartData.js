export const CHART_SERIES = ['reported', 'observed'];

// Invalid/missing counts are not observations of zero. Omit the whole sample.
export function normalizeChartPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.flatMap((point, sourceIndex) => {
    if (!point || typeof point.time !== 'string' || !point.time.trim()
      || !CHART_SERIES.every(series => Number.isSafeInteger(point[series]) && point[series] >= 0)) return [];
    return [{ time: point.time.trim(), reported: point.reported, observed: point.observed, sourceIndex }];
  });
}

export function selectChartRange(points, range) {
  return range === 'recent' ? points.slice(-4) : points.slice();
}

export function toggleChartSeries(visible, series) {
  if (!CHART_SERIES.includes(series)) return visible;
  const other = series === 'observed' ? 'reported' : 'observed';
  return visible[series] && !visible[other] ? visible : { ...visible, [series]: !visible[series] };
}

export function getPointVariance(point) {
  const difference = point.observed - point.reported;
  return {
    difference,
    percent: point.reported === 0 ? null : difference / point.reported * 100,
    description: difference === 0 ? 'Counts match' : `${Math.abs(difference)} ${difference < 0 ? 'fewer' : 'more'} observed`,
  };
}

function niceMaximum(maximum) {
  if (maximum === 0) return 3;
  const rawStep = maximum / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 1.5, 2, 2.5, 5, 10].find(value => value * magnitude >= rawStep) * magnitude;
  return Math.max(1, step) * 3;
}

/** A shared zero baseline and scale keep line/bar modes and series toggles honest. */
export function createChartGeometry(points, width = 640, height = 212) {
  const left = 39;
  const right = Math.max(left + 1, width - 17);
  const top = 14;
  const bottom = height - 30;
  const maximum = niceMaximum(points.reduce((max, point) => Math.max(max, point.reported, point.observed), 0));
  const slotWidth = (right - left) / Math.max(1, points.length);
  const y = value => bottom - value / maximum * (bottom - top);
  const plotted = points.map((point, index) => ({
    ...point,
    x: left + slotWidth * (index + .5),
    reportedY: y(point.reported),
    observedY: y(point.observed),
  }));
  const paths = Object.fromEntries(CHART_SERIES.map(series => {
    // Cubic controls stay between adjacent values: smoothing never invents peaks.
    const line = plotted.map((point, index) => {
      if (!index) return `M ${point.x} ${point[`${series}Y`]}`;
      const previous = plotted[index - 1];
      const middle = (previous.x + point.x) / 2;
      return `C ${middle} ${previous[`${series}Y`]} ${middle} ${point[`${series}Y`]} ${point.x} ${point[`${series}Y`]}`;
    }).join(' ');
    const area = plotted.length ? `${line} L ${plotted.at(-1).x} ${bottom} L ${plotted[0].x} ${bottom} Z` : '';
    return [series, { line, area }];
  }));
  return {
    points: plotted, paths, maximum, left, right, top, bottom, slotWidth,
    ticks: Array.from({ length: 4 }, (_, index) => ({ value: maximum / 3 * index, y: y(maximum / 3 * index) })),
  };
}
