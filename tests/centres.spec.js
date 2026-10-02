import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the actual owned components independently of App integration.
// The harness models the synchronous persist-or-throw callback contract using localStorage.
let html;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import CentresView from './src/components/CentresView.jsx';
        import InfrastructureView from './src/components/InfrastructureView.jsx';
        import { makeInitialState } from './src/data.js';
        import './src/styles.css';
        window.monitorCalls = [];
        window.requestCalls = [];
        window.exportCalls = [];
        function Harness() {
          const [state, setState] = useState(() => JSON.parse(localStorage.getItem('cw-test-state') || 'null') || makeInitialState());
          const [view, setView] = useState('centres');
          const [focus, setFocus] = useState(null);
          const [focusItem, setFocusItem] = useState(null);
          window.focusInventory = (centreId, itemId) => { setView('infrastructure'); setFocus(centreId); setFocusItem(itemId); };
          window.centreState = state;
          window.tick = () => setState(current => ({ ...current, centers: current.centers.map(centre => ({ ...centre, detected: centre.detected == null ? null : centre.detected + 1, updatedAt: new Date().toISOString() })) }));
          window.focusCentre = setFocus;
          window.emptyNetwork = () => setState({ ...state, centers: [] });
          function persist(next) {
            if (window.failPersistence) throw new Error(window.failPersistence);
            localStorage.setItem('cw-test-state', JSON.stringify(next));
            setState(next);
          }
          function saveCentre(id, patch) {
            if (window.unconfirmedSave) return undefined;
            const saved = { ...state.centers.find(centre => centre.id === id), ...patch, updatedAt: new Date().toISOString() };
            persist({ ...state, centers: state.centers.map(centre => centre.id === id ? saved : centre), history: [{ id: String(Date.now()), centreId: id, summary: 'Centre details saved', createdAt: saved.updatedAt }, ...state.history] });
            return saved;
          }
          function createCentre(draft) {
            const saved = { ...draft, updatedAt: new Date().toISOString() };
            persist({ ...state, centers: [...state.centers, saved] });
            return saved;
          }
          function saveItem(centreId, itemId, patch, request = false) {
            if (window.unconfirmedSave) return undefined;
            const centre = state.centers.find(centre => centre.id === centreId);
            const item = centre.inventory.find(item => item.id === itemId);
            if (request && item.reviewStatus === 'requested') throw new Error('Already requested.');
            const now = new Date().toISOString();
            const saved = { ...item, ...patch, ...(request ? { reviewStatus: 'requested', verificationRequestedAt: now } : { reviewStatus: 'reviewed', reviewedAt: now }) };
            const centers = state.centers.map(value => value.id !== centreId ? value : { ...value, inventory: value.inventory.map(asset => asset.id === itemId ? saved : asset) });
            persist({ ...state, centers, history: [{ id: String(Date.now()), centreId, itemId, summary: request ? 'Verification requested' : 'Inventory review saved', createdAt: now }, ...state.history] });
            if (request) window.requestCalls.push([centreId, itemId]);
            return saved;
          }
          return <>
            <nav aria-label="Test workflow navigation" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <button onClick={() => { setView('centres'); setFocus(null); }}>Test centres</button>
              <button onClick={() => { setView('infrastructure'); setFocus(null); }}>Test infrastructure</button>
            </nav>
            {view === 'centres' ? <CentresView centres={state.centers} alerts={state.alerts} history={state.history} focusCentreId={focus}
              onSaveCentre={saveCentre} onCreateCentre={createCentre} onExport={items => window.exportCalls.push(items.map(item => item.id))}
              onOpenMonitor={id => window.monitorCalls.push(id)} onOpenInfrastructure={id => { setView('infrastructure'); setFocus(id); }} />
              : <InfrastructureView centres={state.centers} history={state.history} focusCentreId={focus} focusItemId={focusItem}
                onSaveInventory={(centreId, itemId, patch) => saveItem(centreId, itemId, patch)}
                onRequestVerification={(centreId, itemId) => saveItem(centreId, itemId, {}, true)}
                onOpenMonitor={id => window.monitorCalls.push(id)} />}
          </>;
        }
        createRoot(document.getElementById('root')).render(<Harness />);
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    outdir: 'in-memory-centres-test',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const javascript = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const stylesheet = result.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*;/g, '');
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${stylesheet}</style></head><body style="padding:12px"><main id="root" style="max-width:1100px;margin:auto"></main><script>${javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/centre-workflow-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/centre-workflow-test');
  await expect(page.getByRole('heading', { name: '12 centres in view' })).toBeVisible();
});

