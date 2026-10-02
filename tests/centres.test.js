import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInitialState } from '../src/data.js';
import {
  buildNewCentreDraft, centreDraft, centreHistory, filterCentres, filterInventory,
  formatWorkflowTime, inventoryDraft, inventorySignal, requireSavedEntity,
  validateCentreDraft, validateInventoryDraft,
} from '../src/centreForms.js';

const validCentre = () => centreDraft(makeInitialState().centers[0]);

test('centre edits validate metadata without ever patching inferred or submitted counts', () => {
  const draft = { ...validCentre(), name: '  Updated centre  ', capacity: '60', detected: 500, claimed: 500, connection: 'online', reviewNotes: '  Asked operator for context  ' };
  const { errors, patch } = validateCentreDraft(draft);
  assert.deepEqual(errors, {});
  assert.equal(patch.name, 'Updated centre');
  assert.equal(patch.capacity, 60);
  assert.equal(patch.reviewNotes, 'Asked operator for context');
  for (const field of ['id', 'detected', 'claimed', 'connection', 'inventory', 'source']) assert.equal(Object.hasOwn(patch, field), false);
});

test('centre validation rejects empty metadata, fractions, negatives and register contradictions', () => {
  const { errors } = validateCentreDraft({ ...validCentre(), name: ' ', city: '', capacity: '0', cameras: '-1' });
  assert.deepEqual(Object.keys(errors).sort(), ['cameras', 'capacity', 'city', 'name']);
  for (const value of ['', '2.5', 'Infinity', '1e3', '9007199254740992']) {
    assert.ok(validateCentreDraft({ ...validCentre(), capacity: value }).errors.capacity, value);
  }
  assert.ok(validateCentreDraft({ ...validCentre(), capacity: '20' }, { centre: { claimed: 40 } }).errors.capacity);
  assert.deepEqual(validateCentreDraft({ ...validCentre(), capacity: '40' }, { centre: { claimed: 40 } }).errors, {});
});

test('new centre IDs are normalized and case-insensitive duplicates are rejected', () => {
  const centres = makeInitialState().centers;
  assert.ok(validateCentreDraft({ ...validCentre(), id: ' tc-up-001 ' }, { creating: true, centres }).errors.id);
  assert.ok(validateCentreDraft({ ...validCentre(), id: 'bad id' }, { creating: true, centres }).errors.id);
  const result = validateCentreDraft({ ...validCentre(), id: ' tc-dl-013 ' }, { creating: true, centres });
  assert.deepEqual(result.errors, {});
  assert.equal(result.patch.id, 'TC-DL-013');
});

test('new centres start offline without invented observations, approvals or human reviews', () => {
  const { patch } = validateCentreDraft({ ...validCentre(), id: 'TC-DL-013' }, { creating: true });
  const centre = buildNewCentreDraft(patch);
  assert.equal(centre.connection, 'offline');
  assert.equal(centre.detected, null);
  assert.equal(centre.claimed, 0);
  assert.equal(centre.inventory.length, 4);
  for (const item of centre.inventory) {
    assert.equal(item.approved, 0);
    assert.equal(item.detected, null);
    assert.equal(item.verifiedCount, null);
    assert.equal(item.operability, 'Unknown');
    assert.equal(item.reviewStatus, 'unreviewed');
    assert.equal(item.reviewedAt, null);
    assert.equal(item.verificationRequestedAt, null);
  }
});

test('inventory validation preserves unknown versus verified zero and separates model counts', () => {
  const draft = inventoryDraft({ approved: 12, detected: 10, verifiedCount: null });
  assert.equal(draft.verifiedCount, '');
  let result = validateInventoryDraft({ ...draft, reviewNote: '  Sanction record checked; inspection pending.  ' });
  assert.deepEqual(result.errors, {});
  assert.equal(result.patch.verifiedCount, null);
  assert.equal(result.patch.operability, 'Unknown');
  assert.equal(result.patch.reviewNote, 'Sanction record checked; inspection pending.');
  result = validateInventoryDraft({ ...draft, verifiedCount: '0', operability: 'Out of service', reviewNote: 'No units located during inspection.', detected: 0 });
  assert.equal(result.patch.verifiedCount, 0);
  assert.equal(Object.hasOwn(result.patch, 'detected'), false);
  assert.equal(Object.hasOwn(result.patch, 'reviewedAt'), false);
  assert.equal(Object.hasOwn(result.patch, 'reviewStatus'), false);
});

