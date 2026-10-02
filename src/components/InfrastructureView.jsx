import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  centreHistory, filterInventory, formatWorkflowTime, inventoryDraft, inventorySignal,
  OPERABILITY_OPTIONS, requireSavedEntity, validateInventoryDraft,
} from '../centreForms.js';
import { WorkflowHistory } from './CentresView.jsx';
import './centre-workflows.css';

/** Save/request callbacks return the persisted inventory item synchronously, or throw. */
export default function InfrastructureView({ centres = [], history = [], focusCentreId = null, focusItemId = null, onSaveInventory, onRequestVerification, onOpenMonitor }) {
  const id = useId();
  const [centreId, setCentreId] = useState(focusCentreId || '');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => focusCentreId && focusItemId ? { centreId: focusCentreId, itemId: focusItemId } : null);
  const [dirty, setDirty] = useState(false);
  const centreSelect = useRef(null);
  const entries = useMemo(() => filterInventory(centres, { centreId, filter, query }), [centres, centreId, filter, query]);
  const allEntries = useMemo(() => filterInventory(centres), [centres]);
  const activeCentre = centres.find(centre => centre.id === selected?.centreId);
  const activeItem = activeCentre?.inventory?.find(item => item.id === selected?.itemId);
  const groups = centres.map(centre => ({ centre, items: entries.filter(entry => entry.centre.id === centre.id).map(entry => entry.item) })).filter(group => group.items.length);

  useEffect(() => {
    if (focusCentreId) { setCentreId(focusCentreId); setSelected(focusItemId ? { centreId: focusCentreId, itemId: focusItemId } : null); setDirty(false); setFilter('all'); setQuery(''); }
  }, [focusCentreId, focusItemId]);

  function mayLeave() { return !dirty || window.confirm('Discard unsaved inventory changes?'); }
  function chooseCentre(next) {
    if (next === centreId) return;
    if (!mayLeave()) return;
    setCentreId(next); setSelected(null); setDirty(false);
  }
  function chooseItem(centre, item) {
    if (selected?.centreId === centre.id && selected?.itemId === item.id) return;
    if (!mayLeave()) return;
    setSelected({ centreId: centre.id, itemId: item.id }); setDirty(false);
  }

  return <div className="cw-workflow" aria-label="Infrastructure workspace">
    <dl className="cw-summary">
      <div><dt>Inventory records</dt><dd>{allEntries.length}</dd><small>Not a compliance score</small></div>
      <div><dt>Model count gaps</dt><dd>{allEntries.filter(({ centre, item }) => inventorySignal(centre, item).kind === 'gap').length}</dd><small>Requires human context</small></div>
      <div><dt>Offline / unknown</dt><dd>{allEntries.filter(({ centre, item }) => inventorySignal(centre, item).kind === 'unknown').length}</dd><small>No current observation</small></div>
      <div><dt>Pending verification</dt><dd>{allEntries.filter(({ item }) => item.reviewStatus === 'requested').length}</dd><small>Persisted review requests</small></div>
    </dl>
    <section className="cw-panel">
      <div className="cw-section-head"><div><p className="cw-eyebrow">Inventory reconciliation</p><h2>Infrastructure inventory</h2><p className="cw-muted">Select an asset to review approved, model-detected and human-verified counts separately.</p></div></div>
      <div className="cw-toolbar">
        <label className="cw-search" htmlFor={`${id}-centre`}>Inventory centre<select ref={centreSelect} id={`${id}-centre`} aria-label="Inventory centre" value={centreId} onChange={event => chooseCentre(event.target.value)}><option value="">All centres</option>{centres.map(centre => <option key={centre.id} value={centre.id}>{centre.name} · {centre.id}</option>)}</select></label>
        <label htmlFor={`${id}-filter`}>Inventory status<select id={`${id}-filter`} aria-label="Inventory status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All inventory</option><option value="gaps">Model count gaps</option><option value="offline">Offline / unknown</option><option value="pending">Pending verification</option></select></label>
        <label className="cw-search" htmlFor={`${id}-query`}>Search inventory<input id={`${id}-query`} type="search" value={query} placeholder="Asset or centre" onChange={event => setQuery(event.target.value)} /></label>
      </div>
      <p className="cw-result-count" role="status">{entries.length} inventory record{entries.length === 1 ? '' : 's'} in view</p>
      {groups.map(({ centre, items }) => <section className="cw-inventory-group" key={centre.id} aria-label={`${centre.name} inventory`}>
        <button className="cw-group-heading" type="button" onClick={() => chooseCentre(centre.id)} aria-label={`Show inventory for ${centre.name}`}><span><strong>{centre.name}</strong><small>{centre.id} · {centre.city}</small></span><span className={`cw-badge ${centre.connection === 'online' ? 'cw-positive' : 'cw-neutral'}`}>{centre.connection === 'online' ? 'Online' : 'Offline'}</span></button>
        <div className="cw-inventory-grid">{items.map(item => {
          const signal = inventorySignal(centre, item);
          const requested = item.reviewStatus === 'requested';
          return <button key={item.id} type="button" className={`cw-inventory-card ${selected?.centreId === centre.id && selected?.itemId === item.id ? 'cw-selected' : ''}`} onClick={() => chooseItem(centre, item)} aria-label={`Review ${item.name} at ${centre.name}`} aria-pressed={selected?.centreId === centre.id && selected?.itemId === item.id}>
            <strong>{item.name}</strong>
            <span className={`cw-badge ${signal.kind === 'gap' ? 'cw-warning' : 'cw-neutral'}`}>{signal.label}</span>
            <span className="cw-counts"><span><small>Approved</small><b>{item.approved}</b></span><span><small>Model detected</small><b>{signal.count ?? 'Unknown'}</b></span><span><small>Human verified</small><b>{item.verifiedCount ?? 'Not verified'}</b></span></span>
            <span className="cw-card-meta">Operability: {item.operability || 'Unknown'}</span>
            <span className={`cw-review-state ${requested ? 'cw-requested' : ''}`}>{requested ? 'Requested' : item.reviewStatus === 'reviewed' || item.reviewStatus === 'verified' ? 'Reviewed' : 'Unreviewed'}{requested ? ` · ${formatWorkflowTime(item.verificationRequestedAt)}` : ''}</span>
            <span className="cw-row-action">Inspect inventory →</span>
          </button>;
        })}</div>
      </section>)}
      {!entries.length && <div className="cw-empty"><h3>{allEntries.length ? 'No inventory matches these filters' : 'No inventory records yet'}</h3><p>{allEntries.length ? 'Try another centre or status. Pending shows only saved verification requests.' : 'Add a centre in Training centres to start an inventory record.'}</p>{allEntries.length > 0 && <button className="cw-button" type="button" onClick={() => { if (mayLeave()) { setCentreId(''); setFilter('all'); setQuery(''); setSelected(null); setDirty(false); } }}>Clear inventory filters</button>}</div>}
    </section>
    {activeCentre && activeItem && <InventoryEditor key={`${activeCentre.id}:${activeItem.id}`} centre={activeCentre} item={activeItem} history={history} onSave={onSaveInventory} onRequest={onRequestVerification} onDirtyChange={setDirty} onClose={() => { if (mayLeave()) { setSelected(null); setDirty(false); centreSelect.current?.focus(); } }} onOpenMonitor={onOpenMonitor ? centre => { if (mayLeave()) onOpenMonitor(centre); } : null} />}
    {selected && !activeItem && <p className="cw-empty" role="status">The selected inventory record is no longer available.</p>}
    <aside className="cw-note"><strong>Operability is not inferred from appearance.</strong><p>Visible counts cannot confirm that equipment works or is safe. Offline or unknown observations are not a pass or a failure. Human verification requires a review note and remains separate from model output.</p></aside>
  </div>;
}

