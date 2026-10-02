import { attendanceAvailable, inventoryAvailable } from '../observations.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  buildNewCentreDraft, centreDraft, centreHistory, filterCentres, formatWorkflowTime,
  inventorySignal, requireSavedEntity, validateCentreDraft,
} from '../centreForms.js';
import './centre-workflows.css';

/** Mutations must synchronously return the persisted centre, or throw. */
export default function CentresView({ centres = [], alerts = [], history = [], onSaveCentre, onCreateCentre, onOpenMonitor, onOpenInfrastructure, focusCentreId = null, onExport }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [connection, setConnection] = useState('');
  const [selectedId, setSelectedId] = useState(focusCentreId);
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [exportError, setExportError] = useState('');
  const addButton = useRef(null);
  const states = [...new Set(centres.map(centre => centre.state))].sort();
  const filtered = useMemo(() => filterCentres(centres, { query, state, connection }), [centres, query, state, connection]);
  const selected = centres.find(centre => centre.id === selectedId);

  // Navigation is keyed only to an explicit focus change, never a simulation refresh.
  useEffect(() => {
    if (focusCentreId) { setSelectedId(focusCentreId); setCreating(false); setDirty(false); }
  }, [focusCentreId]);

  function mayLeave() { return !dirty || window.confirm('Discard unsaved centre changes?'); }
  function chooseCentre(centreId) {
    if (!creating && selectedId === centreId) return;
    if (!mayLeave()) return;
    setCreating(false); setSelectedId(centreId); setDirty(false);
  }
  function closeEditor() {
    if (!mayLeave()) return;
    setCreating(false); setSelectedId(null); setDirty(false);
    addButton.current?.focus();
  }
  function openOther(callback, centreId) { if (mayLeave()) callback(centreId); }

  return <div className="cw-workflow" aria-label="Training centres workspace">
    <section className="cw-panel">
      <div className="cw-section-head">
        <div><p className="cw-eyebrow">Network directory</p><h2>{filtered.length} centres in view</h2><p className="cw-muted">Open a centre to review its record without leaving this section.</p></div>
        <button ref={addButton} type="button" className="cw-button cw-primary" onClick={() => { if (!creating && mayLeave()) { setSelectedId(null); setCreating(true); setDirty(false); } }}>Add centre</button>
      </div>
      <div className="cw-toolbar">
        <label className="cw-search" htmlFor={`${id}-search`}>Search centres<input id={`${id}-search`} type="search" placeholder="Name, ID, city or course" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label htmlFor={`${id}-state`}>State<select id={`${id}-state`} aria-label="State" value={state} onChange={event => setState(event.target.value)}><option value="">All states</option>{states.map(value => <option key={value}>{value}</option>)}</select></label>
        <label htmlFor={`${id}-connection`}>Connection<select id={`${id}-connection`} aria-label="Connection" value={connection} onChange={event => setConnection(event.target.value)}><option value="">All connections</option><option value="online">Online</option><option value="offline">Offline</option></select></label>
        {onExport && <button type="button" className="cw-button" disabled={!filtered.length} onClick={() => { try { onExport(filtered); setExportError(''); } catch (error) { setExportError(error.message || 'The export could not be created.'); } }}>Export view</button>}
      </div>
      {exportError && <p className="cw-error" role="alert">{exportError}</p>}
      <div className="cw-centre-list">
        {filtered.map(centre => {
          const available = attendanceAvailable(centre);
          const gaps = (centre.inventory ?? []).filter(item => inventorySignal(centre, item).kind === 'gap').length;
          const openAlerts = alerts.filter(alert => alert.centreId === centre.id && alert.status === 'open').length;
          return <button className={`cw-centre-row ${selectedId === centre.id && !creating ? 'cw-selected' : ''}`} type="button" key={centre.id} onClick={() => chooseCentre(centre.id)} aria-pressed={selectedId === centre.id && !creating} aria-label={`Edit centre ${centre.name}`}>
            <span className="cw-row-title"><strong>{centre.name}</strong><small>{centre.id} · {centre.city}, {centre.state}</small><small>{centre.course}</small></span>
            <span className="cw-row-stat"><small>Observed / submitted</small><strong>{available ? centre.detected : 'Unknown'} / {centre.claimed}</strong><small>{openAlerts} open alert{openAlerts === 1 ? '' : 's'}</small></span>
            <span className="cw-row-status"><span className={`cw-badge ${centre.connection === 'online' ? 'cw-positive' : 'cw-neutral'}`}>{centre.connection === 'online' ? 'Online' : 'Offline'}</span><small>{!centre.inventory.some(item => inventoryAvailable(centre, item)) ? 'Inventory unavailable' : gaps ? `${gaps} model count gap${gaps === 1 ? '' : 's'}` : 'Review inventory'}</small></span>
            <span className="cw-row-action">Edit record →</span>
          </button>;
        })}
        {!filtered.length && <div className="cw-empty"><h3>{centres.length ? 'No centres match these filters' : 'No centres yet'}</h3><p>{centres.length ? 'Try a different search, state or connection.' : 'Add a centre to begin a local record. New records start offline.'}</p>{centres.length > 0 && <button type="button" className="cw-button" onClick={() => { setQuery(''); setState(''); setConnection(''); }}>Clear centre filters</button>}</div>}
      </div>
    </section>

    {(creating || selected) && <CentreEditor key={creating ? 'new-centre' : selected.id} centre={creating ? null : selected} centres={centres} alerts={alerts} history={history} onSave={onSaveCentre} onCreate={onCreateCentre} onDirtyChange={setDirty} onClose={closeEditor} onCreated={saved => { setCreating(false); setSelectedId(saved.id); setDirty(false); }} onOpenMonitor={onOpenMonitor ? centreId => openOther(onOpenMonitor, centreId) : null} onOpenInfrastructure={onOpenInfrastructure ? centreId => openOther(onOpenInfrastructure, centreId) : null} />}
    {selectedId && !selected && !creating && <p className="cw-empty" role="status">This centre is no longer available. Select another record.</p>}
    <aside className="cw-note"><strong>Records and observations stay separate.</strong><p>Editing metadata does not change submitted attendance, camera-derived counts or connection health. A model signal is not a compliance decision.</p></aside>
  </div>;
}

