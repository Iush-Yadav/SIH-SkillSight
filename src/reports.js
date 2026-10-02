import { attendanceAvailable, inventoryAvailable } from './observations.js';
const SECTION_KEYS = ['attendance', 'infrastructure', 'reviews'];
const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_TYPES = Object.freeze({
  compliance: Object.freeze({ label: 'Compliance summary', period: '7d', sections: Object.freeze({ attendance: true, infrastructure: true, reviews: true }) }),
  attendance: Object.freeze({ label: 'Attendance discrepancy review', period: '7d', sections: Object.freeze({ attendance: true, infrastructure: false, reviews: true }) }),
  infrastructure: Object.freeze({ label: 'Infrastructure inventory brief', period: '30d', sections: Object.freeze({ attendance: false, infrastructure: true, reviews: true }) }),
  audit: Object.freeze({ label: 'Centre-wise audit packet', period: 'quarter', sections: Object.freeze({ attendance: true, infrastructure: true, reviews: true }) }),
});

export const REPORT_PERIODS = Object.freeze({ '7d': 'Last 7 days', '30d': 'Last 30 days', quarter: 'Current quarter (UTC)' });
export const DEFAULT_REPORT_OPTIONS = Object.freeze({ type: 'compliance', period: '7d', centreId: 'all', sections: REPORT_TYPES.compliance.sections });

export const REPORT_DISCLOSURES = Object.freeze([
  'Local-only prototype: compilation uses the current data in this browser. No report is submitted to a server or an authority.',
  'Seeded centres, alerts and simulation signals are synthetic demonstration data. Browser-local AI observations, when present, are not independently validated. Confidence text is source context, not measured model accuracy.',
  'Attendance and inventory are CURRENT snapshots at compilation, not period totals, historical attendance, verified enrolment, or proof of compliance. Each centre retains its last-updated time.',
  'The period filters available alert creation dates and audit-history creation dates only (inclusive bounds). Current alert status is captured at compilation. An older alert resolved in the period appears only through its dated audit record, if available.',
  'Audit records may be incomplete or reset locally. No historical series is reconstructed, no missing events are inferred, and no historical trend or model-accuracy claim is made.',
  'Unavailable observations are excluded; saved local AI observations remain available without camera connectivity. Unavailable observations are excluded from the comparison denominator, never treated as zero. All-centre scope includes global audit records; a single-centre scope excludes records without that centre ID.',
]);

export class ReportValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ReportValidationError';
    this.code = 'INVALID_REPORT_INPUT';
    this.errors = [...errors];
  }
}

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const clone = value => structuredClone(value);

/** A type change in the builder applies real section and period defaults. */
export function optionsForReportType(type, centreId = 'all') {
  if (!own(REPORT_TYPES, type)) throw new ReportValidationError(['Choose a valid report type.']);
  return { type, period: REPORT_TYPES[type].period, centreId, sections: { ...REPORT_TYPES[type].sections } };
}

/** Does not throw; useful for disabling the builder before compilation. */
export function validateReportOptions(appState, input = DEFAULT_REPORT_OPTIONS) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Report options must be an object.'], options: null };
  }
  const type = input.type === undefined ? DEFAULT_REPORT_OPTIONS.type : input.type;
  const preset = typeof type === 'string' && own(REPORT_TYPES, type) ? REPORT_TYPES[type] : null;
  if (!preset) errors.push('Choose a valid report type.');
  const period = input.period === undefined ? (preset?.period ?? DEFAULT_REPORT_OPTIONS.period) : input.period;
  if (typeof period !== 'string' || !own(REPORT_PERIODS, period)) errors.push('Choose a valid reporting period.');
  const centreId = input.centreId === undefined ? 'all' : input.centreId;
  if (typeof centreId !== 'string' || !centreId.trim()) errors.push('Choose a valid centre scope.');
  const suppliedSections = input.sections === undefined ? preset?.sections : input.sections;
  let sections = null;
  if (!suppliedSections || typeof suppliedSections !== 'object' || Array.isArray(suppliedSections) || SECTION_KEYS.some(key => typeof suppliedSections[key] !== 'boolean')) {
    errors.push('Attendance, infrastructure and reviews must each be true or false.');
  } else {
    sections = Object.fromEntries(SECTION_KEYS.map(key => [key, suppliedSections[key]]));
    if (!SECTION_KEYS.some(key => sections[key])) errors.push('Select at least one report section.');
  }
  if (!Array.isArray(appState?.centers)) {
    errors.push('Centre data is unavailable.');
  } else if (!appState.centers.some(centre => centreId === 'all' || centre.id === centreId)) {
    errors.push(centreId === 'all' ? 'No centres are available to report on.' : 'The selected centre is no longer available.');
  }
  return { valid: errors.length === 0, errors, options: { type, period, centreId, sections } };
}