test('every inventory update needs a human-review note and valid whole counts', () => {
  const draft = { approved: '12', verifiedCount: '', operability: 'Operational', reviewNote: '' };
  assert.ok(validateInventoryDraft(draft).errors.reviewNote);
  assert.ok(validateInventoryDraft({ ...draft, reviewNote: '   ' }).errors.reviewNote);
  assert.ok(validateInventoryDraft({ ...draft, reviewNote: 'x'.repeat(2001) }).errors.reviewNote);
  assert.ok(validateInventoryDraft({ ...draft, operability: 'Looks fine' }).errors.operability);
  for (const value of ['-1', '1.5', 'Infinity', '9007199254740992']) {
    const result = validateInventoryDraft({ ...draft, approved: value, verifiedCount: value });
    assert.ok(result.errors.approved, value);
    assert.ok(result.errors.verifiedCount, value);
  }
  assert.ok(validateInventoryDraft({ ...draft, approved: '' }).errors.approved);
});

test('offline and missing model observations cannot be reported as current coverage or gaps', () => {
  const offline = { connection: 'offline' };
  const online = { connection: 'online' };
  for (const detected of [null, 0, 12, 99]) {
    assert.equal(inventorySignal(offline, { approved: 12, detected }).kind, 'unknown');
    assert.equal(inventorySignal(offline, { approved: 12, detected }).count, null);
  }
  for (const detected of [null, undefined, NaN, -1]) assert.equal(inventorySignal(online, { approved: 12, detected }).kind, 'unknown');
  assert.equal(inventorySignal(online, { approved: 12, detected: 0 }).kind, 'gap');
  assert.equal(inventorySignal(online, { approved: 12, detected: 12 }).kind, 'observed');
  assert.match(inventorySignal(online, { approved: 12, detected: 12 }).label, /not verified/);
});

test('centre search combines query, location and connection without mutating records', () => {
  const centres = makeInitialState().centers;
  const original = JSON.stringify(centres);
  assert.equal(filterCentres(centres, { query: '  apparel  ', state: 'Rajasthan', connection: 'online' })[0].id, 'TC-RJ-002');
  assert.equal(filterCentres(centres, { connection: 'offline' }).length, 2);
  assert.equal(filterCentres(centres, { query: 'TC-UP-001', state: 'Bihar' }).length, 0);
  assert.equal(JSON.stringify(centres), original);
});

test('inventory filters distinguish gaps, unknowns and persisted pending requests', () => {
  const centres = makeInitialState().centers;
  centres[0].inventory[2].reviewStatus = 'requested';
  assert.equal(filterInventory(centres, { filter: 'gaps' }).length, 2);
  assert.equal(filterInventory(centres, { filter: 'offline' }).length, 8);
  assert.equal(filterInventory(centres, { filter: 'pending' }).length, 1);
  assert.equal(filterInventory(centres, { centreId: centres[0].id, query: 'computer', filter: 'pending' })[0].item.id, 'computers');
  assert.equal(filterInventory(centres, { centreId: centres[1].id, filter: 'pending' }).length, 0);
  centres[0].connection = 'offline';
  assert.equal(filterInventory(centres, { filter: 'gaps' }).length, 1);
});

test('history is scoped to the correct centre/item and ordered without mutation', () => {
  const history = [
    { id: '1', centreId: 'A', itemId: 'seating', summary: 'Older', createdAt: '2026-01-01T12:00:00Z' },
    { id: '2', centreId: 'A', itemId: 'computers', summary: 'Other asset', createdAt: '2026-01-02T12:00:00Z' },
    { id: '3', centreId: 'B', itemId: 'seating', summary: 'Other centre', createdAt: '2026-01-03T12:00:00Z' },
    { id: '4', centreId: 'A', itemId: 'seating', summary: 'Latest', at: '2026-01-04T12:00:00Z' },
  ];
  assert.deepEqual(centreHistory(history, 'A', 'seating').map(entry => entry.id), ['4', '1']);
  assert.deepEqual(centreHistory(history, 'A').map(entry => entry.id), ['4', '2', '1']);
  assert.equal(history[0].id, '1');
  assert.equal(formatWorkflowTime(null), 'Not recorded');
  assert.equal(formatWorkflowTime('invalid'), 'Not recorded');
});

test('save confirmation rejects void, promises and wrong records rather than declaring success', () => {
  for (const response of [null, undefined, false, {}, { id: 'other' }, Promise.resolve({ id: 'expected' })]) {
    assert.throws(() => requireSavedEntity(response, 'expected'), /not confirmed/);
  }
  const saved = { id: 'expected', name: 'Persisted' };
  assert.equal(requireSavedEntity(saved, 'expected'), saved);
});
