import { useState } from 'react';
import { Check, Download, Save, Settings2, ShieldCheck, RotateCcw, AlertCircle } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../appState.js';
import './workflow-ui.css';

export default function SettingsView({ settings, centres, savedAt, onSave, onExportData }) {
  const [draft, setDraft] = useState(() => ({ ...settings, notificationPrefs: { ...settings.notificationPrefs } }));
  const [baseline, setBaseline] = useState(settings);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const externalChange = JSON.stringify(settings) !== JSON.stringify(baseline);
  const patch = values => { setDraft(value => ({ ...value, ...values })); setSaved(''); setError(''); };
  function submit(event) {
    event.preventDefault(); setError('');
    try { const result = onSave(draft); setDraft(result); setBaseline(result); setSaved(new Date().toLocaleTimeString()); }
    catch (failure) { setError(failure.message); }
  }
  const preference = (key, label, description) => <label className="wf-toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={draft[key]} onChange={event => patch({ [key]: event.target.checked })} /></label>;
  return <div className="view-stack settings-view">
    <section className="wf-info"><ShieldCheck size={19} /><div><strong>Your workspace, your preferences.</strong><p>Settings and saved work stay in this browser. No account, shared server, push notification service or live camera connection is implied.</p></div></section>
    <form onSubmit={submit} className="wf-settings-layout">
      <div className="panel wf-form-card"><div className="wf-section-head"><div><span className="small-eyebrow">Monitoring policy</span><h2>Decide what needs a review.</h2></div><Settings2 size={19} /></div>
        <label className="wf-field">Attendance mismatch threshold<input type="number" min="1" max="100" step="1" value={draft.mismatchThreshold} onChange={event => patch({ mismatchThreshold: event.target.value })} required /><small>A difference of this many people or more flags a saved register or Vision Lab result. Existing alerts still require human resolution.</small></label>
        <label className="wf-field">Default centre<select value={draft.defaultCentreId} onChange={event => patch({ defaultCentreId: event.target.value })}>{centres.map(c => <option key={c.id} value={c.id}>{c.name} · {c.city}</option>)}</select><small>Selected when you next load the workspace; does not override the centre you are inspecting now.</small></label>
        <label className="wf-field">Demo refresh interval<select value={draft.refreshIntervalSeconds} onChange={event => patch({ refreshIntervalSeconds: Number(event.target.value) })}><option value="12">Every 12 seconds</option><option value="30">Every 30 seconds</option><option value="60">Every 60 seconds</option></select><small>Updates simulated centre snapshots only. Saved real-analysis counts are never overwritten by the demo.</small></label>
        {preference('demoUpdates', 'Automatic demo updates', 'Runs the simulated camera and count refreshes. Turning this off preserves the current snapshot.')}
        {preference('lowBandwidth', 'Low-resource mode', 'Slows centre refreshes to at least 60s and renders camera motion at 5 updates/s. This is a local resource control, not a network bandwidth measurement.')}
        {preference('reducedMotion', 'Reduce motion', 'Removes decorative animation and starts the camera demo paused. Operating-system reduced-motion preferences are also respected.')}
      </div>
      <div className="wf-settings-aside"><div className="panel wf-form-card"><div className="wf-section-head"><div><span className="small-eyebrow">Notification preferences</span><h2>Keep the bell useful.</h2></div></div><p className="wf-description">Choose which future events appear in your in-app inbox. Existing notifications remain available; no emails or device permissions are used.</p>{[['alerts', 'Review alerts', 'New mismatch and field-verification requests.'], ['reports', 'Compiled reports', 'Reports successfully saved to your local archive.'], ['changes', 'Saved changes', 'Centre, register, inventory, evidence and policy updates.']].map(([key, label, detail]) => <label className="wf-toggle-row" key={key}><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={draft.notificationPrefs[key]} onChange={event => patch({ notificationPrefs: { ...draft.notificationPrefs, [key]: event.target.checked } })} /></label>)}</div>
        <div className="panel wf-form-card"><span className="small-eyebrow">Local data</span><h2>Portable, not cloud-synced.</h2><p className="wf-description">Export a JSON backup of your current counts, notes, settings, reports and activity. Raw footage and temporary tracking IDs are never included.</p><button type="button" className="button button-secondary" onClick={onExportData}><Download size={15} /> Export local backup</button><p className="wf-description">Last browser save: {savedAt ? new Date(savedAt).toLocaleString() : 'No changes saved yet'}<br />Retention: latest 20 reports, 500 activity entries and 100 notifications. Browser data can be cleared by the user.</p></div>
      </div>
      <div className="wf-save-bar">{externalChange && <p className="wf-warning"><AlertCircle size={15} /> Saved preferences changed outside this form. <button type="button" onClick={() => { setDraft(settings); setBaseline(settings); setSaved(''); }}>Reload saved settings</button></p>}{error && <p className="wf-error" role="alert">{error}</p>}<div><span className={`wf-save-status ${saved && !dirty ? 'is-saved' : ''}`} role="status">{dirty ? 'Unsaved changes' : saved ? <><Check size={15} /> Saved locally at {saved}</> : 'All settings up to date'}</span><div className="wf-actions"><button type="button" className="button button-secondary" onClick={() => patch({ ...DEFAULT_SETTINGS, defaultCentreId: centres[0].id, notificationPrefs: { ...DEFAULT_SETTINGS.notificationPrefs } })}><RotateCcw size={14} /> Restore defaults</button><button type="submit" className="button button-primary" disabled={!dirty || externalChange}><Save size={15} /> Save settings</button></div></div></div>
    </form>
  </div>;
}
