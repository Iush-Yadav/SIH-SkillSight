import { test, expect } from '@playwright/test';

async function openMonitor(page) {
  await page.clock.install({ time: new Date('2026-10-02T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-02T12:00:00Z'));
  await page.goto('/');
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible()) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Live monitor', exact: false }).click();
  await expect(page.locator('.tc-person')).toHaveCount(8);
}
const ids = page => page.locator('.tc-person').evaluateAll(nodes => nodes.map(node => node.dataset.trackId));

test('person IDs follow movement; selection, pause and global pause preserve the track', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMonitor(page);
  const initial = await ids(page);
  expect(initial.every(id => /^\d{5}$/.test(id))).toBeTruthy();
  const target = page.getByRole('button', { name: `Track ${initial[0]}`, exact: true });
  const position = await target.getAttribute('transform');
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('track-inspector')).toContainText(`#${initial[0]}`);
  await page.clock.runFor(3000);
  expect(await ids(page)).toEqual(initial);
  expect(await target.getAttribute('transform')).not.toEqual(position);
  await page.getByRole('button', { name: 'Pause tracking demo' }).click();
  const pausedPosition = await target.getAttribute('transform');
  const pausedTime = await page.getByTestId('tracking-stage').getAttribute('data-time');
  await page.clock.runFor(4000);
  expect(await target.getAttribute('transform')).toEqual(pausedPosition);
  expect(await page.getByTestId('tracking-stage').getAttribute('data-time')).toEqual(pausedTime);
  await page.getByRole('button', { name: 'Play tracking demo' }).click();
  await page.clock.runFor(1000);
  expect(await target.getAttribute('transform')).not.toEqual(pausedPosition);
  await page.getByRole('button', { name: 'Live updates', exact: true }).click();
  const globalTime = await page.getByTestId('tracking-stage').getAttribute('data-time');
  await page.clock.runFor(4000);
  expect(await page.getByTestId('tracking-stage').getAttribute('data-time')).toEqual(globalTime);
  await expect(page.getByText('Global updates paused · IDs preserved')).toBeVisible();
  expect(errors).toEqual([]);
});

test('exit ends selected ID; new entry and reset get fresh IDs without persisting tracks', async ({ page }) => {
  await openMonitor(page);
  const initial = await ids(page);
  await page.getByRole('button', { name: `Inspect track ${initial[0]}`, exact: true }).click();
  await page.getByRole('button', { name: 'Simulate exit' }).click();
  await page.clock.runFor(8000);
  await expect(page.getByRole('button', { name: `Track ${initial[0]}`, exact: true })).toHaveCount(0);
  await expect(page.getByTestId('track-inspector')).toContainText(`Track #${initial[0]} ended`);
  await page.getByRole('button', { name: 'Simulate entry' }).click();
  await page.clock.runFor(4000);
  const after = await ids(page);
  expect(after).not.toContain(initial[0]);
  expect(after.some(id => !initial.includes(id))).toBeTruthy();
  await page.getByRole('button', { name: 'Reset tracking demo' }).click();
  const reset = await ids(page);
  expect(reset).toHaveLength(8);
  expect(reset.every(id => !after.includes(id) && !initial.includes(id))).toBeTruthy();
  const saved = await page.evaluate(() => localStorage.getItem('skillsight-state'));
  expect(saved).not.toContain('trackId');
  expect(saved).not.toContain('trail');
});

