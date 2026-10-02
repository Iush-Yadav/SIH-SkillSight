import { test, expect } from '@playwright/test';
import { makeInitialState } from '../src/data.js';
import { normalizeState } from '../src/appState.js';
import { readFile } from 'node:fs/promises';

const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('skillsight-state')));
async function seed(page) {
  const initial = normalizeState(makeInitialState()); initial.settings.demoUpdates = false;
  await page.addInitScript(state => { if (!localStorage.getItem('skillsight-state')) localStorage.setItem('skillsight-state', JSON.stringify(state)); }, initial);
  await page.goto('/');
}
test.beforeEach(async ({ page }) => { await seed(page); });

test('settings persist and actually control default centre, refresh, motion and notification categories', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Attendance mismatch threshold').fill('3');
  await page.getByLabel('Default centre').selectOption('TC-RJ-002');
  await page.getByLabel('Demo refresh interval').selectOption('60');
  await page.getByLabel('Low-resource mode', { exact: false }).check();
  await page.getByLabel('Reduce motion', { exact: false }).check();
  await page.getByLabel('Saved changes', { exact: false }).uncheck();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText(/Saved locally at/)).toBeVisible();
  let state = await stored(page);
  expect(state.settings.mismatchThreshold).toBe(3); expect(state.settings.notificationPrefs.changes).toBe(false);
  expect(state.notifications.filter(n => n.type === 'changes')).toHaveLength(0);
  expect(state.notifications.some(n => n.type === 'alerts' && n.message.includes('Patna'))).toBe(true);
  await page.reload();
  await nav(page, 'Live monitor').click();
  await expect(page.getByLabel('Viewing centre')).toHaveValue('TC-RJ-002');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.getByRole('button', { name: 'Play tracking demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Attendance mismatch threshold')).toHaveValue('3');
  await expect(page.getByLabel('Low-resource mode', { exact: false })).toBeChecked();
});

test('centre edits stay in directory, survive reload, and filter exports include only the selected view', async ({ page }) => {
  await nav(page, 'Training centres').click();
  await page.getByRole('button', { name: 'Edit centre Pradhan Mantri Kaushal Kendra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training centres', exact: true })).toBeVisible();
  await page.getByLabel('Centre review notes', { exact: true }).fill('Evaluator follow-up booked for Monday.');
  await page.getByRole('button', { name: 'Save centre changes' }).click();
  await expect(page.getByText('Centre details saved locally.', { exact: true })).toBeVisible();
  expect((await stored(page)).centers[0].reviewNotes).toBe('Evaluator follow-up booked for Monday.');
  await page.reload(); await nav(page, 'Training centres').click();
  await page.getByRole('button', { name: 'Edit centre Pradhan Mantri Kaushal Kendra', exact: true }).click();
  await expect(page.getByLabel('Centre review notes', { exact: true })).toHaveValue('Evaluator follow-up booked for Monday.');
  await page.getByLabel('Search centres', { exact: true }).fill('TC-UP-001');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export view', exact: true }).click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  expect(content).toContain('TC-UP-001'); expect(content).not.toContain('TC-RJ-002');
});

test('new centres are saved offline with review notes and unknown observations, not sent to monitor', async ({ page }) => {
  await nav(page, 'Training centres').click();
  await page.getByRole('button', { name: 'Add centre', exact: true }).click();
  for (const [label, value] of [['Centre ID','TC-DEMO-900'], ['Centre name','Evaluator demo centre'], ['City','Pune'], ['State','Maharashtra'], ['Course','IT training'], ['Capacity','32'], ['Registered cameras','0'], ['Centre review notes','Awaiting onboarding inspection']]) await (label === 'State' ? page.getByRole('textbox', { name: label, exact: true }) : page.getByLabel(label, { exact: true })).fill(value);
  await page.getByRole('button', { name: 'Create centre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training centres', exact: true })).toBeVisible();
  const centre = (await stored(page)).centers.find(c => c.id === 'TC-DEMO-900');
  expect(centre.connection).toBe('offline'); expect(centre.detected).toBeNull(); expect(centre.reviewNotes).toBe('Awaiting onboarding inspection');
  expect(centre.inventory.every(item => item.approved === 0 && item.detected === null)).toBe(true);
});

