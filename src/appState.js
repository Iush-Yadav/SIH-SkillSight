import { makeInitialState } from './data.js';

export const STORAGE_KEY = 'skillsight-state';
export const DEFAULT_SETTINGS = {
  mismatchThreshold: 10, refreshIntervalSeconds: 12, lowBandwidth: false,
  demoUpdates: true, reducedMotion: false, defaultCentreId: 'TC-UP-001',
  notificationPrefs: { alerts: true, reports: true, changes: true },
};
export const stamp = () => new Date().toISOString();
export const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const integer = (value, min, max, name) => {
  assert(value !== '' && value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max, `${name} must be a whole number from ${min} to ${max}.`);
  return Number(value);
};
const text = (value, name, max = 160) => {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${name} is required (up to ${max} characters).`);
  return value.trim();
};

export function normalizeState(saved) {
  const fresh = makeInitialState();
  if (!saved) saved = fresh;
  assert(Array.isArray(saved.centers) && saved.centers.length > 0 && saved.centers.every(c => c.id && typeof c.name === 'string' && Array.isArray(c.inventory)), 'Saved centre data is not valid. Your original storage has not been overwritten.');
  const settings = { ...DEFAULT_SETTINGS, ...saved.settings, notificationPrefs: { ...DEFAULT_SETTINGS.notificationPrefs, ...saved.settings?.notificationPrefs } };
  if (!saved.centers.some(c => c.id === settings.defaultCentreId)) settings.defaultCentreId = saved.centers[0].id;
  const alerts = Array.isArray(saved.alerts) ? saved.alerts : [];
  return { ...saved, schemaVersion: 2, dataRevision: Number.isSafeInteger(saved.dataRevision) ? saved.dataRevision : 0,
    centers: saved.centers.map(c => ({ ...c, observedAt: c.observedAt || c.updatedAt, reviewNotes: c.reviewNotes || '', inventory: c.inventory.map(item => ({ reviewStatus: 'unreviewed', verifiedCount: null, reviewNote: '', ...item })) })),
    alerts, settings, history: Array.isArray(saved.history) ? saved.history : [], reports: Array.isArray(saved.reports) ? saved.reports : [], evidence: Array.isArray(saved.evidence) ? saved.evidence : [],
    notifications: Array.isArray(saved.notifications) ? saved.notifications : alerts.filter(a => a.status === 'open').map(a => ({ id: `notification-${a.id}`, type: 'alerts', title: a.type, message: a.summary, createdAt: a.createdAt, readAt: null, target: { view: 'alerts', centreId: a.centreId, alertId: a.id } })),
  };
}

export function loadState(storage) {
  try { return { state: normalizeState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null')), error: '' }; }
  catch (error) { return { state: normalizeState(null), error: `Local data could not be loaded: ${error.message}. A temporary demo is shown; export any recoverable browser data before saving over it.` }; }
}

export function persistState(storage, next) {
  const saved = { ...next, savedAt: stamp() };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
  catch { throw new Error('Could not save to this browser. Storage may be full or blocked. Your change was not applied; free storage and retry.'); }
  return saved;
}

export function addNotification(state, type, title, message, target) {
  if (!state.settings.notificationPrefs[type]) return state;
  return { ...state, notifications: [{ id: uid('NTF'), type, title, message, target, readAt: null, createdAt: stamp() }, ...state.notifications].slice(0, 100) };
}

function record(state, { type, summary, centreId, itemId, before, after, target, category = 'changes', title = 'Change saved', revision = true }) {
  const entry = { id: uid('EVT'), type, summary, centreId, itemId, before, after, createdAt: stamp(), actor: 'Ananya Rao · demo reviewer' };
  const next = { ...state, dataRevision: state.dataRevision + (revision ? 1 : 0), history: [entry, ...state.history].slice(0, 500) };
  return addNotification(next, category, title, summary, target || { view: 'centres', centreId });
}
function centreAt(state, id) { const c = state.centers.find(item => item.id === id); assert(c, 'This centre no longer exists.'); return c; }
function replaceCentre(state, centre) { return { ...state, centers: state.centers.map(c => c.id === centre.id ? centre : c) }; }

export function validateSettings(draft, centers) {
  const next = { ...DEFAULT_SETTINGS, ...draft };
  next.mismatchThreshold = integer(next.mismatchThreshold, 1, 100, 'Mismatch threshold');
  next.refreshIntervalSeconds = integer(next.refreshIntervalSeconds, 12, 60, 'Refresh interval');
  assert([12, 30, 60].includes(next.refreshIntervalSeconds), 'Choose a refresh interval of 12, 30 or 60 seconds.');
  for (const key of ['lowBandwidth', 'demoUpdates', 'reducedMotion']) assert(typeof next[key] === 'boolean', `Invalid ${key} preference.`);
  assert(centers.some(c => c.id === next.defaultCentreId), 'Choose an existing default centre.');
  assert(next.notificationPrefs && ['alerts', 'reports', 'changes'].every(key => typeof next.notificationPrefs[key] === 'boolean'), 'Choose valid notification preferences.');
  return { mismatchThreshold: next.mismatchThreshold, refreshIntervalSeconds: next.refreshIntervalSeconds, lowBandwidth: next.lowBandwidth, demoUpdates: next.demoUpdates, reducedMotion: next.reducedMotion, defaultCentreId: next.defaultCentreId, notificationPrefs: { ...next.notificationPrefs } };
}
export function saveSettings(state, draft) {
  const settings = validateSettings(draft, state.centers);
  if (JSON.stringify(state.settings) === JSON.stringify(settings)) return state;
  return reconcileMismatches(record({ ...state, settings }, { type: 'settings', title: 'Settings saved', summary: 'Monitoring, presentation and notification preferences updated on this browser.', before: state.settings, after: settings, target: { view: 'settings' } }));
}

export function saveCentre(state, id, patch) {
  const old = centreAt(state, id);
  const next = { ...old };
  for (const key of ['name', 'city', 'state', 'course']) if (key in patch) next[key] = text(patch[key], key);
  if ('capacity' in patch) next.capacity = integer(patch.capacity, 1, 1000, 'Capacity');
  if ('cameras' in patch) next.cameras = integer(patch.cameras, 0, 32, 'Camera count');
  assert(next.capacity >= Math.max(old.claimed, old.detected || 0), 'Capacity cannot be below the current register or observed count.');
  if ('reviewNotes' in patch) { assert(typeof patch.reviewNotes === 'string' && patch.reviewNotes.length <= 2000, 'Review notes must be at most 2,000 characters.'); next.reviewNotes = patch.reviewNotes.trim(); }
  if (JSON.stringify(old) === JSON.stringify(next)) return state;
  next.updatedAt = stamp(); next.metadataUpdatedAt = next.updatedAt;
  return record(replaceCentre(state, next), { type: 'centre-update', title: 'Centre details saved', summary: `${next.name}: profile and review notes updated.`, centreId: id, before: old, after: next });
}
export function createCentre(state, draft) {
  const id = draft.id ? text(draft.id, 'Centre ID', 40).toUpperCase() : `TC-LOCAL-${String(state.centers.length + 1).padStart(3, '0')}`;
  assert(/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(id), 'Centre ID must be 3–40 letters, digits, underscores or hyphens.');
  assert(!state.centers.some(c => c.id.toUpperCase() === id), 'This centre ID already exists.');
  assert(typeof (draft.reviewNotes ?? '') === 'string' && (draft.reviewNotes || '').length <= 2000, 'Review notes must be at most 2,000 characters.');
  const capacity = integer(draft.capacity, 1, 1000, 'Capacity');
  const centre = { id, name: text(draft.name, 'Centre name'), city: text(draft.city, 'City'), state: text(draft.state, 'State'), course: text(draft.course, 'Course'), capacity,
    cameras: integer(draft.cameras ?? 0, 0, 32, 'Camera count'), claimed: 0, detected: null, connection: 'offline', source: 'manual-onboarding', updatedAt: stamp(), observedAt: null, reviewNotes: (draft.reviewNotes || '').trim(),
    inventory: makeInitialState().centers[0].inventory.map(item => ({ id: item.id, name: item.name, icon: item.icon, approved: 0, detected: null, operability: 'Unknown', verifiedCount: null, reviewStatus: 'unreviewed', reviewNote: '' })),
  };
  return record({ ...state, centers: [...state.centers, centre] }, { type: 'centre-created', title: 'Centre added', summary: `${centre.name} added locally. No camera or observed count is connected.`, centreId: id, after: centre });
}

function mismatchAlert(state, centre, evidence) {
  if (centre.detected === null || Math.abs(centre.claimed - centre.detected) < state.settings.mismatchThreshold) return state;
  const summary = `${Math.abs(centre.claimed - centre.detected)}-person difference at ${centre.name}. Human review required.`;
  const existing = state.alerts.find(a => a.centreId === centre.id && a.type === 'Attendance mismatch' && a.status === 'open');
  if (existing) return { ...state, alerts: state.alerts.map(a => a.id === existing.id ? { ...a, summary, evidence, updatedAt: stamp() } : a) };
  const alert = { id: uid('ALT'), centreId: centre.id, centreName: centre.name, type: 'Attendance mismatch', severity: 'high', summary, evidence, status: 'open', createdAt: stamp() };
  return addNotification({ ...state, alerts: [alert, ...state.alerts] }, 'alerts', alert.type, summary, { view: 'alerts', alertId: alert.id, centreId: centre.id });
}
export function saveRegister(state, centreId, claimed) {
  const old = centreAt(state, centreId);
  const count = integer(claimed, 0, old.capacity, 'Submitted attendance');
  if (count === old.claimed) return state;
  const next = { ...old, claimed: count, registerUpdatedAt: stamp() };
  return mismatchAlert(record(replaceCentre(state, next), { type: 'register', title: 'Register saved', summary: `${old.name}: submitted attendance changed from ${old.claimed} to ${count}.`, centreId, before: { claimed: old.claimed }, after: { claimed: count }, target: { view: 'live', centreId } }), next, 'Saved register compared with latest observation');
}
export function saveVision(state, centreId, result) {
  const old = centreAt(state, centreId);
  const persons = integer(result.persons, 0, 10000, 'Detected people');
  const claimed = old.claimed; // An observation must never edit the submitted register.
  const chairs = integer(result.chairs, 0, 10000, 'Detected chairs');
  const inventory = result.applyChairs === true ? old.inventory.map(item => item.id === 'seating' ? { ...item, detected: chairs, source: 'local-ai', observedAt: result.timestamp || stamp() } : item) : old.inventory;
  const next = { ...old, inventory, detected: persons, claimed, source: 'local-ai', observedAt: result.timestamp || stamp(), updatedAt: stamp(), analysis: { persons, chairs, timestamp: result.timestamp || stamp(), source: 'coco-ssd' } };
  return mismatchAlert(record(replaceCentre(state, next), { type: 'analysis', title: 'Local analysis saved', summary: `${old.name}: ${persons} visible people and ${chairs} chairs in a locally analysed frame. No media or track IDs saved.`, centreId, before: { detected: old.detected, claimed: old.claimed }, after: next.analysis, target: { view: 'live', centreId } }), next, 'Browser-local COCO-SSD count; not verified attendance');
}

export function saveInventory(state, centreId, itemId, patch) {
  const centre = centreAt(state, centreId);
  const old = centre.inventory.find(item => item.id === itemId);
  assert(old, 'Inventory item not found.');
  const next = { ...old, approved: integer(patch.approved ?? old.approved, 0, 10000, 'Approved count'), operability: patch.operability ?? old.operability };
  assert(['Unknown', 'Operational', 'Needs maintenance', 'Out of service'].includes(next.operability), 'Choose a valid operability status.');
  const verification = Object.hasOwn(patch, 'verifiedCount') ? patch.verifiedCount : old.verifiedCount;
  next.verifiedCount = verification === null || verification === '' ? null : integer(verification, 0, 10000, 'Human-verified count');
  next.reviewNote = text(patch.reviewNote, 'Review note', 2000);
  next.reviewStatus = 'reviewed'; next.reviewedAt = stamp();
  const updated = { ...centre, inventory: centre.inventory.map(item => item.id === itemId ? next : item), updatedAt: stamp() };
  return record(replaceCentre(state, updated), { type: 'inventory-review', title: 'Inventory review saved', summary: `${centre.name} · ${old.name}: human review saved. Visual count remains unchanged.`, centreId, itemId, before: old, after: next, target: { view: 'infrastructure', centreId, itemId } });
}
export function requestVerification(state, centreId, itemId) {
  const centre = centreAt(state, centreId);
  const item = centre.inventory.find(i => i.id === itemId);
  assert(item, 'Inventory item not found.');
  if (item.reviewStatus === 'requested') return state;
  const next = { ...item, reviewStatus: 'requested', verificationRequestedAt: stamp() };
  const updated = { ...centre, inventory: centre.inventory.map(i => i.id === itemId ? next : i) };
  const alert = { id: uid('ALT'), centreId, centreName: centre.name, itemId, type: 'Infrastructure verification', severity: 'medium', summary: `${item.name}: field verification requested for ${centre.name}.`, evidence: 'Local reviewer request; no external message sent', status: 'open', createdAt: stamp() };
  let changed = record(replaceCentre(state, updated), { type: 'verification-request', title: 'Verification requested', summary: alert.summary, centreId, itemId, after: next, target: { view: 'infrastructure', centreId, itemId } });
  if (!changed.alerts.some(a => a.centreId === centreId && a.itemId === itemId && a.type === alert.type && a.status === 'open')) {
    changed = addNotification({ ...changed, alerts: [alert, ...changed.alerts] }, 'alerts', alert.type, alert.summary, { view: 'alerts', alertId: alert.id, centreId });
  }
  return changed;
}
export function resolveAlert(state, id) {
  const alert = state.alerts.find(a => a.id === id);
  assert(alert, 'Alert no longer exists.');
  if (alert.status === 'resolved') return state;
  return record({ ...state, alerts: state.alerts.map(a => a.id === id ? { ...a, status: 'resolved', resolvedAt: stamp(), resolvedBy: 'Ananya Rao · demo reviewer' } : a) }, { type: 'alert-resolved', title: 'Alert resolved', summary: `${alert.type} at ${alert.centreName} marked reviewed. No automatic compliance decision.`, centreId: alert.centreId, before: { status: 'open' }, after: { status: 'resolved' }, target: { view: 'alerts', alertId: id, centreId: alert.centreId } });
}
export function captureEvidence(state, centreId) {
  const centre = centreAt(state, centreId);
  return clone({ id: uid('EVD'), capturedAt: stamp(), sourceRevision: state.dataRevision, centre, threshold: state.settings.mismatchThreshold, alerts: state.alerts.filter(a => a.centreId === centreId), history: state.history.filter(e => e.centreId === centreId).slice(0, 20), limitation: 'Count summary only. No media, biometric identity or track IDs. Simulated counts and local-analysis results are not verified attendance.' });
}
export function saveEvidence(state, snapshot, note) {
  centreAt(state, snapshot.centre.id);
  assert(!state.evidence.some(e => e.id === snapshot.id), 'This snapshot is already saved. Capture a fresh snapshot for another review.');
  const saved = clone({ ...snapshot, reviewNote: text(note, 'Evidence review note', 2000), savedAt: stamp(), reviewer: 'Ananya Rao · demo reviewer' });
  return record({ ...state, evidence: [saved, ...state.evidence].slice(0, 20) }, { type: 'evidence-note', title: 'Evidence snapshot saved', summary: saved.reviewNote, centreId: snapshot.centre.id, after: { evidenceId: saved.id, capturedAt: saved.capturedAt }, target: { view: 'live', centreId: snapshot.centre.id, evidenceId: saved.id } });
}
export function storeReport(state, report) {
  assert(report && report.id && report.sourceRevision === state.dataRevision, 'Report source changed. Compile again.');
  return record({ ...state, reports: [clone(report), ...state.reports].slice(0, 20) }, { type: 'report-compiled', title: 'Report compiled', summary: `A dated report snapshot was compiled and saved locally (${report.id}).`, after: { reportId: report.id }, target: { view: 'reports', reportId: report.id }, category: 'reports', revision: false });
}
export function markNotifications(state, ids, read = true) {
  return { ...state, notifications: state.notifications.map(n => ids.includes(n.id) ? { ...n, readAt: read ? stamp() : null } : n) };
}
export function simulateTick(state, random = Math.random) {
  if (!state.settings.demoUpdates) return state;
  let changed = false;
  const centers = state.centers.map(c => {
    if (c.connection !== 'online' || c.source !== 'simulation' || c.detected === null) return c;
    const detected = Math.max(0, Math.min(c.capacity, c.detected + (random() > .5 ? 1 : -1)));
    if (detected === c.detected) return c;
    changed = true;
    return { ...c, detected, observedAt: stamp(), updatedAt: stamp() };
  });
  return changed ? reconcileMismatches({ ...state, centers, dataRevision: state.dataRevision + 1 }) : state;
}

function reconcileMismatches(state) {
  return state.centers.reduce((next, centre) => mismatchAlert(next, centre, centre.source === 'local-ai' ? 'Saved local AI observation; human review required' : 'Simulated observation; human review required'), state);
}
