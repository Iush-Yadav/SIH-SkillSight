import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInitialState } from '../src/data.js';
import { STORAGE_KEY, normalizeState, loadState, persistState, saveSettings, saveCentre, createCentre, saveRegister, saveInventory, requestVerification, resolveAlert, captureEvidence, saveEvidence, storeReport, markNotifications, simulateTick, saveVision } from '../src/appState.js';
import { centresCsv } from '../src/download.js';
const initial = () => normalizeState(makeInitialState());

test('legacy workspace migration preserves saved counts and notes while adding feature defaults', () => {
  const saved = makeInitialState(); saved.centers[0].claimed = 37; saved.centers[0].reviewNotes = 'Keep this note';
  const state = normalizeState(saved);
  assert.equal(state.centers[0].claimed, 37); assert.equal(state.centers[0].reviewNotes, 'Keep this note');
  assert.equal(state.settings.mismatchThreshold, 10); assert.equal(state.settings.refreshIntervalSeconds, 12);
  assert.equal(state.notifications.length, 3); assert.deepEqual(state.reports, []); assert.deepEqual(state.evidence, []);
  assert.equal(state.centers[0].inventory[0].verifiedCount, null);
  const reloaded = normalizeState(state); assert.deepEqual(reloaded.notifications, state.notifications);
});

test('save writes survive reload; storage failures throw without reporting a committed state', () => {
  const map = new Map(); const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const state = saveRegister(initial(), 'TC-UP-001', 35);
  const saved = persistState(storage, state);
  assert.equal(loadState(storage).state.centers[0].claimed, 35);
  assert.ok(saved.savedAt); assert.ok(map.has(STORAGE_KEY));
  const bad = { setItem() { throw new Error('quota'); } };
  assert.throws(() => persistState(bad, state), /not applied/); assert.equal(state.savedAt, undefined);
  const corrupt = loadState({ getItem: () => '{broken' });
  assert.ok(corrupt.error); assert.equal(corrupt.state.centers.length, 12);
});

test('settings validate real controls and disabling notifications only suppresses future chosen categories', () => {
  let state = initial();
  assert.throws(() => saveSettings(state, { ...state.settings, mismatchThreshold: 0 }), /threshold/);
  assert.throws(() => saveSettings(state, { ...state.settings, refreshIntervalSeconds: 15 }), /12, 30 or 60/);
  assert.throws(() => saveSettings(state, { ...state.settings, defaultCentreId: 'missing' }), /existing/);
  const oldNotificationCount = state.notifications.length;
  state = saveSettings(state, { ...state.settings, demoUpdates: false, notificationPrefs: { alerts: true, reports: false, changes: false } });
  assert.equal(state.notifications.length, oldNotificationCount);
  assert.equal(simulateTick(state), state);
  const updated = saveCentre(state, 'TC-UP-001', { reviewNotes: 'Save quietly' });
  assert.equal(updated.notifications.length, oldNotificationCount);
  assert.ok(updated.history.some(e => e.type === 'centre-update'));
});

test('register saves validate capacity, preserve observation source, and apply configured mismatch threshold', () => {
  let state = initial();
  for (const value of ['', -1, 2.5, 49]) assert.throws(() => saveRegister(state, 'TC-UP-001', value), /Submitted attendance/);
  assert.equal(saveRegister(state, 'TC-UP-001', 40), state);
  state = saveSettings(state, { ...state.settings, mismatchThreshold: 3 });
  const saved = saveRegister(state, 'TC-RJ-002', 39);
  assert.equal(saved.centers[1].claimed, 39); assert.equal(saved.centers[1].source, 'simulation');
  assert.equal(saved.alerts.filter(a => a.centreId === 'TC-RJ-002' && a.type === 'Attendance mismatch').length, 1);
  const again = saveRegister(saved, 'TC-RJ-002', 40);
  assert.equal(again.alerts.filter(a => a.centreId === 'TC-RJ-002' && a.type === 'Attendance mismatch').length, 1);
  const offline = saveRegister(state, 'TC-RJ-008', 45);
  assert.ok(!offline.alerts.some(a => a.centreId === 'TC-RJ-008'));
});

test('centre profile editing cannot spoof inferred counts; onboarding has no fake connection', () => {
  const state = initial();
  const updated = saveCentre(state, 'TC-UP-001', { name: 'Updated centre', detected: 99, source: 'spoofed', reviewNotes: 'Visit planned' });
  assert.equal(updated.centers[0].detected, 28); assert.equal(updated.centers[0].source, 'simulation');
  assert.throws(() => saveCentre(state, 'TC-UP-001', { capacity: 20 }), /below/);
  const created = createCentre(state, { id: 'TC-DEMO-999', name: 'New centre', city: 'Pune', state: 'Maharashtra', course: 'IT', capacity: 30, cameras: 2 });
  const centre = created.centers.at(-1);
  assert.equal(centre.connection, 'offline'); assert.equal(centre.detected, null);
  assert.ok(centre.inventory.every(i => i.detected === null && i.verifiedCount === null));
  assert.throws(() => createCentre(created, { ...centre }), /already exists/);
});

