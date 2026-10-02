import { test, expect, chromium } from '@playwright/test';
test('camera session queues offline, raises sustained review, syncs exactly once and survives reload', async () => {
 const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({permissions:['camera']});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/\/node_modules\/\.vite\/deps\/@tensorflow_tfjs\.js/, r=>r.fulfill({contentType:'application/javascript',body:'export async function setBackend(){return true};export async function ready(){}'}));
 await page.route(/\/node_modules\/\.vite\/deps\/@tensorflow-models_coco-ssd\.js/, r=>r.fulfill({contentType:'application/javascript',body:'export async function load(){return {detect:async()=>[{class:"person",score:.9}],dispose(){}}};export default {load}'}));
 try {
 await page.goto('/');await page.getByRole('button',{name:'Session evidence',exact:true}).click();
 await page.getByLabel('Sustained mismatch seconds').fill('5');
 await page.getByLabel('Pause synchronization (outage demo)').check();
 await page.getByRole('button',{name:'Use camera',exact:true}).click();
 await expect(page.getByRole('button',{name:'Start evidence session'})).toBeEnabled();
 await page.getByRole('button',{name:'Start evidence session'}).click();
 await expect(page.getByText('Sustained mismatch detected — human review required.',{exact:true})).toBeVisible({timeout:15000});
 await context.setOffline(true);
 await page.getByRole('button',{name:'End session',exact:true}).click();
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-sessions-v1'))[0]);
 expect(saved.samples.length).toBeGreaterThanOrEqual(6);expect(saved.ackCount).toBe(0);expect(saved.endedAt).toBeTruthy();
 await page.getByLabel('Pause synchronization (outage demo)').uncheck();
 await expect(page.getByText(/Waiting to sync — evidence retained locally/)).toBeVisible();
 await context.setOffline(false);
 await page.getByRole('button',{name:'Sync now'}).click();
 await expect(page.getByText('Server acknowledged all evidence',{exact:false})).toBeVisible();
 const id=saved.id;const count=saved.samples.length;
 await page.getByLabel(`Review outcome ${id}`).fill('Reviewed test discrepancy; follow-up required.');
 await page.getByRole('button',{name:'Save review outcome'}).click();
 await expect.poll(async()=> (await (await page.request.get('/api/sessions')).json()).sessions.find(s=>s.id===id)?.review?.note).toBe('Reviewed test discrepancy; follow-up required.');
 await page.getByRole('button',{name:'Sync now'}).click();
 await page.reload();await page.getByRole('button',{name:'Session evidence',exact:true}).click();
 await expect(page.getByText('Server acknowledged all evidence',{exact:false})).toBeVisible();
 const server=await (await page.request.get('/api/sessions')).json();
 expect(server.sessions.filter(s=>s.id===id)).toHaveLength(1);expect(server.sessions.find(s=>s.id===id).sampleCount).toBe(count);
 const other=await browser.newContext();const p=await other.newPage();await p.goto('http://127.0.0.1:5173');await p.getByRole('button',{name:'Session evidence',exact:true}).click();
 await expect(p.getByText('Sustained mismatch — review evidence',{exact:false}).first()).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);await other.close();
 } finally {await browser.close();}
});