test('camera overlays, speed, expansion and offline states are connected controls', async ({ page }) => {
  await openMonitor(page);
  await page.getByRole('button', { name: 'Trails', exact: true }).click();
  await expect(page.locator('.tc-trail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Boxes', exact: true }).click();
  await expect(page.locator('.tc-box')).toHaveCount(0);
  await expect(page.locator('.tc-track-label')).toHaveCount(8);
  await page.getByRole('button', { name: 'Zones', exact: true }).click();
  await expect(page.getByText('ZONE A · LEARNING')).toBeVisible();
  await page.getByLabel('Playback speed').selectOption('2');
  await page.clock.runFor(1000);
  expect(Number(await page.getByTestId('tracking-stage').getAttribute('data-time'))).toBeGreaterThan(1.8);
  await page.getByRole('button', { name: 'Expand camera' }).click();
  await expect(page.getByRole('dialog', { name: 'Interactive training floor camera' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Interactive training floor camera' })).toHaveCount(0);
  await page.getByLabel('Viewing centre').selectOption('TC-RJ-008');
  await expect(page.getByText('Camera offline', { exact: true })).toBeVisible();
  await expect(page.locator('.tc-person')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate entry' })).toBeDisabled();
  await page.getByLabel('Viewing centre').selectOption('TC-UP-001');
  await expect(page.locator('.tc-person')).toHaveCount(8);
});

test('mobile and reduced-motion users get a usable, initially paused camera', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMonitor(page);
  await expect(page.getByRole('button', { name: 'Play tracking demo' })).toBeVisible();
  await page.clock.runFor(3000);
  expect(await page.getByTestId('tracking-stage').getAttribute('data-time')).toEqual('0.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: /Inspect track/ }).first().click();
  await expect(page.getByTestId('track-inspector')).toContainText('temporary session ID');
  await page.getByRole('button', { name: 'Play tracking demo' }).click();
  await page.clock.runFor(1000);
  expect(Number(await page.getByTestId('tracking-stage').getAttribute('data-time'))).toBeGreaterThan(0);
});

test('Vision Lab stays opt-in and exposes real media errors without fake detections', async ({ page }) => {
  let modelRequests = 0;
  await page.route(/tfhub|storage.googleapis.com|tensorflow/, async route => { modelRequests++; await route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Live monitor', exact: false }).click();
  await page.getByRole('button', { name: 'Vision Lab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analyze image', exact: true })).toBeDisabled();
  await page.getByLabel('Choose an image or video from your device').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByText('This image could not be decoded.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save count summary' })).toBeDisabled();
  expect(modelRequests).toBe(0);
});

test('Vision Lab connects sampled detections to stable IDs and resets on media replacement (detector stub)', async ({ page }) => {
  // Stub only the external detector/backend, not the tracker or overlay being tested.
  await page.route(/\/node_modules\/\.vite\/deps\/@tensorflow_tfjs\.js/, route => route.fulfill({ contentType: 'application/javascript', body: 'export async function setBackend(){ return true }; export async function ready(){}' }));
  await page.route(/\/node_modules\/\.vite\/deps\/@tensorflow-models_coco-ssd\.js/, route => route.fulfill({ contentType: 'application/javascript', body: 'export async function load(){let frame=0;return {detect:async()=>[{class:"person",score:.95,bbox:[40+(frame++)*3,40,40,80]},{class:"chair",score:.85,bbox:[180,90,40,50]}],dispose(){}}}; export default {load}' }));
  await page.goto('/');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.fillStyle = '#eee'; context.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const upload = name => page.getByLabel('Choose an image or video from your device').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByRole('button', { name: 'Live monitor', exact: false }).click();
  await page.getByRole('button', { name: 'Vision Lab', exact: true }).click();
  await page.getByRole('button', { name: 'Load AI model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Model ready', exact: true })).toBeVisible();
  await upload('tracking-fixture.png');
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  const label = page.locator('.vl-box-person text');
  await expect(label).toHaveText(/^#\d{5} · person 95%$/);
  const first = await label.textContent();
  await page.getByRole('button', { name: 'Analyze again', exact: true }).click();
  await expect(label).toHaveText(first);
  await expect(page.locator('.vl-box-person polyline')).toHaveCount(1);
  await expect(page.locator('.vl-box-chair text')).toHaveText('Chair 85%');
  await upload('new-tracking-session.png');
  await expect(page.locator('.vl-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await expect(label).toHaveText(/^#\d{5} · person 95%$/);
  await expect(label).not.toHaveText(first);
  await expect(page.locator('.vl-box-person polyline')).toHaveCount(0);
});