function CentreEditor({ centre, centres, alerts, history, onSave, onCreate, onCreated, onDirtyChange, onClose, onOpenMonitor, onOpenInfrastructure }) {
  const creating = !centre;
  const id = useId();
  const heading = useRef(null);
  const form = useRef(null);
  // Intentionally initialize once per record ID. Parent simulation ticks must not erase drafts.
  const [draft, setDraft] = useState(() => centreDraft(centre || {}));
  const [baseline, setBaseline] = useState(() => centreDraft(centre || {}));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const dirty = creating || JSON.stringify(draft) !== JSON.stringify(baseline);
  const relatedAlerts = alerts.filter(alert => alert.centreId === centre?.id);
  const records = centreHistory(history, centre?.id).slice(0, 8);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (Object.keys(errors).length) form.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [errors]);

  function change(field, value) { setDraft(current => ({ ...current, [field]: value })); setSavedAt(null); setSaveError(''); }
  function save(event) {
    event.preventDefault();
    const result = validateCentreDraft(draft, { creating, centres, centre });
    setErrors(result.errors); setSaveError('');
    if (Object.keys(result.errors).length) return;
    try {
      if (creating) {
        const saved = requireSavedEntity(onCreate?.(buildNewCentreDraft(result.patch)));
        onCreated(saved);
      } else {
        const saved = requireSavedEntity(onSave?.(centre.id, result.patch), centre.id);
        const next = centreDraft(saved);
        setDraft(next); setBaseline(next); setSavedAt(saved.updatedAt || null);
      }
    } catch (error) { setSaveError(error.message || 'The centre could not be saved. Your changes are still unsaved.'); }
  }
  function field(name, label, options = {}) {
    const fieldId = `${id}-${name}`;
    return <label className={options.wide ? 'cw-full' : undefined} htmlFor={fieldId} key={name}>{label}{options.required && ' *'}
      {options.multiline ? <textarea id={fieldId} aria-label={label} rows={3} maxLength={2000} value={draft[name]} onChange={event => change(name, event.target.value)} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${fieldId}-error` : undefined} /> : <input id={fieldId} aria-label={label} type={options.number ? 'number' : 'text'} min={options.number ? (name === 'capacity' ? 1 : 0) : undefined} step={options.number ? 1 : undefined} maxLength={name === 'id' ? 40 : 160} required={options.required} value={draft[name]} onChange={event => change(name, event.target.value)} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${fieldId}-error` : undefined} />}
      {errors[name] && <span className="cw-field-error" id={`${fieldId}-error`}>{errors[name]}</span>}
    </label>;
  }

  return <section className="cw-panel cw-editor" aria-labelledby={`${id}-heading`}>
    <div className="cw-section-head"><div><p className="cw-eyebrow">{creating ? 'Local onboarding' : `Centre record · ${centre.id}`}</p><h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>{creating ? 'Add a training centre' : centre.name}</h2></div><button type="button" className="cw-button" onClick={onClose}>Close centre editor</button></div>
    {creating ? <p className="cw-note">New centres start offline, with no submitted attendance and no model observations. Inventory approved counts start at zero until entered in Infrastructure; no approval or verification is inferred.</p> : <>
      <dl className="cw-facts">
        <div><dt>Connection</dt><dd>{centre.connection === 'online' ? 'Online' : 'Offline'}</dd></div>
        <div><dt>Observed attendance</dt><dd>{attendanceAvailable(centre) ? centre.detected : 'Unavailable'}</dd></div>
        <div><dt>Submitted attendance</dt><dd>{centre.claimed}</dd></div>
        <div><dt>Signal source</dt><dd>{centre.source || 'Not recorded'}</dd></div>
      </dl>
      <p className="cw-muted">Record updated: {formatWorkflowTime(centre.updatedAt)}. These attendance signals are read-only here.</p>
    </>}
    <form ref={form} className="cw-form" noValidate onSubmit={save}>
      <div className="cw-form-grid">
        {creating && field('id', 'Centre ID', { required: true, wide: true })}
        {field('name', 'Centre name', { required: true, wide: true })}
        {field('city', 'City', { required: true })}{field('state', 'State', { required: true })}
        {field('course', 'Course', { required: true, wide: true })}
        {field('capacity', 'Capacity', { required: true, number: true })}{field('cameras', 'Registered cameras', { required: true, number: true })}
        {field('reviewNotes', 'Centre review notes', { multiline: true, wide: true })}
      </div>
      {Object.values(errors).some(Boolean) && <p role="alert" className="cw-error">Check the highlighted centre fields before saving.</p>}
      {saveError && <p role="alert" className="cw-error">{saveError}</p>}
      <div className="cw-form-footer">
        <span className={`cw-badge ${dirty ? 'cw-warning' : 'cw-positive'}`} role="status">{dirty ? 'Unsaved changes' : `Saved${savedAt ? ` · ${formatWorkflowTime(savedAt)}` : ''}`}</span>
        <div className="cw-actions">{!creating && <button className="cw-button" type="button" disabled={!dirty && !saveError} onClick={() => { const next = centreDraft(centre); setDraft(next); setBaseline(next); setErrors({}); setSaveError(''); setSavedAt(null); }}>Discard centre changes</button>}<button className="cw-button cw-primary" type="submit" disabled={!dirty}>{creating ? 'Create centre' : 'Save centre changes'}</button></div>
      </div>
    </form>
    {!creating && <>
      <div className="cw-actions cw-secondary-actions">{onOpenInfrastructure && <button type="button" className="cw-button" onClick={() => onOpenInfrastructure(centre.id)}>Inspect infrastructure</button>}{onOpenMonitor && <button type="button" className="cw-button" onClick={() => onOpenMonitor(centre.id)}>Open live monitor</button>}</div>
      <div className="cw-detail-grid">
        <section><h3>Centre alerts ({relatedAlerts.length})</h3>{relatedAlerts.length ? <ul className="cw-event-list">{relatedAlerts.map(alert => <li key={alert.id}><strong>{alert.type} <span className={`cw-badge ${alert.status === 'open' ? 'cw-warning' : 'cw-neutral'}`}>{alert.status}</span></strong><p>{alert.summary}</p><small>{formatWorkflowTime(alert.createdAt)}</small></li>)}</ul> : <p className="cw-muted">No alerts recorded for this centre.</p>}</section>
        <section><h3>Recent centre history</h3><WorkflowHistory records={records} empty="No saved activity recorded for this centre." /></section>
      </div>
    </>}
  </section>;
}

export function WorkflowHistory({ records, empty = 'No saved activity recorded.' }) {
  return records.length ? <ul className="cw-event-list">{records.map((entry, index) => <li key={entry.id || index}><strong>{entry.summary || entry.description || entry.action || entry.type || 'Record updated'}</strong>{entry.note && <p>{entry.note}</p>}<small>{formatWorkflowTime(entry.createdAt || entry.timestamp || entry.at)}{(entry.actor || entry.reviewedBy) ? ` · ${entry.actor || entry.reviewedBy}` : ''}</small></li>)}</ul> : <p className="cw-muted">{empty}</p>;
}