const centreName = 'Pradhan Mantri Kaushal Kendra';
const openCentre = page => page.getByRole('button', { name: `Edit centre ${centreName}`, exact: true }).click();
const openComputers = async page => {
  await page.getByRole('button', { name: 'Test infrastructure', exact: true }).click();
  await page.getByLabel('Inventory centre', { exact: true }).selectOption('TC-UP-001');
  await page.getByRole('button', { name: `Review Computer systems at ${centreName}`, exact: true }).click();
};
const editor = page => page.locator('.cw-editor');
const computer = page => page.evaluate(() => window.centreState.centers[0].inventory.find(item => item.id === 'computers'));

test('centre selection stays in section; filters and export use the visible subset', async ({ page }) => {
  await page.getByLabel('State', { exact: true }).selectOption('Rajasthan');
  await page.getByLabel('Connection', { exact: true }).selectOption('offline');
  await expect(page.getByRole('heading', { name: '1 centres in view' })).toBeVisible();
  await page.getByRole('button', { name: 'Export view', exact: true }).click();
  expect(await page.evaluate(() => window.exportCalls)).toEqual([['TC-RJ-008']]);
  await page.getByLabel('Search centres').fill('no such centre');
  await expect(page.getByRole('heading', { name: 'No centres match these filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear centre filters' }).click();
  await openCentre(page);
  await expect(page.getByRole('heading', { name: centreName, exact: true })).toBeVisible();
  await expect(page.getByLabel('Centre name', { exact: false })).toHaveValue(centreName);
  await expect(editor(page)).toContainText('12-person difference');
  expect(await page.evaluate(() => window.monitorCalls)).toEqual([]);
  await page.getByRole('button', { name: 'Inspect infrastructure', exact: true }).click();
  await expect(page.getByLabel('Inventory centre', { exact: true })).toHaveValue('TC-UP-001');
  await expect(page.getByRole('heading', { name: 'Infrastructure inventory', exact: true })).toBeVisible();
});

test('centre metadata drafts survive ticks and persist only after confirmation, including reload', async ({ page }) => {
  await openCentre(page);
  await page.getByLabel('Centre name', { exact: false }).fill('Updated Lucknow centre');
  await page.getByLabel('Centre review notes').fill('Reviewed the operating schedule.');
  await page.evaluate(() => window.tick());
  await expect(page.getByLabel('Centre name', { exact: false })).toHaveValue('Updated Lucknow centre');
  await expect(editor(page).getByRole('status')).toContainText('Unsaved');
  await page.getByRole('button', { name: 'Save centre changes' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  await expect(editor(page)).toContainText('Centre details saved');
  const saved = await page.evaluate(() => window.centreState.centers[0]);
  expect(saved.name).toBe('Updated Lucknow centre');
  expect(saved.detected).toBe(29);
  expect(saved.claimed).toBe(40);
  await page.reload();
  await page.getByRole('button', { name: 'Edit centre Updated Lucknow centre', exact: true }).click();
  await expect(page.getByLabel('Centre review notes')).toHaveValue('Reviewed the operating schedule.');
});

test('centre validation and parent failures preserve unsaved input and expose accessible errors', async ({ page }) => {
  await openCentre(page);
  await page.getByLabel('Capacity', { exact: false }).fill('20');
  await page.getByRole('button', { name: 'Save centre changes' }).click();
  await expect(page.getByLabel('Capacity', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Capacity', { exact: false })).toBeFocused();
  await expect(editor(page)).toContainText('Capacity cannot be below the submitted attendance');
  await page.getByLabel('Capacity', { exact: false }).fill('60');
  await page.evaluate(() => { window.failPersistence = 'Local storage is full.'; });
  await page.getByRole('button', { name: 'Save centre changes' }).click();
  await expect(editor(page).getByRole('alert')).toContainText('Local storage is full.');
  await expect(editor(page).getByRole('status')).toContainText('Unsaved');
  expect(await page.evaluate(() => window.centreState.centers[0].capacity)).toBe(48);
  await page.evaluate(() => { window.failPersistence = ''; window.unconfirmedSave = true; });
  await page.getByRole('button', { name: 'Save centre changes' }).click();
  await expect(editor(page).getByRole('alert')).toContainText('not confirmed');
  await expect(page.getByLabel('Capacity', { exact: false })).toHaveValue('60');
});

test('local add-centre validates duplicates and creates a truthful offline inventory', async ({ page }) => {
  await page.getByRole('button', { name: 'Add centre', exact: true }).click();
  await page.getByRole('button', { name: 'Create centre', exact: true }).click();
  await expect(page.getByLabel('Centre ID', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Centre ID', { exact: false }).fill('TC-UP-001');
  await page.getByLabel('Centre name', { exact: false }).fill('Delhi skills centre');
  await page.getByLabel('City', { exact: true }).fill('Delhi');
  await editor(page).getByLabel('State', { exact: false }).fill('Delhi');
  await page.getByLabel('Course', { exact: false }).fill('Electrical installation');
  await page.getByRole('button', { name: 'Create centre', exact: true }).click();
  await expect(editor(page)).toContainText('This centre ID already exists.');
  await page.getByLabel('Centre ID', { exact: false }).fill('TC-DL-013');
  await page.getByRole('button', { name: 'Create centre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delhi skills centre', exact: true })).toBeVisible();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  const saved = await page.evaluate(() => window.centreState.centers.find(centre => centre.id === 'TC-DL-013'));
  expect(saved.connection).toBe('offline');
  expect(saved.claimed).toBe(0);
  expect(saved.detected).toBeNull();
  expect(saved.inventory.every(item => item.detected === null && item.verifiedCount === null && item.approved === 0)).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit centre Delhi skills centre', exact: true })).toBeVisible();
});

test('inventory review requires a note, survives ticks and preserves model output separately', async ({ page }) => {
  await openComputers(page);
  expect(await page.evaluate(() => window.monitorCalls)).toEqual([]);
  await expect(page.getByLabel('Human verified count', { exact: true })).toHaveValue('');
  await page.getByLabel('Human verified count', { exact: true }).fill('0');
  await page.getByLabel('Operability', { exact: true }).selectOption('Out of service');
  await page.getByRole('button', { name: 'Save inventory review' }).click();
  await expect(page.getByLabel('Human-review note', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Human-review note', { exact: false })).toBeFocused();
  await page.getByLabel('Human-review note', { exact: false }).fill('Field visit: units moved for repair; none available.');
  await page.evaluate(() => window.tick());
  await expect(page.getByLabel('Human verified count', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Human-review note', { exact: false })).toHaveValue('Field visit: units moved for repair; none available.');
  await page.getByRole('button', { name: 'Save inventory review' }).click();
  const saved = await computer(page);
  expect(saved.detected).toBe(10);
  expect(saved.approved).toBe(12);
  expect(saved.verifiedCount).toBe(0);
  expect(saved.operability).toBe('Out of service');
  expect(saved.reviewedAt).toBeTruthy();
  await expect(editor(page).getByRole('status')).toHaveText('Saved');
  await expect(editor(page)).toContainText('Inventory review saved');
  await page.reload();
  await openComputers(page);
  await expect(page.getByLabel('Human verified count', { exact: true })).toHaveValue('0');
  await page.getByLabel('Human verified count', { exact: true }).fill('');
  await page.getByLabel('Human-review note', { exact: false }).fill('Previous human count withdrawn pending another inspection.');
  await page.getByRole('button', { name: 'Save inventory review' }).click();
  expect((await computer(page)).verifiedCount).toBeNull();
});

test('verification requests persist, show timestamps, prevent duplicates and filter as pending', async ({ page }) => {
  await openComputers(page);
  await page.getByRole('button', { name: 'Request verification', exact: true }).click();
  await expect(editor(page).getByRole('button', { name: 'Requested', exact: true })).toBeDisabled();
  await expect(editor(page).getByRole('status')).toHaveText('Saved · Requested');
  expect((await computer(page)).verificationRequestedAt).toBeTruthy();
  expect((await computer(page)).verifiedCount ?? null).toBeNull();
  expect(await page.evaluate(() => window.requestCalls.length)).toBe(1);
  await page.getByLabel('Inventory status').selectOption('pending');
  await expect(page.getByRole('button', { name: /^Review .* at / })).toHaveCount(1);
  await page.reload();
  await openComputers(page);
  await expect(editor(page).getByRole('button', { name: 'Requested', exact: true })).toBeDisabled();
  await expect(editor(page).locator('.cw-request-row')).not.toContainText('Not recorded');
  await page.getByLabel('Human-review note', { exact: false }).fill('Approved inventory checked; field count remains unknown.');
  await page.getByRole('button', { name: 'Save inventory review' }).click();
  expect((await computer(page)).reviewStatus).toBe('reviewed');
  await page.getByLabel('Inventory status').selectOption('pending');
  await expect(page.getByRole('heading', { name: 'No inventory matches these filters' })).toBeVisible();
});

test('inventory failures do not claim a saved review or requested inspection', async ({ page }) => {
  await openComputers(page);
  await page.evaluate(() => { window.failPersistence = 'Cannot write review storage.'; });
  await page.getByRole('button', { name: 'Request verification', exact: true }).click();
  await expect(editor(page).getByRole('alert')).toContainText('Cannot write review storage.');
  await expect(page.getByRole('button', { name: 'Request verification', exact: true })).toBeEnabled();
  expect((await computer(page)).reviewStatus).not.toBe('requested');
  await page.getByLabel('Approved count', { exact: false }).fill('15');
  await page.getByLabel('Human-review note', { exact: false }).fill('Sanction order updated.');
  await page.getByRole('button', { name: 'Save inventory review' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Unsaved');
  await expect(page.getByLabel('Approved count', { exact: false })).toHaveValue('15');
  expect((await computer(page)).approved).toBe(12);
});

test('offline assets stay unknown; centre/item selection never invokes monitor implicitly', async ({ page }) => {
  await page.getByRole('button', { name: 'Test infrastructure', exact: true }).click();
  await page.getByLabel('Inventory status').selectOption('offline');
  await expect(page.getByRole('button', { name: /^Review .* at / })).toHaveCount(8);
  await expect(page.locator('.cw-inventory-card').first()).toContainText('Offline · observation unavailable');
  await expect(page.locator('.cw-inventory-card').first()).not.toContainText('meets approved');
  await page.getByRole('button', { name: 'Show inventory for Udaipur Hospitality Institute', exact: true }).click();
  await expect(page.getByLabel('Inventory centre', { exact: true })).toHaveValue('TC-RJ-008');
  await page.getByRole('button', { name: 'Review Training seats at Udaipur Hospitality Institute', exact: true }).click();
  await expect(editor(page)).toContainText('Unavailable');
  expect(await page.evaluate(() => window.monitorCalls)).toEqual([]);
  await page.getByRole('button', { name: 'Open live monitor', exact: true }).click();
  expect(await page.evaluate(() => window.monitorCalls)).toEqual(['TC-RJ-008']);
});

test('unsaved changes are protected when switching records', async ({ page }) => {
  await openCentre(page);
  await page.getByLabel('Centre name', { exact: false }).fill('Unsaved title');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Edit centre Jaipur Skill Development Centre', exact: true }).click();
  await expect(page.getByLabel('Centre name', { exact: false })).toHaveValue('Unsaved title');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Edit centre Jaipur Skill Development Centre', exact: true }).click();
  await expect(page.getByLabel('Centre name', { exact: false })).toHaveValue('Jaipur Skill Development Centre');
});

test('empty networks are usable and explicit focus opens the requested centre', async ({ page }) => {
  await page.evaluate(() => window.focusCentre('TC-BR-004'));
  await expect(page.getByRole('heading', { name: 'Patna Vocational Training Centre', exact: true })).toBeVisible();
  await page.evaluate(() => window.emptyNetwork());
  await expect(page.getByRole('heading', { name: 'No centres yet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add centre', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Test infrastructure', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No inventory records yet' })).toBeVisible();
});

test('optional item focus deep-links to the asset editor without changing sections during ticks', async ({ page }) => {
  await page.evaluate(() => window.focusInventory('TC-UP-001', 'computers'));
  await expect(page.getByRole('heading', { name: 'Computer systems review', exact: true })).toBeVisible();
  await page.getByLabel('Human-review note', { exact: true }).fill('Draft from a targeted review.');
  await page.evaluate(() => window.tick());
  await expect(page.getByLabel('Human-review note', { exact: true })).toHaveValue('Draft from a targeted review.');
  expect(await page.evaluate(() => window.monitorCalls)).toEqual([]);
});

test('320px layouts keep both editors and inventory counts within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openCentre(page);
  await expect(page.getByRole('button', { name: 'Save centre changes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Inspect infrastructure', exact: true }).click();
  await page.getByRole('button', { name: `Review Computer systems at ${centreName}`, exact: true }).click();
  await expect(page.getByLabel('Human-review note', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const target = await page.getByRole('button', { name: 'Save inventory review' }).boundingBox();
  expect(target.height).toBeGreaterThanOrEqual(42);
});