test('verification requests deduplicate and inventory review keeps visual counts separate from human findings', () => {
  const state = initial();
  const requested = requestVerification(state, 'TC-UP-001', 'computers');
  assert.equal(requested.centers[0].inventory[2].reviewStatus, 'requested');
  assert.equal(requestVerification(requested, 'TC-UP-001', 'computers'), requested);
  assert.ok(requested.alerts.some(a => a.itemId === 'computers'));
  assert.throws(() => saveInventory(requested, 'TC-UP-001', 'computers', { verifiedCount: 11, reviewNote: '' }), /Review note/);
  const saved = saveInventory(requested, 'TC-UP-001', 'computers', { approved: 12, verifiedCount: 11, operability: 'Needs maintenance', reviewNote: 'Counted 11; one needs repair', detected: 99 });
  const item = saved.centers[0].inventory[2];
  assert.equal(item.detected, 10); assert.equal(item.verifiedCount, 11); assert.equal(item.reviewStatus, 'reviewed');
  assert.ok(item.reviewedAt); assert.ok(saved.history.some(e => e.type === 'inventory-review'));
  assert.equal(saved.alerts.find(a => a.itemId === 'computers').status, 'open');
});

test('evidence is an immutable saved snapshot and notes survive later centre changes', () => {
  let state = initial(); const snapshot = captureEvidence(state, 'TC-UP-001');
  state = saveEvidence(state, snapshot, 'Confirm the register with the centre operator.');
  assert.equal(state.evidence[0].centre.claimed, 40);
  assert.throws(() => saveEvidence(state, snapshot, 'Duplicate'), /already saved/);
  state = saveRegister(state, 'TC-UP-001', 32);
  assert.equal(state.evidence[0].centre.claimed, 40); assert.equal(snapshot.centre.claimed, 40);
  assert.ok(state.history.some(e => e.after?.evidenceId === snapshot.id));
  assert.ok(!JSON.stringify(state.evidence[0]).includes('trackId'));
});

test('report archival and notification reads preserve data revision, while real edits stale a snapshot', () => {
  const state = initial();
  const report = { id: 'RPT-example', createdAt: new Date().toISOString(), sourceRevision: state.dataRevision, options: {}, summary: { centres: 12 } };
  let saved = storeReport(state, report);
  assert.equal(saved.dataRevision, state.dataRevision); assert.equal(saved.reports.length, 1);
  report.summary.centres = 900; assert.equal(saved.reports[0].summary.centres, 12);
  const notification = saved.notifications[0]; assert.equal(notification.type, 'reports');
  saved = markNotifications(saved, [notification.id]); assert.ok(saved.notifications[0].readAt);
  assert.equal(saved.dataRevision, state.dataRevision);
  const changed = saveCentre(saved, 'TC-UP-001', { reviewNotes: 'New context' });
  assert.ok(changed.dataRevision > saved.reports[0].sourceRevision);
});

test('resolving alerts is idempotent and creates a real reviewer activity entry', () => {
  const state = initial(); const id = state.alerts[0].id;
  const saved = resolveAlert(state, id);
  assert.equal(saved.alerts[0].status, 'resolved'); assert.ok(saved.alerts[0].resolvedAt);
  assert.equal(saved.history[0].type, 'alert-resolved'); assert.equal(resolveAlert(saved, id), saved);
});

test('demo updates never overwrite saved Vision Lab counts or invent observations for offline centres', () => {
  const state = saveVision(initial(), 'TC-UP-001', { persons: 22, chairs: 12, claimed: 40, timestamp: new Date().toISOString() });
  const changed = simulateTick(state, () => 1);
  assert.equal(changed.centers[0].detected, 22); assert.equal(changed.centers[0].source, 'local-ai');
  assert.equal(changed.centers[1].detected, state.centers[1].detected + 1);
  assert.equal(changed.centers.find(c => c.connection === 'offline').detected, null);
  assert.ok(!JSON.stringify(changed).includes('trackId'));
});

test('CSV export respects provided scope and neutralizes spreadsheet formulas', () => {
  const centre = { ...initial().centers[0], name: '=HYPERLINK("bad")' };
  const csv = centresCsv([centre]);
  assert.equal(csv.split('\r\n').length, 2); assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(!csv.includes('TC-RJ-002'));
});