test('inventory requests and human reviews persist separately from model counts and produce activity', async ({ page }) => {
  await nav(page, 'Infrastructure').click();
  await page.getByRole('button', { name: 'Review Computer systems at Pradhan Mantri Kaushal Kendra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Infrastructure compliance', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request verification', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Requested', exact: true })).toBeDisabled();
  let state = await stored(page);
  expect(state.centers[0].inventory[2].reviewStatus).toBe('requested');
  expect(state.alerts.filter(a => a.itemId === 'computers')).toHaveLength(1);
  await page.getByLabel('Human verified count', { exact: true }).fill('11');
  await page.getByLabel('Operability', { exact: true }).selectOption('Needs maintenance');
  await page.getByLabel('Human-review note', { exact: true }).fill('Counted eleven systems; one requires repair.');
  await page.getByRole('button', { name: 'Save inventory review', exact: true }).click();
  state = await stored(page);
  expect(state.centers[0].inventory[2].detected).toBe(10); expect(state.centers[0].inventory[2].verifiedCount).toBe(11);
  expect(state.history.some(e => e.type === 'inventory-review')).toBe(true);
  await page.reload(); await nav(page, 'Infrastructure').click();
  await page.getByRole('button', { name: 'Review Computer systems at Pradhan Mantri Kaushal Kendra', exact: true }).click();
  await expect(page.getByLabel('Human verified count', { exact: true })).toHaveValue('11');
});

test('evidence opens in place and saves a retrievable frozen snapshot rather than hidden explanatory text', async ({ page }) => {
  await nav(page, 'Live monitor').click();
  await page.getByRole('button', { name: 'Evidence view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Evidence review' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Synthetic centre simulation', { exact: true })).toBeVisible();
  await dialog.getByLabel('Reviewer note').fill('Review count mismatch with operator before resolving.');
  await dialog.getByRole('button', { name: 'Save evidence & note' }).click();
  await expect(dialog.getByRole('button', { name: 'Evidence saved', exact: true })).toBeDisabled();
  const captured = (await stored(page)).evidence[0]; expect(captured.centre.claimed).toBe(40);
  await page.keyboard.press('Escape');
  await page.getByLabel('Submitted attendance', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Save register update', exact: true }).click();
  await expect(page.getByText(/Saved locally at/)).toBeVisible();
  await page.reload(); await nav(page, 'Live monitor').click();
  await page.getByRole('button', { name: /Evidence view/ }).click();
  await dialog.getByRole('button', { name: /Review count mismatch with operator before resolving/ }).click();
  await expect(dialog.getByLabel('Reviewer note')).toHaveValue('Review count mismatch with operator before resolving.');
  expect((await stored(page)).evidence[0].centre.claimed).toBe(40);
  await expect(dialog.getByText(/Workspace data changed after capture/)).toBeVisible();
});

test('compilation creates a real scoped report, downloads captured data and marks snapshots stale after edits', async ({ page }) => {
  await nav(page, 'Reports').click();
  await page.getByLabel('Centre scope', { exact: true }).selectOption('TC-UP-001');
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Compiled report preview' })).toBeVisible();
  let state = await stored(page);
  expect(state.reports).toHaveLength(1); expect(state.reports[0].centers).toHaveLength(1);
  const first = state.reports[0];
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const payload = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(payload.id).toBe(first.id); expect(payload.centers[0].id).toBe('TC-UP-001');
  await nav(page, 'Live monitor').click(); await page.getByLabel('Submitted attendance', { exact: true }).fill('34');
  await page.getByRole('button', { name: 'Save register update', exact: true }).click();
  await nav(page, 'Reports').click();
  await expect(page.getByText('Compiled · stale', { exact: true })).toBeVisible();
  await expect(page.getByText('Source data has changed since this snapshot was compiled.', { exact: true })).toBeVisible();
  expect((await stored(page)).reports[0].centers[0].attendance.claimed).toBe(40);
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  state = await stored(page); expect(state.reports).toHaveLength(2); expect(state.reports[0].centers[0].attendance.claimed).toBe(34);
  await page.reload(); await nav(page, 'Reports').click();
  await expect(page.getByRole('article', { name: 'Compiled report preview' })).toBeVisible();
  expect((await stored(page)).reports).toHaveLength(2);
});

test('bell shows unread events, persists read state and opens the real destination', async ({ page }) => {
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Notification inbox' });
  await expect(inbox.getByText('3 unread', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(inbox.getByText('0 unread', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await nav(page, 'Reports').click(); await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(inbox.getByText('1 unread', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Open report', exact: false }).click();
  await expect(inbox).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Compiled report preview' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(inbox.getByText('0 unread', { exact: true })).toBeVisible();
});

test('blocked storage never displays a successful save or silently applies a draft', async ({ page }) => {
  await nav(page, 'Live monitor').click();
  await page.getByLabel('Submitted attendance', { exact: true }).fill('36');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Save register update', exact: true }).click();
  await expect(page.locator('.reconcile-form').getByRole('alert')).toContainText('Your change was not applied');
  expect((await stored(page)).centers[0].claimed).toBe(40);
  await expect(page.locator('.comparison-row').getByText('40', { exact: true })).toBeVisible();
  await expect(page.getByText('Register update saved locally.', { exact: true })).toHaveCount(0);
});
