import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, Download, FileText, Info, ShieldCheck } from 'lucide-react';
import {
  DEFAULT_REPORT_OPTIONS, REPORT_PERIODS, REPORT_TYPES, getReportStatus,
  optionsForReportType, reportToHtml, reportToJson, validateReportOptions,
} from '../reports.js';
import './reports.css';

const SECTION_CHOICES = [
  ['attendance', 'Attendance reconciliation', 'Current submitted vs observed counts, with unavailable centres excluded.'],
  ['infrastructure', 'Infrastructure inventory', 'Current approved vs observed items; operability stays separate.'],
  ['reviews', 'Review decisions & audit history', 'Available dated alerts and change records within your selected period.'],
];
const number = value => value === null || value === undefined ? 'Unavailable' : value.toLocaleString('en-IN');
const date = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC';
};
const actor = value => typeof value === 'object' && value ? JSON.stringify(value) : value || 'Not recorded';

function downloadFile(contents, mime, filename) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to start reading the blob before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportTable({ label, columns, children }) {
  return <div className="ss-report-table" role="region" aria-label={label} tabIndex={0}>
    <table><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div>;
}

function ReportPreview({ report, status, onExport }) {
  const { attendance, infrastructure, reviews } = report.summary;
  return <article className="ss-report-preview" aria-label="Compiled report preview" key={report.id}>
    <header className="ss-report-preview-header">
      <div><span className="ss-report-eyebrow">Saved evidence pack · source revision {report.sourceRevision}</span><h2>{report.title}</h2><p>{report.scopeLabel}</p></div>
      <span className={`ss-report-badge ${status.stale ? 'ss-report-badge-stale' : ''}`}>
        {status.stale ? <Info size={14} /> : <CheckCircle2 size={14} />}{status.stale ? 'Compiled · stale' : 'Compiled'}
      </span>
    </header>
    <dl className="ss-report-meta"><div><dt>Compiled</dt><dd>{date(report.createdAt)}</dd></div><div><dt>Event window · inclusive</dt><dd>{date(report.period.startAt)} → {date(report.period.endAt)}</dd></div><div><dt>Report ID</dt><dd className="ss-report-id">{report.id}</dd></div></dl>
    {status.stale && <div className="ss-report-warning" role="status">
      {status.dataChanged && <p>Source data has changed since this snapshot was compiled.</p>}
      {status.scopeChanged && <p>The builder scope or sections differ from this saved report.</p>}
      <p>Compile again to capture the new selection. Downloads still contain this saved snapshot.</p>
    </div>}
    <div className="ss-report-export"><button className="ss-report-button ss-report-primary" onClick={() => onExport('html')}><Download size={15} />Download HTML</button><button className="ss-report-button" onClick={() => onExport('json')}><Download size={15} />Download JSON</button><p>For PDF: open the downloaded HTML, then choose <strong>Print / Save as PDF</strong>. No server or external assets are needed.</p></div>

    <section className="ss-report-section"><h3>CURRENT snapshot</h3><p className="ss-report-muted">These counts were captured at compilation, not summed over the selected period. Per-centre observations may be older; last-updated times are preserved.</p><div className="ss-report-stats"><div><strong>{report.summary.centreCount}</strong><span>selected centres</span></div><div><strong>{report.summary.onlineCentreCount}</strong><span>online</span></div><div><strong>{report.summary.offlineCentreCount}</strong><span>offline / not online</span></div></div>
      <ReportTable label="Selected centres and sources" columns={['Centre', 'Location', 'Connection / source', 'Data timestamps']}>
        {report.centers.map(centre => <tr key={centre.id}><th scope="row">{centre.name}<small>{centre.id} · {centre.course}</small></th><td>{centre.city}<small>{centre.state}</small></td><td>{centre.connection}<small>{centre.source === 'simulation' ? 'Synthetic simulation' : centre.source === 'local-ai' ? 'Browser-local AI · unvalidated' : centre.source}</small></td><td>Updated: {date(centre.updatedAt)}<small>Observed: {date(centre.observedAt)}</small>{reviews && centre.reviewNotes && <small>Centre review: {centre.reviewNotes}</small>}</td></tr>)}
      </ReportTable>
    </section>

    {attendance && <section className="ss-report-section" aria-label="Attendance section"><h3>CURRENT attendance snapshot</h3><div className="ss-report-stats"><div><strong>{number(attendance.claimedTotal)}</strong><span>all selected claimed</span></div><div><strong>{number(attendance.observedTotal)}</strong><span>available observed</span></div><div><strong>{attendance.observedRate === null ? 'Unavailable' : `${attendance.observedRate.toFixed(1)}%`}</strong><span>observed / comparable claimed</span></div></div><p className="ss-report-muted">Comparison: <strong>{number(attendance.observedTotal)} / {number(attendance.comparableClaimedTotal)}</strong> across {attendance.observedCentreCount} observed centres. {attendance.unavailableCentreCount} unavailable centres are excluded from the denominator, not counted as zero. Signed variance: {number(attendance.variance)}.</p>
      <ReportTable label="Attendance reconciliation" columns={['Centre', 'Claimed', 'Observed', 'Comparable claimed', 'Signed variance']}>
        {report.centers.map(centre => <tr key={centre.id}><th scope="row">{centre.id}</th><td>{number(centre.attendance.claimed)}</td><td>{number(centre.attendance.observed)}</td><td>{centre.attendance.observationAvailable ? number(centre.attendance.comparableClaimed) : 'Excluded'}</td><td>{number(centre.attendance.variance)}</td></tr>)}
      </ReportTable>
    </section>}

    {infrastructure && <section className="ss-report-section" aria-label="Infrastructure section"><h3>CURRENT infrastructure snapshot</h3><div className="ss-report-stats"><div><strong>{number(infrastructure.gapItemCount)}</strong><span>observed item rows with gaps</span></div><div><strong>{number(infrastructure.gapUnits)}</strong><span>gap units</span></div><div><strong>{number(infrastructure.unavailableItemCount)}</strong><span>unavailable item rows</span></div></div><p className="ss-report-muted">Approved units: {number(infrastructure.approvedTotal)}. Observed units: {number(infrastructure.observedTotal)} / {number(infrastructure.comparableApprovedTotal)} comparable approved. Unavailable rows are excluded. Visual presence does not establish operability; human-verified counts remain separate from the visual comparison.</p>
      <ReportTable label="Infrastructure inventory" columns={['Centre / item', 'Approved', 'Observed', 'Gap', 'Operability', 'Human review']}>
        {report.centers.flatMap(centre => centre.inventory.map((item, index) => <tr key={`${centre.id}-${item.id}-${index}`}><th scope="row">{item.name}<small>{centre.id}</small></th><td>{number(item.approved)}</td><td>{number(item.observed)}</td><td>{number(item.gap)}</td><td>{item.operability}</td><td>Verified: {number(item.humanReview.verifiedCount)}<small>{item.humanReview.status} · {item.humanReview.note || 'No note'}</small><small>Reviewed: {date(item.humanReview.reviewedAt)}</small>{item.humanReview.verificationRequestedAt && <small>Requested: {date(item.humanReview.verificationRequestedAt)}</small>}</td></tr>))}
      </ReportTable>
    </section>}

    {reviews && <section className="ss-report-section" aria-label="Review section"><h3>Dated review events</h3><p className="ss-report-muted">{reviews.alertCount} alerts created in the period: {reviews.openAlertCount} currently open, {reviews.resolvedAlertCount} currently resolved. {reviews.historyCount} dated audit records. Alert status is current at compilation, not historical status.</p>
      <h4>Alerts</h4>{report.alerts.length ? <div className="ss-report-events">{report.alerts.map(alert => <article key={alert.id}><div className="ss-report-event-heading"><strong>{alert.type}</strong><span>{alert.status} · {alert.severity}</span></div><p>{alert.summary}</p><small>{alert.id} · {alert.centreId} · created {date(alert.createdAt)}</small><p className="ss-report-muted">Source evidence (not validated): {alert.evidence || 'Not recorded'}</p>{alert.status === 'resolved' && <p className="ss-report-muted">Resolved by {alert.resolvedBy || 'Not recorded'} · {date(alert.resolvedAt)}</p>}<details><summary>Complete captured alert</summary><pre>{JSON.stringify(alert, null, 2)}</pre></details></article>)}</div> : <p className="ss-report-empty-inline">No available alerts were created in this scope and period. This does not prove that no issues occurred.</p>}
      <h4>Audit history</h4>{report.history.length ? <div className="ss-report-events">{report.history.map(entry => <article key={entry.id}><div className="ss-report-event-heading"><strong>{entry.type}</strong><span>{entry.centreId || 'Global'}</span></div><p>{entry.summary}</p><small>{date(entry.createdAt)} · actor: {actor(entry.actor)}</small><details><summary>Captured record · before / after when available</summary><pre>{JSON.stringify(entry, null, 2)}</pre></details></article>)}</div> : <p className="ss-report-empty-inline">No available audit records match this scope and period.</p>}
    </section>}

    <section className="ss-report-section ss-report-limitations"><h3><ShieldCheck size={17} />Data coverage & limitations</h3><p>Local state created: {date(report.coverage.localStateCreatedAt)}. Available dates below describe stored records only, not continuous monitoring coverage.</p>
      {['alerts', 'history'].filter(key => report.coverage[key]).map(key => { const coverage = report.coverage[key]; return <div key={key} className="ss-report-coverage"><strong>{key === 'alerts' ? 'Alert creation records' : 'Audit records'}</strong><p>{coverage.includedRecords} included · {coverage.beforePeriod} before period · {coverage.invalidDates} invalid dates excluded · {coverage.futureDates} future dates excluded</p><p>Available stored dates: {date(coverage.firstAvailableAt)} → {date(coverage.lastAvailableAt)}</p></div>; })}
      {!reviews && <p>Review events were not requested; no dated alerts or audit history are included.</p>}
      <ul>{report.disclosures.map(disclosure => <li key={disclosure}>{disclosure}</li>)}</ul>
    </section>
  </article>;
}

