// Geometric, session-only tracking. No faces, embeddings, or personal identity.
let nextSessionId = 10000;
export function allocateTrackId() {
  // Never silently reuse a five-digit ID in this page session.
  if (nextSessionId > 99999) throw new Error('Track ID space exhausted. Reload to start a new session.');
  return String(nextSessionId++);
}

const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];
const validBox = box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;

// Minimum-cost one-to-one assignment (Hungarian algorithm). Dummy columns allow
// unmatched tracks, rather than forcing unrelated detections into existing IDs.
function assign(costs) {
  const n = costs.length;
  if (!n) return [];
  const m = costs[0].length;
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const current = costs[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < min[j]) { min[j] = current; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else min[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) result[p[j] - 1] = j - 1;
  return result;
}

export function createPersonTracker({ maxLostMs = 1400, allocateId = allocateTrackId, trailLength = 24 } = {}) {
  let tracks = [];
  let lastUpdate = null;
  return {
    reset() { tracks = []; lastUpdate = null; },
    update(detections, timestamp) {
      if (!Number.isFinite(timestamp) || (lastUpdate !== null && timestamp < lastUpdate)) {
        throw new Error('Tracking timestamps must be finite and monotonic. Reset after a seek.');
      }
      lastUpdate = timestamp;
      const boxes = detections.filter(d => validBox(d.bbox));
      const events = [];
      tracks = tracks.filter(track => {
        if (timestamp - track.lastSeen <= maxLostMs) return true;
        events.push({ type: 'exit', id: track.id, timestamp });
        return false;
      });
      const costs = tracks.map(track => {
        const dt = Math.max(0, timestamp - track.lastSeen) / 1000;
        const [cx, cy] = center(track.bbox);
        const predicted = [cx + track.velocity[0] * dt, cy + track.velocity[1] * dt];
        return [...boxes.map(detection => {
          const [dx, dy] = center(detection.bbox);
          const diagonal = Math.hypot(track.bbox[2], track.bbox[3]);
          const distance = Math.hypot(dx - predicted[0], dy - predicted[1]);
          const scale = Math.abs(Math.log(detection.bbox[2] / track.bbox[2])) + Math.abs(Math.log(detection.bbox[3] / track.bbox[3]));
          const gate = diagonal * (0.85 + Math.min(dt, 1.5));
          return distance > gate || scale > 1.4 ? 10000 : distance / gate + scale * .18;
        }), ...tracks.map(() => 1.15)];
      });
      const matching = assign(costs);
      const used = new Set();
      tracks.forEach((track, index) => {
        const match = matching[index];
        if (match < 0 || match >= boxes.length || costs[index][match] >= 1.15) {
          track.visible = false;
          return;
        }
        used.add(match);
        const detection = boxes[match];
        const oldCenter = center(track.bbox), newCenter = center(detection.bbox);
        const dt = (timestamp - track.lastSeen) / 1000;
        if (dt > 0) track.velocity = newCenter.map((value, axis) => (value - oldCenter[axis]) / dt * .8 + track.velocity[axis] * .2);
        track.bbox = [...detection.bbox];
        track.score = detection.score;
        track.lastSeen = timestamp;
        track.visible = true;
        track.trail = [...track.trail, [newCenter[0], detection.bbox[1] + detection.bbox[3]]].slice(-trailLength);
        track.detectionIndex = match;
      });
      boxes.forEach((detection, index) => {
        if (used.has(index)) return;
        const id = allocateId();
        const [x, y, w, h] = detection.bbox;
        tracks.push({ id, bbox: [...detection.bbox], score: detection.score, firstSeen: timestamp, lastSeen: timestamp, velocity: [0, 0], trail: [[x + w / 2, y + h]], visible: true, detectionIndex: index });
        events.push({ type: 'entry', id, timestamp });
      });
      // Return snapshots so renderers cannot mutate internal state.
      return { tracks: tracks.map(track => ({ ...track, bbox: [...track.bbox], velocity: [...track.velocity], trail: track.trail.map(point => [...point]) })), events };
    },
  };
}