export function reportPeriodBounds(period, nowIso = new Date().toISOString()) {
  const end = stamp(nowIso);
  if (!Number.isFinite(end)) throw new ReportValidationError(['Compilation time must be a valid date.']);
  if (!own(REPORT_PERIODS, period)) throw new ReportValidationError(['Choose a valid reporting period.']);
  const date = new Date(end);
  const start = period === 'quarter'
    ? Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1)
    : end - (period === '7d' ? 7 : 30) * DAY_MS;
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), timezone: 'UTC', inclusive: true };
}

function filterEvents(records, scopeIds, allCentres, bounds, allowGlobal) {
  const start = Date.parse(bounds.startAt);
  const end = Date.parse(bounds.endAt);
  const scoped = records.filter(record => record && (scopeIds.has(record.centreId) || (allCentres && allowGlobal && !record.centreId)));
  const dated = scoped.filter(record => Number.isFinite(stamp(record.createdAt)));
  const available = dated.filter(record => stamp(record.createdAt) <= end);
  const times = available.map(record => stamp(record.createdAt)).sort((a, b) => a - b);
  const included = available.filter(record => stamp(record.createdAt) >= start).sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
  return {
    records: clone(included),
    coverage: {
      scopedRecords: scoped.length,
      includedRecords: included.length,
      beforePeriod: available.length - included.length,
      invalidDates: scoped.length - dated.length,
      futureDates: dated.length - available.length,
      firstAvailableAt: times.length ? new Date(times[0]).toISOString() : null,
      lastAvailableAt: times.length ? new Date(times.at(-1)).toISOString() : null,
    },
  };
}

function requireCount(value, label, errors) {
  if (!isCount(value)) errors.push(`${label} must be a non-negative whole number.`);
}

/**
 * Compiles an isolated, serializable snapshot without changing live state.
 * No storage, network access, inferred history, or re-use of previous reports.
 */