export default function ReportsView({ appState, onCompile, onDownload, focusReportId }) {
  const reports = useMemo(() => [...(appState.reports ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [appState.reports]);
  const initialReport = reports.find(report => report.id === focusReportId) ?? reports[0];
  const [options, setOptions] = useState(() => structuredClone(initialReport?.options ?? DEFAULT_REPORT_OPTIONS));
  const [selectedId, setSelectedId] = useState(() => initialReport?.id ?? null);
  const handledFocus = useRef(null);
  useEffect(() => {
    if (!focusReportId || handledFocus.current === focusReportId || !reports.some(report => report.id === focusReportId)) return;
    handledFocus.current = focusReportId;
    setSelectedId(focusReportId);
  }, [focusReportId, reports]);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const validation = validateReportOptions(appState, options);
  const selectedReport = reports.find(report => report.id === selectedId) ?? reports[0] ?? null;
  const status = selectedReport ? getReportStatus(selectedReport, appState, options) : null;

  function changeOptions(next) {
    setOptions(next);
    setError('');
    setFeedback('');
  }
  function compile(event) {
    event.preventDefault();
    setError('');
    setFeedback('');
    try {
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      if (typeof onCompile !== 'function') throw new Error('Report compilation is unavailable.');
      const report = onCompile(structuredClone(options));
      if (!report?.id) throw new Error('Compilation did not return a saved report.');
      setSelectedId(report.id);
      setFeedback('Report compiled. A new snapshot has been added to your local archive.');
    } catch (cause) { setError(cause.message || 'The report could not be compiled. Please try again.'); }
  }
  function exportReport(format) {
    if (!selectedReport) return;
    setError('');
    try {
      const content = format === 'html' ? reportToHtml(selectedReport) : reportToJson(selectedReport);
      const filename = `skillsight-${selectedReport.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.${format}`;
      downloadFile(content, format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8', filename);
      const message = `${format.toUpperCase()} download prepared from the selected saved snapshot.`;
      setFeedback(message);
      onDownload?.(message);
    } catch (cause) { setError(cause.message || 'The download could not be prepared.'); }
  }

  return <div className="ss-reports">
    <section className="ss-report-intro"><div><span className="ss-report-eyebrow">Evidence pack · local-only</span><h2>A clear snapshot.<br /><em>An honest review.</em></h2><p>Capture the centres, sections and dated records you choose. Revisit the exact saved contents, even after the dashboard changes.</p></div><div className="ss-report-intro-note"><ShieldCheck size={24} /><strong>Current signals, not historical claims</strong><p>Seeded data is synthetic. Reports stay in this browser unless you download and share them. No model-accuracy claim or automatic compliance decision is made.</p></div></section>
    <div className="ss-report-layout"><aside className="ss-report-sidebar">
      <form className="ss-report-builder" onSubmit={compile} aria-label="Report builder"><span className="ss-report-eyebrow">Build an evidence pack</span><h2>Choose your scope</h2>
        <label htmlFor="ss-report-type">Report type</label><select id="ss-report-type" value={options.type} onChange={event => changeOptions(optionsForReportType(event.target.value, options.centreId))}>{Object.entries(REPORT_TYPES).map(([value, type]) => <option value={value} key={value}>{type.label}</option>)}</select><p className="ss-report-help">Changing type applies its recommended period and sections. You can then customise them.</p>
        <label htmlFor="ss-report-period">Reporting period</label><select id="ss-report-period" value={options.period} onChange={event => changeOptions({ ...options, period: event.target.value })}>{Object.entries(REPORT_PERIODS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <label htmlFor="ss-report-centre">Centre scope</label><select id="ss-report-centre" value={options.centreId} onChange={event => changeOptions({ ...options, centreId: event.target.value })}><option value="all">All centres ({appState.centers.length})</option>{appState.centers.map(centre => <option value={centre.id} key={centre.id}>{centre.id} · {centre.name}</option>)}</select>
        <fieldset><legend>Include sections</legend>{SECTION_CHOICES.map(([key, label, description]) => <label className="ss-report-check" key={key}><input type="checkbox" checked={options.sections[key]} onChange={event => changeOptions({ ...options, sections: { ...options.sections, [key]: event.target.checked } })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
        <p className="ss-report-help">The period filters dated review events only. Attendance and inventory always capture the CURRENT available values.</p>
        {!validation.valid && <div className="ss-report-error" role="alert">{validation.errors.join(' ')}</div>}
        <button className="ss-report-button ss-report-primary ss-report-compile" type="submit" disabled={!validation.valid}><FileText size={16} />Compile report</button>
      </form>
      <section className="ss-report-archive" aria-label="Report archive"><h3><Archive size={16} />Snapshot archive <span>{reports.length}</span></h3><p className="ss-report-help">Older reports keep their original contents. Compilation adds a new snapshot; it never overwrites one.</p>{reports.length ? <div className="ss-report-archive-list">{reports.map(report => <button key={report.id} className={`ss-report-archive-item ${selectedReport?.id === report.id ? 'is-selected' : ''}`} aria-pressed={selectedReport?.id === report.id} onClick={() => { setSelectedId(report.id); setFeedback(''); setError(''); }}><strong>{report.title}</strong><span>{report.scopeLabel}</span><small>{date(report.createdAt)}</small><small>{getReportStatus(report, appState).stale ? 'Compiled · stale source' : 'Compiled'} · {report.id.slice(0, 12)}</small></button>)}</div> : <p className="ss-report-empty-inline">No saved reports yet.</p>}</section>
    </aside><div className="ss-report-content">
      {error && <div className="ss-report-error" role="alert">{error}</div>}
      <div className="ss-report-feedback" role="status" aria-live="polite">{feedback && <span key={feedback}><CheckCircle2 size={16} />{feedback}</span>}</div>
      {selectedReport ? <ReportPreview report={selectedReport} status={status} onExport={exportReport} /> : <section className="ss-report-empty"><FileText size={35} /><span className="ss-report-eyebrow">Your evidence pack starts here</span><h2>No compiled report yet</h2><p>Choose your scope and compile a report to preview real captured data. The preview and downloads will use the same saved snapshot.</p><p>Nothing is submitted to a server. Offline observations are marked unavailable, never silently counted as zero.</p></section>}
    </div></div>
  </div>;
}
