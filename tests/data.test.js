import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationSamples, makeInitialState, replayCounts } from '../src/data.js';

test('initial dashboard state contains the full centre network and seeded review queue', () => {
  const state = makeInitialState();

  assert.equal(state.version, 1);
  assert.equal(state.centers.length, 12);
  assert.equal(state.alerts.length, 4);
  assert.equal(state.alerts.filter((alert) => alert.status === 'open').length, 3);
  assert.equal(state.centers.filter((centre) => centre.connection === 'offline').length, 2);
  assert.ok(state.centers.every((centre) => centre.inventory.length === 4));
  assert.equal(state.settings.mismatchThreshold, 10);
});

test('evaluation fixtures expose the documented 20 samples and valid scores', () => {
  assert.equal(evaluationSamples.length, 20);
  assert.ok(evaluationSamples.every((sample) => sample.score >= 0 && sample.score <= 1));
  assert.ok(evaluationSamples.some((sample) => sample.truth));
  assert.ok(evaluationSamples.some((sample) => !sample.truth));
});

test('replay fixture is a non-empty sequence of bounded counts', () => {
  assert.ok(replayCounts.length > 0);
  assert.ok(replayCounts.every((count) => Number.isInteger(count) && count >= 0));
});