export function compileReport(appState, input = DEFAULT_REPORT_OPTIONS, nowIso = new Date().toISOString()) {
  const validation = validateReportOptions(appState, input);
  if (!validation.valid) throw new ReportValidationError(validation.errors);
  const options = validation.options;
  const bounds = reportPeriodBounds(options.period, nowIso);
  const createdAt = bounds.endAt;
  const scope = appState.centers.filter(centre => options.centreId === 'all' || centre.id === options.centreId);
  const errors = [];
  if (appState.dataRevision !== undefined && !isCount(appState.dataRevision)) errors.push('Data revision must be a non-negative whole number.');
  const scopeIds = new Set();
  for (const centre of scope) {
    if (typeof centre.id !== 'string' || !centre.id || scopeIds.has(centre.id)) errors.push('Every selected centre must have a unique ID.');
    scopeIds.add(centre.id);
    if (options.sections.attendance) {
      requireCount(centre.claimed, `${centre.id}: claimed presence`, errors);
      if (centre.connection === 'online' && centre.detected != null) requireCount(centre.detected, `${centre.id}: observed presence`, errors);
    }
    if (options.sections.infrastructure) {
      if (!Array.isArray(centre.inventory)) errors.push(`${centre.id}: inventory is unavailable.`);
      for (const item of Array.isArray(centre.inventory) ? centre.inventory : []) {
        requireCount(item.approved, `${centre.id}: ${item.name} approved count`, errors);
        if (centre.connection === 'online' && item.detected != null) requireCount(item.detected, `${centre.id}: ${item.name} observed count`, errors);
      }
    }
  }
  if (options.sections.reviews) {
    if (appState.alerts !== undefined && !Array.isArray(appState.alerts)) errors.push('Alert data must be a list.');
    if (appState.history !== undefined && !Array.isArray(appState.history)) errors.push('Audit history must be a list.');
  }
  if (errors.length) throw new ReportValidationError(errors);

  const centers = scope.map(centre => {
    const snapshot = {
      id: centre.id, name: centre.name ?? centre.id, city: centre.city ?? '', state: centre.state ?? '', course: centre.course ?? '',
      connection: centre.connection ?? 'unknown', source: centre.source ?? 'unspecified', updatedAt: centre.updatedAt ?? null,
      observedAt: centre.observedAt ?? null,
    };
    if (options.sections.reviews) snapshot.reviewNotes = centre.reviewNotes ?? '';
    if (options.sections.attendance) {
      const available = attendanceAvailable(centre);
      snapshot.attendance = {
        claimed: centre.claimed,
        observed: available ? centre.detected : null,
        comparableClaimed: available ? centre.claimed : 0,
        variance: available ? centre.claimed - centre.detected : null,
        observationAvailable: available,
      };
    }
    if (options.sections.infrastructure) {
      snapshot.inventory = centre.inventory.map(item => {
        const available = inventoryAvailable(centre, item);
        return {
          source: item.source || 'simulation', observedAt: item.observedAt || centre.observedAt || null, id: item.id, name: item.name, approved: item.approved, observed: available ? item.detected : null,
          gap: available ? Math.max(0, item.approved - item.detected) : null,
          operability: item.operability ?? 'Unknown', observationAvailable: available,
          humanReview: {
            verifiedCount: item.verifiedCount ?? null, status: item.reviewStatus ?? 'unreviewed',
            note: item.reviewNote ?? '', reviewedAt: item.reviewedAt ?? null,
            verificationRequestedAt: item.verificationRequestedAt ?? null,
          },
        };
      });
    }
    return snapshot;
  });
  const attendance = options.sections.attendance ? centers.reduce((totals, centre) => {
    const row = centre.attendance;
    totals.claimedTotal += row.claimed;
    if (row.observationAvailable) {
      totals.observedCentreCount += 1;
      totals.observedTotal += row.observed;
      totals.comparableClaimedTotal += row.claimed;
    } else totals.unavailableCentreCount += 1;
    return totals;
  }, { claimedTotal: 0, observedTotal: 0, comparableClaimedTotal: 0, observedCentreCount: 0, unavailableCentreCount: 0 }) : null;
  if (attendance) {
    attendance.variance = attendance.observedCentreCount ? attendance.comparableClaimedTotal - attendance.observedTotal : null;
    attendance.observedRate = attendance.comparableClaimedTotal ? attendance.observedTotal / attendance.comparableClaimedTotal * 100 : null;
  }
  const infrastructure = options.sections.infrastructure ? centers.flatMap(centre => centre.inventory).reduce((totals, item) => {
    totals.approvedTotal += item.approved;
    totals.itemCount += 1;
    if (item.observationAvailable) {
      totals.observedItemCount += 1;
      totals.comparableApprovedTotal += item.approved;
      totals.observedTotal += item.observed;
      totals.gapItemCount += item.gap > 0 ? 1 : 0;
      totals.gapUnits += item.gap;
    } else totals.unavailableItemCount += 1;
    return totals;
  }, { approvedTotal: 0, observedTotal: 0, comparableApprovedTotal: 0, itemCount: 0, observedItemCount: 0, unavailableItemCount: 0, gapItemCount: 0, gapUnits: 0 }) : null;
  const alertResult = options.sections.reviews ? filterEvents(appState.alerts ?? [], scopeIds, options.centreId === 'all', bounds, false) : null;
  const historyResult = options.sections.reviews ? filterEvents(appState.history ?? [], scopeIds, options.centreId === 'all', bounds, true) : null;
  const alerts = alertResult?.records ?? [];
  const history = historyResult?.records ?? [];
  const summary = {
    centreCount: centers.length,
    onlineCentreCount: centers.filter(centre => centre.connection === 'online').length,
    offlineCentreCount: centers.filter(centre => centre.connection !== 'online').length,
    attendance,
    infrastructure,
    reviews: options.sections.reviews ? {
      alertCount: alerts.length,
      openAlertCount: alerts.filter(alert => alert.status === 'open').length,
      resolvedAlertCount: alerts.filter(alert => alert.status === 'resolved').length,
      historyCount: history.length,
    } : null,
  };
  return clone({
    id: `RPT-${globalThis.crypto.randomUUID()}`,
    schemaVersion: 1,
    createdAt,
    sourceRevision: appState.dataRevision ?? 0,
    options,
    title: REPORT_TYPES[options.type].label,
    scopeLabel: options.centreId === 'all' ? `All ${centers.length} centres` : `${centers[0].name} (${centers[0].id})`,
    period: bounds,
    summary,
    centers,
    alerts,
    history,
    coverage: {
      snapshotAsOf: createdAt,
      localStateCreatedAt: Number.isFinite(stamp(appState.createdAt)) ? new Date(appState.createdAt).toISOString() : null,
      alerts: alertResult?.coverage ?? null,
      history: historyResult?.coverage ?? null,
      historicalCountsAvailable: false,
    },
    disclosures: [...REPORT_DISCLOSURES],
  });
}

