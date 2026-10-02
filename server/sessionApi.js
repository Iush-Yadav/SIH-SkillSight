import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { addSample, summarizeSession } from '../src/sessionEngine.js';

export function mergeSession(records, input) {
  const bad = message => { throw new Error(message); };
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.id || '') || !/^[A-Z0-9_-]{3,40}$/i.test(input.centreId || '') || typeof input.centreName !== 'string' || input.centreName.length > 160 || !['camera', 'recording'].includes(input.source) || !Number.isFinite(Date.parse(input.startedAt)) || !Number.isInteger(input.claimed) || input.claimed < 0 || input.claimed > 1000 || !Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 100 || !Number.isInteger(input.sustainedSeconds) || input.sustainedSeconds < 5 || input.sustainedSeconds > 300 || !Number.isInteger(input.offset) || input.offset < 0 || !Array.isArray(input.samples) || input.samples.length > 100) bad('Invalid session payload.');
  const metadata = Object.fromEntries(['id', 'centreId', 'centreName', 'source', 'startedAt', 'claimed', 'threshold', 'sustainedSeconds'].map(k => [k, input[k]]));
  const prior = records.find(r => r.id === input.id);
  if (prior && Object.keys(metadata).some(k => prior[k] !== metadata[k])) bad('Session metadata cannot change.');
  let next = prior || { ...metadata, model: 'COCO-SSD lite_mobilenet_v2', confidence: .5, samples: [], endedAt: null };
  if (!prior && records.length >= 100) bad('Server archive is full. Export and archive stored sessions first.');
  if (input.offset > next.samples.length) bad('Missing earlier observations.');
  for (let i = 0; i < input.samples.length; i++) {
    const sample = input.samples[i], index = input.offset + i;
    if (!sample || !Number.isInteger(sample.elapsedMs)) bad('Invalid sample.');
    if (index < next.samples.length) {
      if (next.samples[index].elapsedMs !== sample.elapsedMs || next.samples[index].persons !== sample.persons) bad('Conflicting observation.');
    } else next = addSample(next, sample.elapsedMs, sample.persons);
  }
  if (input.endedAt) {
    const duration = Date.parse(input.endedAt) - Date.parse(next.startedAt);
    if (!Number.isFinite(duration) || duration < (next.samples.at(-1)?.elapsedMs || 0) || duration > 3605000 || (next.endedAt && next.endedAt !== input.endedAt)) bad('Invalid session end.');
    next = { ...next, endedAt: input.endedAt, endReason: ['completed', 'interrupted', 'limit', 'media-ended', 'source-error'].includes(input.endReason) ? input.endReason : 'completed' };
  }
  if (input.review) {
    if (!next.endedAt || typeof input.review.note !== 'string' || !input.review.note.trim() || input.review.note.length > 2000 || !Number.isFinite(Date.parse(input.review.reviewedAt))) bad('Invalid review note.');
    if (next.review && (next.review.note !== input.review.note.trim() || next.review.reviewedAt !== input.review.reviewedAt)) bad('Saved review cannot be replaced.');
    next = { ...next, review: { note: input.review.note.trim(), reviewedAt: input.review.reviewedAt, reviewer: 'Local reviewer (not authenticated)' } };
  }
  next = { ...next, summary: summarizeSession(next) };
  return { records: [...records.filter(r => r.id !== next.id), next], session: next };
}

export function sessionMiddleware(file = resolve('server-data/sessions.json')) {
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/sessions') return next();
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Same-origin access only.' });
      if (req.method === 'GET') {
        const records = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
        return reply(200, { sessions: records.map(({ samples, ...r }) => ({ ...r, sampleCount: samples.length })).reverse() });
      }
      if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
      if (!req.headers['content-type']?.includes('application/json')) return reply(415, { error: 'JSON required.' });
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) return reply(413, { error: 'Payload too large.' }); }
      const records = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
      const result = mergeSession(records, JSON.parse(body));
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(result.records)); renameSync(`${file}.tmp`, file);
      reply(200, { id: result.session.id, ackCount: result.session.samples.length, endedAt: result.session.endedAt, reviewedAt: result.session.review?.reviewedAt || null });
    } catch (error) { reply(400, { error: error.message || 'Unable to persist session.' }); }
  };
}
export default function sessionApiPlugin() {
  return { name: 'skillsight-session-api', configureServer(server) { server.middlewares.use(sessionMiddleware()); }, configurePreviewServer(server) { server.middlewares.use(sessionMiddleware()); } };
}
