import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonTracker } from '../src/components/personTracker.js';
import { createTrainingSimulation } from '../src/components/trainingSimulation.js';

const person = (x, y = 30) => ({ bbox: [x, y, 40, 80], score: .95 });
const tracker = options => { let next = 10000; return createPersonTracker({ allocateId: () => String(next++), ...options }); };

test('five-digit IDs stay attached through movement and detection reordering', () => {
  const engine = tracker();
  const first = engine.update([person(20), person(300)], 0);
  assert.deepEqual(first.tracks.map(t => t.id), ['10000', '10001']);
  const moved = engine.update([person(280), person(40)], 200);
  assert.equal(moved.tracks.find(t => t.id === '10000').bbox[0], 40);
  assert.equal(moved.tracks.find(t => t.id === '10001').bbox[0], 280);
  assert.equal(moved.events.length, 0);
});

test('motion prediction preserves IDs when people cross with reordered boxes', () => {
  const engine = tracker();
  for (let frame = 0; frame < 12; frame++) {
    const right = person(40 + frame * 14);
    const left = person(240 - frame * 14);
    const result = engine.update(frame % 2 ? [left, right] : [right, left], frame * 100);
    assert.equal(result.tracks.find(t => t.id === '10000').bbox[0], right.bbox[0]);
    assert.equal(result.tracks.find(t => t.id === '10001').bbox[0], left.bbox[0]);
  }
});

test('short missed detections recover, exits retire IDs, and new arrivals get new IDs', () => {
  const engine = tracker({ maxLostMs: 500 });
  engine.update([person(100)], 0);
  const lost = engine.update([], 200);
  assert.equal(lost.tracks[0].visible, false);
  assert.equal(engine.update([person(105)], 400).tracks[0].id, '10000');
  const ended = engine.update([], 1000);
  assert.equal(ended.tracks.length, 0);
  assert.deepEqual(ended.events.map(e => [e.type, e.id]), [['exit', '10000']]);
  assert.equal(engine.update([person(105)], 1100).tracks[0].id, '10001');
});

test('unrelated far detections never steal an existing ID', () => {
  const engine = tracker();
  engine.update([person(0)], 0);
  const next = engine.update([person(800)], 100);
  assert.equal(next.tracks.find(t => t.id === '10000').visible, false);
  assert.equal(next.tracks.find(t => t.visible).id, '10001');
});

test('empty/invalid frames, one-to-one matches, bounded trails and reset are handled', () => {
  const engine = tracker({ trailLength: 5 });
  assert.equal(engine.update([], 0).tracks.length, 0);
  assert.equal(engine.update([{ bbox: [0, 0, NaN, 2] }], 1).tracks.length, 0);
  for (let i = 0; i < 40; i++) engine.update([person(50 + i)], 10 + i * 10);
  const result = engine.update([person(91), person(94)], 410);
  assert.equal(new Set(result.tracks.map(t => t.id)).size, 2);
  assert.equal(result.tracks[0].trail.length, 5);
  engine.reset();
  assert.equal(engine.update([person(50)], 0).tracks[0].id, '10002');
});

test('non-monotonic clocks require a reset after seeking', () => {
  const engine = tracker();
  engine.update([person(40)], 100);
  assert.throws(() => engine.update([], 99), /monotonic/);
  assert.throws(() => engine.update([], NaN), /monotonic/);
  engine.reset();
  assert.doesNotThrow(() => engine.update([person(40)], 0));
});

test('training demo retains all original IDs until the scripted exit and then logs entry/exit', () => {
  const simulation = createTrainingSimulation();
  const initial = simulation.advance(0);
  const ids = initial.tracks.map(t => t.id);
  assert.equal(ids.length, 8);
  assert.ok(ids.every(id => /^\d{5}$/.test(id)));
  for (let i = 0; i < 240; i++) {
    const frame = simulation.advance(1 / 15);
    assert.deepEqual(frame.tracks.map(t => t.id), ids);
  }
  let later;
  for (let i = 0; i < 200; i++) later = simulation.advance(1 / 15);
  assert.ok(later.exited >= 1);
  assert.ok(later.entered >= 9);
  assert.ok(later.history.length <= 36);
});

test('demo manual exit retires selected track and separate sessions never reuse IDs', () => {
  const simulation = createTrainingSimulation();
  const initial = simulation.advance(0);
  const id = initial.tracks[0].id;
  simulation.exitTrack(id);
  let frame;
  for (let i = 0; i < 150; i++) frame = simulation.advance(1 / 15);
  assert.ok(!frame.tracks.some(t => t.id === id));
  assert.ok(frame.exited >= 1);
  const nextSession = createTrainingSimulation().advance(0);
  assert.ok(nextSession.tracks.every(t => !initial.tracks.some(old => old.id === t.id)));
});
