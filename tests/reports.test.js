import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORT_OPTIONS, ReportValidationError, compileReport, escapeHtml, getReportStatus,
  optionsForReportType, reportPeriodBounds, reportToHtml, reportToJson, validateReportOptions,
} from '../src/reports.js';
import { makeInitialState } from '../src/data.js';

const NOW = '2025-05-15T12:00:00.000Z';
const options = patch => ({ ...DEFAULT_REPORT_OPTIONS, sections: { ...DEFAULT_REPORT_OPTIONS.sections }, ...patch });
const alert = (id, centreId, createdAt, extra = {}) => ({ id, centreId, createdAt, type: 'Attendance mismatch', severity: 'high', status: 'open', summary: `Signal ${id}`, ...extra });
const event = (id, centreId, createdAt, extra = {}) => ({ id, centreId, createdAt, type: 'centre-updated', summary: `Change ${id}`, actor: 'Reviewer', ...extra });

function fixture() {
  const center = (id, claimed, detected, connection, approved, observed) => ({
    id, name: `Centre ${id}`, city: `City ${id}`, state: 'State', course: 'Training', claimed, detected, connection,
    source: 'simulation', updatedAt: '2025-05-15T11:00:00.000Z',
    inventory: [{ id: 'seats', name: 'Seats', approved, detected: observed, operability: 'Unknown' }],
  });
  return {
    createdAt: '2025-04-01T09:00:00.000Z', dataRevision: 7, settings: { mismatchThreshold: 10 }, reports: [],
    centers: [center('A', 10, 8, 'online', 4, 3), center('B', 20, 99, 'offline', 7, 77), center('C', 5, 0, 'online', 2, 0), center('D', 7, null, 'online', 3, null)],
    alerts: [
      alert('start-7d', 'A', '2025-05-08T12:00:00.000Z'),
      alert('end', 'A', NOW),
      alert('other-centre', 'B', '2025-05-12T00:00:00.000Z'),
      alert('before-7d', 'A', '2025-05-08T11:59:59.999Z'),
      alert('start-30d', 'A', '2025-04-15T12:00:00.000Z'),
      alert('start-quarter', 'A', '2025-04-01T00:00:00.000Z'),
      alert('old-resolved-now', 'A', '2025-03-31T23:59:59.999Z', { status: 'resolved', resolvedAt: NOW, resolvedBy: 'Reviewer' }),
      alert('future', 'A', '2025-05-15T12:00:00.001Z'),
      alert('invalid', 'A', 'not a date'),
      alert('unscoped', 'removed-centre', NOW),
    ],
    history: [
      event('centre-change', 'A', NOW, { before: { claimed: 8 }, after: { claimed: 10 } }),
      event('review', 'A', NOW, { type: 'alert-resolved', itemId: 'old-resolved-now' }),
      event('other-change', 'B', NOW),
      event('global', undefined, NOW, { type: 'settings-updated', before: { threshold: 5 }, after: { threshold: 10 } }),
      event('old-change', 'A', '2025-05-01T00:00:00.000Z'),
      event('invalid-change', 'A', null),
      event('future-change', 'A', '2025-05-16T00:00:00.000Z'),
    ],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('compilation snapshots only the selected centre and its dated events', () => {
  const report = compileReport(fixture(), options({ centreId: 'A' }), NOW);
  assert.deepEqual(report.centers.map(centre => centre.id), ['A']);
  assert.deepEqual(report.alerts.map(item => item.id), ['end', 'start-7d']);
  assert.deepEqual(report.history.map(item => item.id), ['centre-change', 'review']);
  assert.equal(report.summary.centreCount, 1);
  assert.equal(report.sourceRevision, 7);
  assert.equal(report.createdAt, NOW);
  assert.match(report.scopeLabel, /Centre A/);
  assert.equal(report.coverage.alerts.invalidDates, 1);
  assert.equal(report.coverage.alerts.futureDates, 1);
  assert.equal(report.coverage.alerts.beforePeriod, 4);
  assert.equal(report.coverage.history.includedRecords, 2);
});

test('current totals exclude offline/stale and unknown observations from denominators, but include valid zeros', () => {
  const report = compileReport(fixture(), options(), NOW);
  assert.equal(report.summary.onlineCentreCount, 3);
  assert.equal(report.summary.offlineCentreCount, 1);
  assert.deepEqual(report.summary.attendance, {
    claimedTotal: 42, observedTotal: 8, comparableClaimedTotal: 15,
    observedCentreCount: 2, unavailableCentreCount: 2, variance: 7, observedRate: 8 / 15 * 100,
  });
  assert.deepEqual(report.summary.infrastructure, {
    approvedTotal: 16, observedTotal: 3, comparableApprovedTotal: 6, itemCount: 4,
    observedItemCount: 2, unavailableItemCount: 2, gapItemCount: 2, gapUnits: 3,
  });
  const offline = report.centers.find(centre => centre.id === 'B');
  assert.equal(offline.attendance.observed, null);
  assert.equal(offline.attendance.variance, null);
  assert.equal(offline.inventory[0].observed, null);
  assert.equal(offline.inventory[0].gap, null);
});

test('inventory preserves human review and observation timestamps without replacing visual signals', () => {
  const state = fixture();
  state.centers[0].observedAt = '2025-05-14T08:00:00.000Z';
  state.centers[0].reviewNotes = 'Review the earlier evidence';
  Object.assign(state.centers[0].inventory[0], { verifiedCount: 4, reviewStatus: 'reviewed', reviewNote: 'One seat was outside frame', reviewedAt: NOW });
  const report = compileReport(state, options({ centreId: 'A' }), NOW);
  const item = report.centers[0].inventory[0];
  assert.equal(item.observed, 3);
  assert.equal(item.gap, 1);
  assert.equal(item.humanReview.verifiedCount, 4);
  assert.equal(report.centers[0].observedAt, state.centers[0].observedAt);
  assert.match(reportToHtml(report), /One seat was outside frame/);
  assert.match(reportToHtml(report), /Review the earlier evidence/);
  assert.equal(report.summary.infrastructure.observedTotal, 3);
});

test('all unavailable attendance produces unavailable ratio and variance, not a fabricated zero-percent result', () => {
  const report = compileReport(fixture(), options({ centreId: 'B' }), NOW);
  assert.equal(report.summary.attendance.claimedTotal, 20);
  assert.equal(report.summary.attendance.comparableClaimedTotal, 0);
  assert.equal(report.summary.attendance.observedCentreCount, 0);
  assert.equal(report.summary.attendance.observedRate, null);
  assert.equal(report.summary.attendance.variance, null);
  assert.match(reportToHtml(report), /Observed \/ comparable claimed: Unavailable/);
});

test('zero claimed denominator is unavailable, and signed discrepancies are not clamped', () => {
  const state = fixture();
  state.centers[0].claimed = 0;
  const report = compileReport(state, options({ centreId: 'A' }), NOW);
  assert.equal(report.summary.attendance.observedRate, null);
  assert.equal(report.summary.attendance.variance, -8);
});

test('rolling periods and UTC quarter boundaries filter events without changing current count totals', () => {
  const state = fixture();
  const weekly = compileReport(state, options({ centreId: 'A' }), NOW);
  const monthly = compileReport(state, options({ centreId: 'A', period: '30d' }), NOW);
  const quarter = compileReport(state, options({ centreId: 'A', period: 'quarter' }), NOW);
  assert.equal(weekly.period.startAt, '2025-05-08T12:00:00.000Z');
  assert.equal(monthly.period.startAt, '2025-04-15T12:00:00.000Z');
  assert.equal(quarter.period.startAt, '2025-04-01T00:00:00.000Z');
  assert.equal(weekly.alerts.length, 2);
  assert.equal(monthly.alerts.length, 4);
  assert.equal(quarter.alerts.length, 5);
  assert.deepEqual(weekly.summary.attendance, monthly.summary.attendance);
  assert.deepEqual(weekly.summary.infrastructure, quarter.summary.infrastructure);
  assert.equal(quarter.coverage.historicalCountsAvailable, false);
  assert.equal(quarter.coverage.alerts.firstAvailableAt, '2025-03-31T23:59:59.999Z');
  assert.ok(quarter.disclosures.some(text => text.includes('not period totals')));
  assert.ok(quarter.disclosures.some(text => text.includes('incomplete')));
});

test('quarter windows use calendar quarters, including year rollover, not a fixed 90-day approximation', () => {
  assert.equal(reportPeriodBounds('quarter', '2026-01-01T00:00:00.000Z').startAt, '2026-01-01T00:00:00.000Z');
  assert.equal(reportPeriodBounds('quarter', '2025-12-31T23:59:59.999Z').startAt, '2025-10-01T00:00:00.000Z');
  assert.equal(reportPeriodBounds('quarter', '2025-04-01T00:30:00+02:00').startAt, '2025-01-01T00:00:00.000Z');
});

test('old alerts resolved in-window are represented by dated history, not silently included by creation date', () => {
  const report = compileReport(fixture(), options({ centreId: 'A' }), NOW);
  assert.ok(!report.alerts.some(item => item.id === 'old-resolved-now'));
  assert.ok(report.history.some(item => item.itemId === 'old-resolved-now'));
});

test('all-centre scope includes global history but excludes removed-centre records', () => {
  const report = compileReport(fixture(), options(), NOW);
  assert.ok(report.history.some(item => item.id === 'global'));
  assert.ok(report.history.some(item => item.id === 'other-change'));
  assert.ok(report.alerts.some(item => item.id === 'other-centre'));
  assert.ok(!report.alerts.some(item => item.id === 'unscoped'));
  assert.equal(report.summary.reviews.alertCount, 3);
  assert.equal(report.summary.reviews.openAlertCount, 3);
  assert.equal(report.summary.reviews.historyCount, 4);
});

test('deselected sections omit both snapshot data and exported sections', () => {
  const report = compileReport(fixture(), options({ sections: { attendance: false, infrastructure: true, reviews: false } }), NOW);
  assert.equal(report.summary.attendance, null);
  assert.equal(report.summary.reviews, null);
  assert.ok(report.centers.every(centre => !('attendance' in centre)));
  assert.ok(report.centers.every(centre => !('claimed' in centre)));
  assert.deepEqual(report.alerts, []);
  assert.deepEqual(report.history, []);
  assert.equal(report.coverage.alerts, null);
  assert.equal(report.coverage.history, null);
  const html = reportToHtml(report);
  assert.match(html, /<h2>CURRENT infrastructure snapshot<\/h2>/);
  assert.doesNotMatch(html, /<h2>CURRENT attendance snapshot<\/h2>/);
  assert.doesNotMatch(html, /<h2>Dated review events<\/h2>/);
  const reviewOnly = compileReport(fixture(), options({ sections: { attendance: false, infrastructure: false, reviews: true } }), NOW);
  assert.ok(reviewOnly.centers.every(centre => !('attendance' in centre) && !('inventory' in centre)));
  assert.ok(reviewOnly.history.length > 0);
});

test('report type presets have meaningful defaults and remain individually customisable', () => {
  assert.deepEqual(optionsForReportType('attendance', 'A'), { type: 'attendance', centreId: 'A', period: '7d', sections: { attendance: true, infrastructure: false, reviews: true } });
  assert.equal(optionsForReportType('infrastructure').period, '30d');
  assert.equal(optionsForReportType('infrastructure').sections.attendance, false);
  assert.equal(optionsForReportType('audit').period, 'quarter');
  const inferred = compileReport(fixture(), { type: 'infrastructure' }, NOW);
  assert.equal(inferred.summary.attendance, null);
  assert.equal(inferred.options.period, '30d');
  const custom = compileReport(fixture(), { ...optionsForReportType('infrastructure'), period: '7d', sections: { attendance: true, infrastructure: false, reviews: false } }, NOW);
  assert.ok(custom.summary.attendance);
  assert.equal(custom.summary.infrastructure, null);
  assert.equal(DEFAULT_REPORT_OPTIONS.sections.infrastructure, true);
});

test('compile accepts frozen live input, and subsequent live mutations cannot change the snapshot', () => {
  const frozen = deepFreeze(fixture());
  const input = deepFreeze(options());
  const initialCopy = structuredClone(frozen);
  const report = compileReport(frozen, input, NOW);
  assert.deepEqual(frozen, initialCopy);
  assert.notEqual(report.options.sections, input.sections);
  report.centers[0].inventory[0].approved = 123;
  report.history[0].after.claimed = 777;
  assert.deepEqual(frozen, initialCopy);

  const live = fixture();
  const saved = compileReport(live, options(), NOW);
  const savedCopy = structuredClone(saved);
  live.centers[0].claimed = 111;
  live.centers[0].inventory[0].approved = 222;
  live.history[0].after.claimed = 333;
  live.alerts[0].summary = 'Changed after compile';
  assert.deepEqual(saved, savedCopy);
});

test('snapshots have collision-resistant IDs even with identical capture timestamps', () => {
  const first = compileReport(fixture(), options(), NOW);
  const second = compileReport(fixture(), options(), NOW);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^RPT-[\da-f]{8}-[\da-f-]{27}$/i);
});

test('invalid options and empty/missing scope produce exported validation errors', () => {
  const bad = [null, [], { type: 'unknown' }, { type: '__proto__' }, { period: 'year' }, { centreId: 'missing' }, { centreId: '' }, { sections: {} }, { sections: { attendance: 'yes', infrastructure: false, reviews: false } }, { sections: { attendance: false, infrastructure: false, reviews: false } }];
  for (const input of bad) {
    assert.equal(validateReportOptions(fixture(), input).valid, false);
    assert.throws(() => compileReport(fixture(), input, NOW), error => error instanceof ReportValidationError && error.code === 'INVALID_REPORT_INPUT' && error.errors.length > 0);
  }
  assert.throws(() => compileReport({ centers: [] }, options(), NOW), /No centres/);
  assert.throws(() => compileReport({}, options(), NOW), /Centre data is unavailable/);
  assert.throws(() => compileReport(fixture(), options(), 'broken date'), ReportValidationError);
  assert.throws(() => optionsForReportType('unknown'), ReportValidationError);
});

test('invalid counts and malformed event lists are not silently converted into fabricated totals', () => {
  const state = fixture();
  state.centers[0].claimed = -1;
  assert.throws(() => compileReport(state, options(), NOW), /non-negative whole number/);
  state.centers[0].claimed = 10;
  state.centers[0].detected = NaN;
  assert.throws(() => compileReport(state, options(), NOW), ReportValidationError);
  state.centers[0].detected = 8;
  state.history = {};
  assert.throws(() => compileReport(state, options(), NOW), /Audit history must be a list/);
});

test('stale state detects revision changes and every builder option independently', () => {
  const state = fixture();
  const report = compileReport(state, options(), NOW);
  assert.deepEqual(getReportStatus(report, state, options()), { stale: false, dataChanged: false, scopeChanged: false });
  assert.equal(getReportStatus(report, { ...state, dataRevision: 8 }, options()).dataChanged, true);
  for (const patch of [{ centreId: 'A' }, { period: '30d' }, { type: 'audit' }, { sections: { attendance: true, infrastructure: false, reviews: true } }]) {
    const status = getReportStatus(report, state, options(patch));
    assert.equal(status.stale, true);
    assert.equal(status.scopeChanged, true);
    assert.equal(status.dataChanged, false);
  }
});

test('HTML safely escapes source text and audit details; exports preserve scope and provide standalone print CSS', () => {
  const state = fixture();
  const attack = '<script>alert("x")</script><img src=x onerror="alert(1)"> & \'quote\'';
  state.centers[0].name = attack;
  state.centers[0].inventory[0].name = attack;
  state.alerts[0].summary = attack;
  state.history[0].after = { note: attack };
  const report = compileReport(state, options({ centreId: 'A' }), NOW);
  const html = reportToHtml(report);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.doesNotMatch(html, /<script>|<img/);
  assert.ok(html.includes(escapeHtml(attack)));
  assert.match(html, /@media print/);
  assert.match(html, /Print \/ Save as PDF/);
  assert.match(html, /CURRENT attendance snapshot/);
  assert.match(html, /not historical period aggregates/);
  assert.match(html, /synthetic demonstration data/);
  assert.doesNotMatch(html, /Centre B/);
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  assert.deepEqual(JSON.parse(reportToJson(report)), report);
});

test('original seeded data compiles exact current totals without relying on synthetic trend or evaluation scores', () => {
  const state = makeInitialState();
  const report = compileReport(state);
  const online = state.centers.filter(centre => centre.connection === 'online');
  assert.equal(report.summary.attendance.claimedTotal, 435);
  assert.equal(report.summary.attendance.observedTotal, 339);
  assert.equal(report.summary.attendance.comparableClaimedTotal, 369);
  assert.equal(report.summary.attendance.variance, 30);
  assert.equal(report.summary.infrastructure.gapItemCount, 2);
  assert.equal(report.summary.infrastructure.gapUnits, 4);
  assert.equal(report.summary.attendance.observedCentreCount, online.length);
  assert.equal(report.sourceRevision, state.dataRevision ?? 0);
  assert.ok(!('dailyTrend' in report));
  assert.ok(!('evaluationSamples' in report));
});
