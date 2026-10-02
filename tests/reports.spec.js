import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeInitialState } from '../src/data.js';

// Exercise the delegated component's exact parent contract without depending on
// unrelated navigation/persistence implementation. The real parent owns storage.
async function mountReports(page, request, { empty = false } = {}) {
  const main = await (await request.get('/src/main.jsx')).text();
  const component = await (await request.get('/src/components/ReportsView.jsx')).text();
  const reactPath = component.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1];
  const domPath = main.match(/from\s+["']([^"']*react-dom_client\.js[^"']*)["']/)?.[1];
  expect(reactPath, 'Vite optimised React import').toBeTruthy();
  expect(domPath, 'Vite optimised React DOM import').toBeTruthy();
  const state = { ...makeInitialState(), reports: [], dataRevision: 0 };
  if (empty) state.centers = [];
  await page.route('**/reports-component-test', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
      import React from ${JSON.stringify(reactPath)};
      import ReactDOM from ${JSON.stringify(domPath)};
      const { useState } = React;
      const { createRoot } = ReactDOM;
      import ReportsView from '/src/components/ReportsView.jsx';
      import { compileReport } from '/src/reports.js';
      const initial = ${JSON.stringify(state).replaceAll('<', '\\u003c')};
      function Harness() {
        const [state, setState] = useState(initial);
        const [mounted, setMounted] = useState(true);
        window.reportTestState = state;
        function onCompile(options) {
          if (window.failCompile) throw new Error('Simulated storage refusal');
          const report = compileReport(state, options);
          setState(current => ({ ...current, reports: [report, ...current.reports] }));
          window.lastCompiledReport = report;
          return report;
        }
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => setState(current => ({ ...current, dataRevision: current.dataRevision + 1, centers: current.centers.map((centre, index) => index ? centre : { ...centre, claimed: centre.claimed + 11 }) })) }, 'Test source change'),
          React.createElement('button', { onClick: () => setMounted(value => !value) }, 'Test remount'),
          mounted && React.createElement(ReportsView, { appState: state, onCompile, onDownload: message => { window.downloadMessage = message; } })
        );
      }
      createRoot(document.getElementById('root')).render(React.createElement(Harness));
    </script></body></html>`,
  }));
  await page.goto('/reports-component-test');
  await expect(page.getByRole('form', { name: 'Report builder' })).toBeVisible();
}

async function download(page, button) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await pending;
  return { filename: result.suggestedFilename(), content: await readFile(await result.path(), 'utf8') };
}

test('builder presets, scoped preview, actual downloads, stale source and immutable archive', async ({ page, request }) => {
  await mountReports(page, request);
  await expect(page.getByRole('heading', { name: 'No compiled report yet' })).toBeVisible();
  await page.getByLabel('Report type', { exact: true }).selectOption('infrastructure');
  await expect(page.getByLabel('Reporting period', { exact: true })).toHaveValue('30d');
  await expect(page.getByRole('checkbox', { name: /Attendance reconciliation/ })).not.toBeChecked();
  await page.getByLabel('Centre scope', { exact: true }).selectOption('TC-UP-001');
  await page.getByRole('checkbox', { name: /Review decisions/ }).uncheck();
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  const preview = page.getByRole('article', { name: 'Compiled report preview' });
  await expect(preview.getByRole('heading', { name: 'CURRENT infrastructure snapshot' })).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'CURRENT attendance snapshot' })).toHaveCount(0);
  await expect(preview.getByRole('heading', { name: 'Dated review events' })).toHaveCount(0);
  await expect(preview.locator('.ss-report-badge')).toHaveText('Compiled');
  const first = await page.evaluate(() => window.lastCompiledReport);
  expect(first.centers).toHaveLength(1);
  expect(first.alerts).toEqual([]);
  const html = await download(page, 'Download HTML');
  expect(html.filename).toMatch(/\.html$/);
  expect(html.content).toContain(first.id);
  expect(html.content).toContain('CURRENT infrastructure snapshot');
  expect(html.content).not.toContain('Jaipur Skill Development Centre');
  expect(html.content).toContain('Print / Save as PDF');
  expect(html.content).toContain('@media print');
  const json = await download(page, 'Download JSON');
  expect(JSON.parse(json.content)).toEqual(first);
  expect(await page.evaluate(() => typeof window.downloadMessage)).toBe('string');

  await page.getByLabel('Reporting period', { exact: true }).selectOption('quarter');
  await expect(preview.getByText('The builder scope or sections differ from this saved report.')).toBeVisible();
  await page.getByLabel('Reporting period', { exact: true }).selectOption('30d');
  await page.getByRole('button', { name: 'Test source change', exact: true }).click();
  await expect(preview.getByText('Source data has changed since this snapshot was compiled.')).toBeVisible();
  expect(JSON.parse((await download(page, 'Download JSON')).content)).toEqual(first);

  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  const second = await page.evaluate(() => window.lastCompiledReport);
  expect(second.id).not.toBe(first.id);
  expect(second.sourceRevision).toBe(1);
  const archive = page.getByRole('region', { name: 'Report archive' });
  await expect(archive.getByRole('button')).toHaveCount(2);
  await archive.getByRole('button').nth(1).click();
  await expect(preview.getByText(first.id, { exact: true })).toBeVisible();
  expect(JSON.parse((await download(page, 'Download JSON')).content)).toEqual(first);
  await page.getByRole('button', { name: 'Test remount', exact: true }).click();
  await page.getByRole('button', { name: 'Test remount', exact: true }).click();
  await expect(archive.getByRole('button')).toHaveCount(2);
  await expect(preview.getByText(second.id, { exact: true })).toBeVisible();
});

test('empty selections are disabled and compilation failures do not invent a report', async ({ page, request }) => {
  await mountReports(page, request);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(page.getByRole('button', { name: 'Compile report', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Select at least one report section.');
  await page.getByRole('checkbox', { name: /Review decisions/ }).check();
  await page.evaluate(() => { window.failCompile = true; });
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Simulated storage refusal');
  await expect(page.getByRole('heading', { name: 'No compiled report yet' })).toBeVisible();
  expect(await page.evaluate(() => window.reportTestState.reports)).toEqual([]);
});

test('an empty centre network cannot compile a report', async ({ page, request }) => {
  await mountReports(page, request, { empty: true });
  await expect(page.getByRole('button', { name: 'Compile report', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('No centres are available');
});

test('integrated parent persists compiled reports across reload and downloads the stored snapshot', async ({ page }) => {
  const seed = makeInitialState();
  seed.settings.demoUpdates = false;
  await page.addInitScript(state => {
    if (!localStorage.getItem('skillsight-state')) localStorage.setItem('skillsight-state', JSON.stringify(state));
  }, seed);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Reports', exact: true }).click();
  await page.getByLabel('Centre scope', { exact: true }).selectOption('TC-UP-001');
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('skillsight-state')).reports[0]);
  expect(stored.options.centreId).toBe('TC-UP-001');
  expect(stored.centers).toHaveLength(1);
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Compiled report preview' }).getByText(stored.id, { exact: true })).toBeVisible();
  expect(JSON.parse((await download(page, 'Download JSON')).content)).toEqual(stored);
});

test('mobile report preview fits the viewport and honours reduced motion', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountReports(page, request);
  await page.getByRole('button', { name: 'Compile report', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Compiled report preview' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator('.ss-report-preview').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});
