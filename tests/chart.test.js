import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTrend } from '../src/data.js';
import { createChartGeometry, getPointVariance, normalizeChartPoints, selectChartRange, toggleChartSeries } from '../src/components/chartData.js';

const points = normalizeChartPoints(dailyTrend);

test('chart preserves every real fixture value and the source order without modifying input', () => {
  const original = structuredClone(dailyTrend);
  assert.equal(points.length, 8);
  assert.deepEqual(points.map(({ sourceIndex, ...point }) => point), dailyTrend);
  assert.deepEqual(points.map(point => point.sourceIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
  selectChartRange(points, 'recent');
  createChartGeometry(points);
  assert.deepEqual(dailyTrend, original);
});

test('missing, negative, non-integer, and non-finite counts are not fabricated as zero', () => {
  assert.deepEqual(normalizeChartPoints(null), []);
  assert.deepEqual(normalizeChartPoints({}), []);
  const valid = { time: ' 09:00 ', reported: 0, observed: 0 };
  const result = normalizeChartPoints([
    null, valid, { ...valid, time: '' }, { ...valid, reported: null },
    { ...valid, observed: -1 }, { ...valid, reported: Infinity },
    { ...valid, reported: '12' }, { ...valid, observed: NaN }, { ...valid, observed: 2.5 },
  ]);
  assert.deepEqual(result, [{ time: '09:00', reported: 0, observed: 0, sourceIndex: 1 }]);
});

test('last-four range uses the final four supplied samples, including short/empty datasets', () => {
  assert.deepEqual(selectChartRange(points, 'recent').map(point => point.time), ['13:00', '14:00', '15:00', '16:00']);
  assert.deepEqual(selectChartRange(points, 'all'), points);
  assert.notEqual(selectChartRange(points, 'all'), points);
  assert.deepEqual(selectChartRange(points.slice(0, 2), 'recent'), points.slice(0, 2));
  assert.deepEqual(selectChartRange([], 'recent'), []);
});

test('visibility toggles never permit hiding both series, regardless of toggle order', () => {
  for (const first of ['reported', 'observed']) {
    const other = first === 'reported' ? 'observed' : 'reported';
    const oneVisible = toggleChartSeries({ reported: true, observed: true }, first);
    assert.equal(oneVisible[first], false);
    assert.equal(oneVisible[other], true);
    assert.deepEqual(toggleChartSeries(oneVisible, other), oneVisible);
    assert.deepEqual(toggleChartSeries(oneVisible, first), { reported: true, observed: true });
    assert.deepEqual(toggleChartSeries(oneVisible, 'invalid'), oneVisible);
  }
});

test('variance is exact observed minus reported, with an explicit zero-denominator boundary', () => {
  assert.deepEqual(getPointVariance(points[0]), { difference: -58, percent: -58 / 368 * 100, description: '58 fewer observed' });
  assert.deepEqual(getPointVariance({ observed: 15, reported: 10 }), { difference: 5, percent: 50, description: '5 more observed' });
  assert.deepEqual(getPointVariance({ observed: 0, reported: 0 }), { difference: 0, percent: null, description: 'Counts match' });
  assert.deepEqual(getPointVariance({ observed: 4, reported: 0 }), { difference: 4, percent: null, description: '4 more observed' });
});

test('SVG geometry maps every count to the shared zero-based scale, not decorative coordinates', () => {
  for (const width of [270, 640, 1000]) {
    const chart = createChartGeometry(points, width);
    assert.equal(chart.maximum, 450);
    assert.deepEqual(chart.ticks.map(tick => tick.value), [0, 150, 300, 450]);
    for (const [index, point] of chart.points.entries()) {
      assert.ok(point.x > chart.left && point.x < chart.right);
      if (index) assert.ok(point.x > chart.points[index - 1].x);
      for (const series of ['observed', 'reported']) {
        const scaledValue = (chart.bottom - point[`${series}Y`]) / (chart.bottom - chart.top) * chart.maximum;
        assert.ok(Math.abs(scaledValue - points[index][series]) < 1e-9);
        assert.ok(chart.paths[series].line.includes(`${point.x} ${point[`${series}Y`]}`));
        assert.ok(point[`${series}Y`] >= chart.top && point[`${series}Y`] <= chart.bottom);
      }
    }
    assert.ok(chart.paths.observed.area.endsWith(`L ${chart.points[0].x} ${chart.bottom} Z`));
  }
});

test('changed data produces changed geometry and all-zero/single-point/empty data remain finite', () => {
  const changed = points.map(point => ({ ...point, observed: point.observed - 10 }));
  assert.notEqual(createChartGeometry(changed).paths.observed.line, createChartGeometry(points).paths.observed.line);
  for (const data of [[], [{ time: '00:00', reported: 0, observed: 0 }], [{ time: '00:00', reported: 1, observed: 2 }]]) {
    const chart = createChartGeometry(data);
    assert.ok(chart.maximum > 0);
    assert.ok(!JSON.stringify(chart).includes('NaN'));
    assert.ok(!JSON.stringify(chart).includes('Infinity'));
    assert.ok(chart.ticks.every(tick => Number.isFinite(tick.value) && Number.isFinite(tick.y)));
    assert.equal(chart.points.length, data.length);
    if (data.length) assert.equal(chart.points[0].x, (chart.left + chart.right) / 2);
  }
  assert.equal(createChartGeometry([]).paths.reported.line, '');
});
