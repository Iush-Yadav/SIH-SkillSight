import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle only the owned component: no dev server or dashboard entry-point changes.
// esbuild is already supplied by Vite; output stays in memory.
let javascript;
let stylesheet;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import AttendanceChart from './src/components/AttendanceChart.jsx';
        import { dailyTrend } from './src/data.js';
        import './src/styles.css';
        const root = createRoot(document.getElementById('root'));
        window.chartReportCalls = 0;
        window.renderAttendanceChart = (points = dailyTrend) => root.render(
          <AttendanceChart points={points} onViewReport={() => window.chartReportCalls++} />
        );
        window.renderAttendanceChart();
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    outdir: 'in-memory-chart-test',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  javascript = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  // Avoid depending on the dashboard's remotely hosted font stylesheet.
  stylesheet = result.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*;/g, '');
});

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.setContent('<html><head></head><body style="padding:12px"><main id="root" style="width:min(680px, 100%);margin:20px auto"></main></body></html>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: javascript });
  await expect(page.getByRole('heading', { name: 'Attendance, in focus.' })).toBeVisible();
});

const point = (page, time) => page.getByRole('button', { name: new RegExp(`^${time}: reported`) });
const details = page => page.getByRole('status');

test('shows the actual latest synthetic counts and invokes the report callback', async ({ page }) => {
  await expect(page.getByText('Synthetic demo', { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic data, not live statistics/)).toBeVisible();
  await expect(details(page)).toContainText('16:00');
  await expect(details(page).locator('dd')).toHaveText(['369', '411', '−42−10.2%']);
  await expect(page.locator('.ac-point')).toHaveCount(8);
  await page.getByRole('button', { name: 'View report', exact: true }).click();
  expect(await page.evaluate(() => window.chartReportCalls)).toBe(1);
});

test('hover, focus, arrows, Home/End, and click expose the exact selected sample', async ({ page }) => {
  await point(page, '09:00').hover();
  await expect(details(page).locator('dd')).toHaveText(['310', '368', '−58−15.8%']);
  await point(page, '11:00').focus();
  await expect(details(page).locator('dd')).toHaveText(['370', '402', '−32−8.0%']);
  await page.keyboard.press('ArrowRight');
  await expect(point(page, '12:00')).toBeFocused();
  await expect(details(page).locator('dd')).toHaveText(['348', '405', '−57−14.1%']);
  await page.keyboard.press('Home');
  await expect(point(page, '09:00')).toBeFocused();
  await page.keyboard.press('End');
  await expect(point(page, '16:00')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(point(page, '16:00')).toHaveAttribute('aria-pressed', 'true');
  await point(page, '13:00').click();
  await expect(details(page).locator('dd')).toHaveText(['305', '387', '−82−21.2%']);
});

test('range, chart mode and visibility controls change the drawing without hiding both series', async ({ page }) => {
  const observed = page.getByRole('button', { name: 'Observed', exact: true });
  const reported = page.getByRole('button', { name: 'Reported', exact: true });
  await observed.click();
  await expect(page.locator('[data-series="observed"]')).toHaveCount(0);
  await expect(observed).toHaveAttribute('aria-pressed', 'false');
  await expect(reported).toHaveAttribute('aria-disabled', 'true');
  await reported.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-series="reported"]')).toHaveCount(1);
  await expect(reported).toHaveAttribute('aria-pressed', 'true');
  await observed.click();
  await reported.click();
  await expect(observed).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-series="reported"]')).toHaveCount(0);
  await reported.click();
  await page.getByRole('button', { name: 'Bars', exact: true }).click();
  await expect(page.locator('.ac-bar')).toHaveCount(16);
  await expect(page.locator('.ac-line')).toHaveCount(0);
  await point(page, '10:00').focus();
  await page.getByRole('button', { name: 'Last 4 points', exact: true }).click();
  await expect(page.locator('.ac-point')).toHaveCount(4);
  await expect(page.locator('.ac-bar')).toHaveCount(8);
  await expect(point(page, '09:00')).toHaveCount(0);
  await expect(details(page)).toContainText('16:00');
  await expect(page.getByText(/13:00–16:00 · 4 samples/)).toBeVisible();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(page.locator('.ac-line')).toHaveCount(2);
  await page.getByRole('button', { name: 'All points', exact: true }).click();
  await expect(page.locator('.ac-point')).toHaveCount(8);
});

test('drawings and details respond to supplied values; invalid samples are not zero observations', async ({ page }) => {
  const originalPath = await page.locator('.ac-line-observed').getAttribute('d');
  await page.evaluate(() => window.renderAttendanceChart([
    { time: '09:00', reported: 0, observed: 4 },
    { time: '10:00', reported: 12, observed: null },
  ]));
  await expect(page.locator('.ac-point')).toHaveCount(1);
  await expect(details(page).locator('dd')).toHaveText(['4', '0', '+4No reported baseline']);
  await expect(page.getByText('1 invalid sample not plotted.')).toBeVisible();
  await expect(page.locator('.ac-line-observed')).not.toHaveAttribute('d', originalPath);
  await page.evaluate(() => window.renderAttendanceChart([]));
  await expect(page.getByText('No attendance samples yet')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.ac-svg')).toHaveCount(0);
  await page.evaluate(() => window.renderAttendanceChart([{ time: '12:00', reported: 0, observed: 0 }]));
  await expect(details(page).locator('dd')).toHaveText(['0', '0', '0No reported baseline']);
  await expect(page.getByText('Counts match', { exact: true })).toBeVisible();
});

test('320px layout has no overflow, retains usable targets, and supports touch selection', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 900 }, hasTouch: true });
  const mobile = await context.newPage();
  try {
    await mobile.route('https://**/*', route => route.abort());
    await mobile.setContent('<body style="padding:12px"><main id="root"></main></body>');
    await mobile.addStyleTag({ content: stylesheet });
    await mobile.addScriptTag({ content: javascript });
    await expect(point(mobile, '09:00')).toBeVisible();
    await point(mobile, '09:00').tap();
    await expect(details(mobile).locator('dd')).toHaveText(['310', '368', '−58−15.8%']);
    await mobile.getByRole('button', { name: 'Bars', exact: true }).tap();
    await point(mobile, '13:00').tap();
    await expect(details(mobile).locator('dd')).toHaveText(['305', '387', '−82−21.2%']);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const target = await point(mobile, '09:00').boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(24);
    expect(target.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test('reduced motion disables chart animations in both modes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.ac-line-observed').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.locator('.ac-area').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Bars', exact: true }).click();
  expect(await page.locator('.ac-bar').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});
