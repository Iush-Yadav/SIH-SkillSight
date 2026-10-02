import { createPersonTracker } from './personTracker.js';

export const FLOOR_WIDTH = 900;
export const FLOOR_HEIGHT = 520;

export function createTrainingSimulation() {
  const tracker = createPersonTracker({ maxLostMs: 700, trailLength: 38 });
  let elapsed = 0, nextActor = 0, lastSample = -1, exited = 0, entered = 0;
  let automaticExit = false, nextArrival = 23;
  let detectionsToActors = [];
  let result = { tracks: [], events: [] };
  let events = [], history = [];
  const actors = [];
  function add() {
    if (actors.filter(actor => !actor.gone).length >= 12) return false;
    const index = nextActor++;
    const slot = index % 8;
    actors.push({ index, x: [145, 345, 545, 750, 120, 330, 540, 770][slot], y: slot < 4 ? 310 : 449, phase: index * 1.8, born: elapsed, arrival: elapsed > 0, exitStart: null, gone: false });
    return true;
  }
  for (let i = 0; i < 8; i++) add();
  function position(actor) {
    const age = elapsed - actor.born;
    const x = actor.x + Math.sin(age * .26 + actor.phase) * 46;
    const y = actor.y + Math.sin(age * .35 + actor.phase) * 12;
    if (actor.exitStart !== null) return [actor.exitX + (elapsed - actor.exitStart) * 145, y];
    if (actor.arrival && age < 4) return [-28 + (x + 28) * age / 4, y];
    return [x, y];
  }
  function depart(actor) {
    if (!actor || actor.gone || actor.exitStart !== null) return;
    actor.exitX = position(actor)[0];
    actor.exitStart = elapsed;
  }
  function snapshot() {
    return { ...result, time: elapsed, events: [...events], history: [...history], entered, exited };
  }
  function advance(seconds = 0) {
    elapsed += Math.max(0, seconds);
    if (elapsed >= 18 && !automaticExit) { depart(actors[3]); automaticExit = true; }
    if (elapsed >= nextArrival) { add(); nextArrival += 16; }
    const detections = [];
    detectionsToActors = [];
    actors.forEach(actor => {
      if (actor.gone) return;
      const [x, y] = position(actor);
      if (x > FLOOR_WIDTH + 25) { actor.gone = true; return; }
      if (x < 18 || x > FLOOR_WIDTH - 18) return;
      detections.push({ bbox: [x - 21, y - 76, 42, 76], score: .92 + Math.sin(elapsed * .4 + actor.phase) * .035 });
      detectionsToActors.push(actor);
    });
    result = tracker.update(detections, elapsed * 1000);
    result.events.forEach(event => { if (event.type === 'entry') entered++; else exited++; });
    events = [...result.events.map(event => ({ ...event, time: elapsed })), ...events].slice(0, 5);
    if (Math.floor(elapsed) !== lastSample) {
      lastSample = Math.floor(elapsed);
      history = [...history, { time: lastSample, count: result.tracks.filter(track => track.visible).length }].slice(-36);
    }
    return snapshot();
  }
  return {
    advance, add,
    exitTrack(id) {
      const track = result.tracks.find(item => item.id === id && item.visible);
      if (track) depart(detectionsToActors[track.detectionIndex]);
    },
  };
}
