import { inventoryAvailable } from './observations.js';
// Form-only validation. The parent remains responsible for validating and persisting mutations.
export const OPERABILITY_OPTIONS = ['Unknown', 'Operational', 'Needs maintenance', 'Out of service'];

export function centreDraft(centre = {}) {
  return {
    id: centre.id ?? '', name: centre.name ?? '', city: centre.city ?? '',
    state: centre.state ?? '', course: centre.course ?? '',
    capacity: String(centre.capacity ?? 48), cameras: String(centre.cameras ?? 0),
    reviewNotes: centre.reviewNotes ?? '',
  };
}

function text(value, label, errors, field, maxLength = 160) {
  const result = String(value ?? '').trim();
  if (!result) errors[field] = `${label} is required.`;
  else if (result.length > maxLength) errors[field] = `${label} must be ${maxLength} characters or fewer.`;
  return result;
}

function wholeCount(value, label, errors, field, { nullable = false, positive = false } = {}) {
  const raw = String(value ?? '').trim();
  if (nullable && !raw) return null;
  const result = Number(raw);
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(result) || result < (positive ? 1 : 0)) {
    errors[field] = `${label} must be a ${positive ? 'positive' : 'non-negative'} whole number.`;
  }
  return result;
}

export function validateCentreDraft(draft, { creating = false, centres = [], centre = null } = {}) {
  const errors = {};
  const patch = {};
  for (const [field, label] of [['name', 'Centre name'], ['city', 'City'], ['state', 'State'], ['course', 'Course']]) {
    patch[field] = text(draft[field], label, errors, field);
  }
  patch.capacity = wholeCount(draft.capacity, 'Capacity', errors, 'capacity', { positive: true });
  patch.cameras = wholeCount(draft.cameras, 'Camera count', errors, 'cameras');
  patch.reviewNotes = String(draft.reviewNotes ?? '').trim();
  if (patch.reviewNotes.length > 2000) errors.reviewNotes = 'Review notes must be 2000 characters or fewer.';
  // Updating capacity must not silently contradict the submitted register; observations remain untouched.
  if (centre && Number.isFinite(centre.claimed) && patch.capacity < centre.claimed) {
    errors.capacity = `Capacity cannot be below the submitted attendance (${centre.claimed}). Reconcile the register first.`;
  }
  if (creating) {
    patch.id = String(draft.id ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(patch.id)) errors.id = 'Use 3–40 letters, numbers or hyphens for the centre ID.';
    if (centres.some(item => item.id.toUpperCase() === patch.id)) errors.id = 'This centre ID already exists.';
  }
  return { errors, patch };
}

export function buildNewCentreDraft(patch) {
  return {
    ...patch, claimed: 0, detected: null, connection: 'offline', source: 'manual',
    inventory: [
      ['seating', 'Training seats', 'chair'], ['workbenches', 'Workbenches', 'bench'],
      ['computers', 'Computer systems', 'computer'], ['equipment', 'Trade equipment', 'tool'],
    ].map(([id, name, icon]) => ({
      id, name, icon, approved: 0, detected: null, operability: 'Unknown',
      verifiedCount: null, reviewNote: '', reviewStatus: 'unreviewed',
      reviewedAt: null, verificationRequestedAt: null,
    })),
  };
}

export function inventoryDraft(item) {
  return {
    approved: String(item.approved ?? 0), verifiedCount: item.verifiedCount == null ? '' : String(item.verifiedCount),
    operability: OPERABILITY_OPTIONS.includes(item.operability) ? item.operability : 'Unknown',
    reviewNote: item.reviewNote ?? '',
  };
}

export function validateInventoryDraft(draft) {
  const errors = {};
  const patch = {
    approved: wholeCount(draft.approved, 'Approved count', errors, 'approved'),
    verifiedCount: wholeCount(draft.verifiedCount, 'Human verified count', errors, 'verifiedCount', { nullable: true }),
    operability: draft.operability,
    reviewNote: text(draft.reviewNote, 'Human-review note', errors, 'reviewNote', 2000),
  };
  if (!OPERABILITY_OPTIONS.includes(patch.operability)) errors.operability = 'Choose a listed operability status.';
  // Never send detected, timestamps or reviewStatus: the parent stamps the persisted human review.
  return { errors, patch };
}

export function inventorySignal(centre, item) {
  if (centre.connection !== 'online' && !inventoryAvailable(centre, item)) return { kind: 'unknown', label: 'Offline · observation unavailable', count: null };
  if (!Number.isFinite(item.detected) || item.detected < 0) return { kind: 'unknown', label: 'Unknown · no observation', count: null };
  if (item.detected < item.approved) return { kind: 'gap', label: `${item.approved - item.detected} below approved · model signal`, count: item.detected };
  return { kind: 'observed', label: 'Model count meets approved · not verified', count: item.detected };
}

export function filterCentres(centres, { query = '', state = '', connection = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return centres.filter(centre => (!state || centre.state === state)
    && (!connection || centre.connection === connection)
    && (!needle || [centre.id, centre.name, centre.city, centre.state, centre.course].some(value => String(value ?? '').toLowerCase().includes(needle))));
}

export function filterInventory(centres, { centreId = '', filter = 'all', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return centres.filter(centre => !centreId || centre.id === centreId).flatMap(centre => (centre.inventory ?? []).map(item => ({ centre, item })))
    .filter(({ centre, item }) => {
      if (needle && ![centre.name, centre.id, centre.city, item.name].some(value => String(value ?? '').toLowerCase().includes(needle))) return false;
      const signal = inventorySignal(centre, item);
      return filter === 'all' || (filter === 'gaps' && signal.kind === 'gap')
        || (filter === 'offline' && signal.kind === 'unknown')
        || (filter === 'pending' && item.reviewStatus === 'requested');
    });
}

export function formatWorkflowTime(stamp) {
  if (!stamp || Number.isNaN(new Date(stamp).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(stamp));
}

export function centreHistory(history, centreId, itemId) {
  return history.filter(entry => entry.centreId === centreId && (!itemId || entry.itemId === itemId))
    .slice().sort((a, b) => (Date.parse(b.createdAt || b.timestamp || b.at) || 0) - (Date.parse(a.createdAt || a.timestamp || a.at) || 0));
}

export function requireSavedEntity(saved, expectedId) {
  if (!saved || typeof saved !== 'object' || typeof saved.then === 'function' || !saved.id || (expectedId && saved.id !== expectedId)) {
    throw new Error('The save was not confirmed. Your changes are still unsaved; please try again.');
  }
  return saved;
}