function optionsKey(options) {
  return JSON.stringify([options?.type, options?.period, options?.centreId, ...SECTION_KEYS.map(key => options?.sections?.[key])]);
}

export function getReportStatus(report, appState, options = report?.options) {
  const dataChanged = report?.sourceRevision !== (appState?.dataRevision ?? 0);
  const scopeChanged = optionsKey(report?.options) !== optionsKey(options);
  return { stale: dataChanged || scopeChanged, dataChanged, scopeChanged };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function reportToJson(report) {
  return JSON.stringify(report, null, 2);
}

const display = value => value === null || value === undefined ? 'Unavailable' : String(value);
const htmlTable = (headings, rows) => `<div class="table-wrap"><table><thead><tr>${headings.map(heading => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(display(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const detailJson = value => escapeHtml(JSON.stringify(value, null, 2) ?? 'Not recorded');

/** Standalone HTML: escaped content, no external assets, printable without the app. */
export function reportToHtml(report) {
  const e = escapeHtml;
  const { attendance, infrastructure, reviews } = report.summary;
  const attendanceHtml = attendance ? `<section><h2>CURRENT attendance snapshot</h2><p>All selected claimed: <strong>${e(attendance.claimedTotal)}</strong>. Observed: <strong>${e(attendance.observedTotal)}</strong> across ${e(attendance.observedCentreCount)} centres. Comparable claimed denominator: <strong>${e(attendance.comparableClaimedTotal)}</strong>. Signed variance (comparable claimed − observed): ${e(display(attendance.variance))}. Observed / comparable claimed: ${attendance.observedRate === null ? 'Unavailable' : `${e(attendance.observedRate.toFixed(1))}%`}. Unavailable centres: ${e(attendance.unavailableCentreCount)}; excluded, not zero.</p>${htmlTable(['Centre', 'Claimed', 'Observed', 'Comparable claimed', 'Signed variance'], report.centers.map(centre => [centre.id, centre.attendance.claimed, centre.attendance.observed, centre.attendance.observationAvailable ? centre.attendance.comparableClaimed : 'Excluded', centre.attendance.variance]))}</section>` : '';
  const infrastructureHtml = infrastructure ? `<section><h2>CURRENT infrastructure snapshot</h2><p>Approved units: ${e(infrastructure.approvedTotal)}. Observed units: ${e(infrastructure.observedTotal)} / ${e(infrastructure.comparableApprovedTotal)} comparable approved. ${e(infrastructure.gapItemCount)} observed item rows have gaps (${e(infrastructure.gapUnits)} units). ${e(infrastructure.unavailableItemCount)} unavailable item rows excluded. Visual presence does not establish operability. Human-verified counts and notes are separate from the visual comparison.</p>${htmlTable(['Centre', 'Item', 'Approved', 'Observed', 'Gap', 'Operability', 'Human review'], report.centers.flatMap(centre => centre.inventory.map(item => [centre.id, item.name, item.approved, item.observed, item.gap, item.operability, `Verified count: ${display(item.humanReview.verifiedCount)}; ${item.humanReview.status}; ${item.humanReview.note || 'No note'}; reviewed: ${display(item.humanReview.reviewedAt)}; verification requested: ${display(item.humanReview.verificationRequestedAt)}`])))}</section>` : '';
  const reviewsHtml = reviews ? `<section><h2>Dated review events</h2><p>${e(reviews.alertCount)} alerts created in the period (${e(reviews.openAlertCount)} currently open, ${e(reviews.resolvedAlertCount)} currently resolved); ${e(reviews.historyCount)} audit records. Status is CURRENT at compilation, not a historical status series.</p><h3>Alerts</h3>${report.alerts.length ? report.alerts.map(alert => `<article><h4>${e(alert.id)} · ${e(alert.type)}</h4><p>${e(alert.centreId)} · ${e(alert.severity)} · ${e(alert.status)} · created ${e(alert.createdAt)}</p><p>${e(alert.summary)}</p><p>Source evidence (not validated): ${e(alert.evidence ?? 'Not recorded')}</p><p>Resolved by ${e(alert.resolvedBy ?? 'Not recorded')} · ${e(alert.resolvedAt ?? 'Not recorded')}</p><details><summary>Complete captured alert</summary><pre>${detailJson(alert)}</pre></details></article>`).join('') : '<p>No available alerts were created in this scope and period. This is not proof that no issues occurred.</p>'}<h3>Audit history</h3>${report.history.length ? report.history.map(entry => `<article><h4>${e(entry.type)} · ${e(entry.id)}</h4><p>${e(entry.summary)}</p><p>${e(entry.centreId ?? 'Global')} · ${e(entry.createdAt)} · actor: ${e(typeof entry.actor === 'object' ? JSON.stringify(entry.actor) : entry.actor ?? 'Not recorded')}</p><h5>Captured audit record (including before / after, when recorded)</h5><pre>${detailJson(entry)}</pre></article>`).join('') : '<p>No available audit records match this scope and period.</p>'}</section>` : '';
  const coverageRows = ['alerts', 'history'].filter(key => report.coverage[key]).map(key => {
    const coverage = report.coverage[key];
    return [key, coverage.includedRecords, coverage.beforePeriod, coverage.invalidDates, coverage.futureDates, coverage.firstAvailableAt, coverage.lastAvailableAt];
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkillSight · ${e(report.title)} · ${e(report.id)}</title>
<style>body{max-width:1100px;margin:40px auto;padding:0 24px;color:#17253c;font:14px/1.6 system-ui,sans-serif}h1,h2,h3{line-height:1.25}h1{font-size:30px}h2{margin-top:30px;font-size:21px}small,.muted{color:#536178}header{border-bottom:3px solid #315be8;padding-bottom:20px}section{margin:24px 0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:9px;border:1px solid #dce2ec;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2fa}.table-wrap{overflow:auto}article{padding:12px 0;border-bottom:1px solid #dce2ec}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f6f8fc;padding:12px}button{padding:10px 16px;cursor:pointer;border:1px solid #315be8;background:#315be8;color:white;border-radius:6px}.notice{background:#f2f5fc;border-left:3px solid #315be8;padding:14px}.print-tools{margin-bottom:20px}@media print{@page{size:A4;margin:14mm}body{margin:0;padding:0;font-size:10pt;color:#111}.print-tools{display:none}h2,h3,h4{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}.table-wrap{overflow:visible}table{font-size:9pt}pre{font-size:8pt}details{display:block}details>pre{display:block!important}}</style></head>
<body><div class="print-tools"><button type="button" onclick="window.print()">Print / Save as PDF</button><p>Use your browser’s print dialog and choose “Save as PDF”. This file works offline; no external assets are loaded.</p></div>
<header><small>SKILLSIGHT / LOCAL EVIDENCE PACK</small><h1>${e(report.title)}</h1><p>${e(report.scopeLabel)}</p><p>Compiled: ${e(report.createdAt)} · Source revision: ${e(report.sourceRevision)}<br>Report ID: ${e(report.id)}</p><p>Requested event period: ${e(REPORT_PERIODS[report.options.period])}<br>${e(report.period.startAt)} → ${e(report.period.endAt)} (UTC, inclusive)</p></header>
<p class="notice">Saved snapshot — not a live dashboard. Counts below are CURRENT as captured at compilation, not historical period aggregates. This standalone file cannot check whether the source has since changed.</p>
<section><h2>Selected centres and source coverage</h2><p>${e(report.summary.centreCount)} selected · ${e(report.summary.onlineCentreCount)} online · ${e(report.summary.offlineCentreCount)} offline / not online.</p>${htmlTable(['Centre', 'Name', 'Location', 'Course', 'Connection', 'Source', 'Last updated', 'Observation time', ...(reviews ? ['Centre review notes'] : [])], report.centers.map(centre => [centre.id, centre.name, `${centre.city}, ${centre.state}`, centre.course, centre.connection, centre.source, centre.updatedAt, centre.observedAt, ...(reviews ? [centre.reviewNotes || 'No note'] : [])]))}</section>
${attendanceHtml}${infrastructureHtml}${reviewsHtml}
<section><h2>Data coverage and limitations</h2><p>Local state created: ${e(display(report.coverage.localStateCreatedAt))}. Snapshot captured: ${e(report.coverage.snapshotAsOf)}. Available-event dates describe stored records only, not continuous monitoring coverage.</p>${coverageRows.length ? htmlTable(['Event set', 'Included', 'Before period', 'Invalid date excluded', 'Future date excluded', 'First available', 'Last available'], coverageRows) : '<p>Review events were not requested. No dated alert or audit-history data is included.</p>'}<ul>${report.disclosures.map(disclosure => `<li>${e(disclosure)}</li>`).join('')}</ul></section>
<footer><p>SkillSight prototype · human review required · local-only snapshot</p></footer></body></html>`;
}