function InventoryEditor({ centre, item, history, onSave, onRequest, onDirtyChange, onClose, onOpenMonitor }) {
  const id = useId();
  const heading = useRef(null);
  const form = useRef(null);
  const [draft, setDraft] = useState(() => inventoryDraft(item));
  const [baseline, setBaseline] = useState(() => inventoryDraft(item));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const review = confirmation || item;
  const requested = review.reviewStatus === 'requested';
  const signal = inventorySignal(centre, item);
  const records = centreHistory(history, centre.id, item.id).slice(0, 8);
  const reviewStatus = requested ? 'Requested' : review.reviewStatus === 'reviewed' || review.reviewStatus === 'verified' ? 'Reviewed' : 'Unreviewed';

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (Object.keys(errors).length) form.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [errors]);

  function change(field, value) { setDraft(current => ({ ...current, [field]: value })); setSaveError(''); }
  function save(event) {
    event.preventDefault();
    const result = validateInventoryDraft(draft);
    setErrors(result.errors); setSaveError('');
    if (Object.keys(result.errors).length) return;
    try {
      const saved = requireSavedEntity(onSave?.(centre.id, item.id, result.patch), item.id);
      const next = inventoryDraft(saved);
      setDraft(next); setBaseline(next); setConfirmation(saved);
    } catch (error) { setSaveError(error.message || 'The inventory could not be saved. Your changes are still unsaved.'); }
  }
  function request() {
    if (requested || dirty) return;
    try {
      const saved = requireSavedEntity(onRequest?.(centre.id, item.id), item.id);
      if (saved.reviewStatus !== 'requested' || !saved.verificationRequestedAt) throw new Error('The verification request was not confirmed. Please try again.');
      setConfirmation(saved); setSaveError('');
    } catch (error) { setSaveError(error.message || 'Verification could not be requested. Please try again.'); }
  }
  const errorProps = field => ({ 'aria-invalid': !!errors[field], 'aria-describedby': [field === 'verifiedCount' ? `${id}-verified-help` : field === 'reviewNote' ? `${id}-note-help` : '', errors[field] ? `${id}-${field}-error` : ''].filter(Boolean).join(' ') || undefined });
  const fieldError = field => errors[field] && <span className="cw-field-error" id={`${id}-${field}-error`}>{errors[field]}</span>;

  return <section className="cw-panel cw-editor" aria-labelledby={`${id}-heading`}>
    <div className="cw-section-head"><div><p className="cw-eyebrow">Human review · {centre.id}</p><h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>{item.name} review</h2><p className="cw-muted">{centre.name}</p></div><button type="button" className="cw-button" onClick={onClose}>Close inventory editor</button></div>
    <dl className="cw-facts">
      <div><dt>Current model observation</dt><dd>{signal.count ?? 'Unavailable'}</dd></div>
      <div><dt>Signal status</dt><dd>{signal.label}</dd></div>
      <div><dt>Review status</dt><dd>{reviewStatus}</dd></div>
      <div><dt>Last human review</dt><dd>{formatWorkflowTime(review.reviewedAt)}</dd></div>
    </dl>
    {signal.count === null && Number.isFinite(item.detected) && <p className="cw-muted">Last stored model count: {item.detected}. This is not a current observation while the centre is offline.</p>}
    <p className="cw-muted">Observation source: {item.source === 'local-ai' ? 'Saved local AI frame (full seating view confirmed)' : 'Synthetic demonstration'}. Model-detected counts are read-only. Human verification never replaces them.</p>
    <div className="cw-request-row">
      <div><strong>{requested ? 'Verification requested' : 'Need a field inspection?'}</strong><p className="cw-muted">{requested ? `Requested · ${formatWorkflowTime(review.verificationRequestedAt)}` : 'Request a human check without declaring the asset verified.'}</p>{!requested && review.verificationRequestedAt && <p className="cw-muted">Previous request: {formatWorkflowTime(review.verificationRequestedAt)}</p>}</div>
      <button type="button" className="cw-button" disabled={requested || dirty} onClick={request}>{requested ? 'Requested' : 'Request verification'}</button>
    </div>
    {dirty && !requested && <p className="cw-muted">Save or discard your draft before requesting verification.</p>}
    <form ref={form} className="cw-form" noValidate onSubmit={save}>
      <div className="cw-form-grid">
        <label htmlFor={`${id}-approved`}>Approved count *<input id={`${id}-approved`} aria-label="Approved count" type="number" min="0" step="1" required value={draft.approved} onChange={event => change('approved', event.target.value)} {...errorProps('approved')} />{fieldError('approved')}</label>
        <label htmlFor={`${id}-verifiedCount`}>Human verified count<input id={`${id}-verifiedCount`} aria-label="Human verified count" type="number" min="0" step="1" value={draft.verifiedCount} onChange={event => change('verifiedCount', event.target.value)} {...errorProps('verifiedCount')} /><small id={`${id}-verified-help`}>Leave blank if no human count is available. Zero is a verified count.</small>{fieldError('verifiedCount')}</label>
        <label className="cw-full" htmlFor={`${id}-operability`}>Operability<select id={`${id}-operability`} aria-label="Operability" value={draft.operability} onChange={event => change('operability', event.target.value)} {...errorProps('operability')}>{OPERABILITY_OPTIONS.map(value => <option key={value}>{value}</option>)}</select>{fieldError('operability')}</label>
        <label className="cw-full" htmlFor={`${id}-reviewNote`}>Human-review note *<textarea id={`${id}-reviewNote`} aria-label="Human-review note" rows={4} maxLength={2000} required value={draft.reviewNote} onChange={event => change('reviewNote', event.target.value)} {...errorProps('reviewNote')} /><small id={`${id}-note-help`}>Required for every update. Describe the records, inspection context or uncertainty behind this review.</small>{fieldError('reviewNote')}</label>
      </div>
      {Object.keys(errors).length > 0 && <p className="cw-error" role="alert">Check the highlighted inventory fields before saving.</p>}
      {saveError && <p className="cw-error" role="alert">{saveError}</p>}
      <div className="cw-form-footer"><span role="status" className={`cw-badge ${dirty ? 'cw-warning' : 'cw-positive'}`}>{dirty ? 'Unsaved changes' : 'Saved'}{!dirty && requested ? ' · Requested' : ''}</span><div className="cw-actions"><button type="button" className="cw-button" disabled={!dirty && !saveError} onClick={() => { const next = inventoryDraft(item); setDraft(next); setBaseline(next); setErrors({}); setSaveError(''); }}>Discard inventory changes</button><button type="submit" className="cw-button cw-primary" disabled={!dirty}>Save inventory review</button></div></div>
    </form>
    <div className="cw-secondary-actions">{onOpenMonitor && <button type="button" className="cw-button" onClick={() => onOpenMonitor(centre.id)}>Open live monitor</button>}</div>
    <section><h3>Recent inventory history</h3><WorkflowHistory records={records} empty="No saved activity recorded for this inventory item." /></section>
  </section>;
}
