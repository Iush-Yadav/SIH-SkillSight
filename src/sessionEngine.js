export const SESSION_KEY = 'skillsight-sessions-v1';
export const MAX_SAMPLES = 3600;
export function createSession({ centreId, centreName, claimed, threshold, sustainedSeconds, source }, now = new Date().toISOString()) {
  if (!centreId || !Number.isInteger(claimed) || claimed < 0 || claimed > 1000 || !Number.isInteger(threshold) || threshold < 1 || threshold > 100 || !Number.isInteger(sustainedSeconds) || sustainedSeconds < 5 || sustainedSeconds > 300 || !['camera', 'recording'].includes(source)) throw new Error('Choose valid session settings.');
  return { id: crypto.randomUUID(), centreId, centreName, claimed, threshold, sustainedSeconds, source, startedAt: now, model: 'COCO-SSD lite_mobilenet_v2', confidence: .5, samples: [], endedAt: null, endReason: null, ackCount: 0, endSynced: false };
}
export function addSample(session, elapsedMs, persons) {
  if (session.endedAt || session.samples.length >= MAX_SAMPLES) throw new Error('Session has ended or reached the one-hour sample limit.');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 3600000 || (persons !== null && (!Number.isInteger(persons) || persons < 0 || persons > 1000))) throw new Error('Invalid observation.');
  if (session.samples.length && elapsedMs <= session.samples.at(-1).elapsedMs) throw new Error('Observations must be ordered.');
  return { ...session, samples: [...session.samples, { elapsedMs: Math.round(elapsedMs), persons }] };
}
export function summarizeSession(session) {
  let coveredMs = 0, personMs = 0, sustainedMs = 0, firstAlertMs = null;
  for (let i = 1; i < session.samples.length; i++) {
    const previous = session.samples[i - 1], current = session.samples[i];
    const dt = current.elapsedMs - previous.elapsedMs;
    if (dt > 5000 || current.persons === null || previous.persons === null) { sustainedMs = 0; continue; }
    coveredMs += dt; personMs += previous.persons * dt;
    if (Math.abs(previous.persons - session.claimed) >= session.threshold && Math.abs(current.persons - session.claimed) >= session.threshold) {
      sustainedMs += dt;
      if (sustainedMs >= session.sustainedSeconds * 1000 && firstAlertMs === null) firstAlertMs = current.elapsedMs;
    } else sustainedMs = 0;
  }
  const elapsedMs = Math.max(session.samples.at(-1)?.elapsedMs || 0, session.endedAt ? Math.max(0, Date.parse(session.endedAt) - Date.parse(session.startedAt)) : 0);
  return { elapsedMs, coveredMs, unknownMs: Math.max(0, elapsedMs - coveredMs), coverage: elapsedMs ? coveredMs / elapsedMs : 0, observedPersonMinutes: personMs / 60000, claimedPersonMinutes: session.claimed * coveredMs / 60000, averagePresence: coveredMs ? personMs / coveredMs : null, firstAlertMs, needsReview: firstAlertMs !== null };
}
export function isPending(session) { return session.ackCount < session.samples.length || (Boolean(session.endedAt) && !session.endSynced) || (Boolean(session.review) && !session.reviewSynced); }
export function syncPayload(session) {
  const { ackCount, endSynced, reviewSynced, ...record } = session;
  const samples = session.samples.slice(ackCount, ackCount + 100);
  return { ...record, review: ackCount + samples.length === session.samples.length ? session.review : undefined, samples, offset: ackCount, endedAt: ackCount + samples.length === session.samples.length ? session.endedAt : null };
}
