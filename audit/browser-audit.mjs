import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await context.newPage();
const output = {errors:[],failedRequests:[],pages:[]};
page.on('pageerror', e=>output.errors.push(e.message));
page.on('requestfailed', r=>output.failedRequests.push({url:r.url(),error:r.failure()}));
await page.goto('http://127.0.0.1:5173');
await page.screenshot({path:'audit/desktop.png',fullPage:true});
const nav = name=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:name!=='Alerts & review'});
for (const name of ['Overview','Live monitor','Training centres','Infrastructure','Alerts & review','Reports']) {
 await nav(name).click(); output.pages.push({name,heading:await page.locator('h1').innerText(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
}
await nav('Training centres').click();
await page.getByRole('button',{name:'Add centre',exact:true}).click();
for(const [label,value] of [['Centre ID','TC-AUDIT-900'],['Centre name','Audit test centre'],['City','Pune'],['State','Maharashtra'],['Course','IT training'],['Capacity','32'],['Registered cameras','0'],['Centre review notes','Audit only']]) {
 const input=label==='State'?page.getByRole('textbox',{name:'State',exact:true}):page.getByLabel(label,{exact:true}); await input.fill(value);
}
await page.getByRole('button',{name:'Create centre',exact:true}).click();
await page.reload();
output.addCentre=await page.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-state')).centers.find(c=>c.id==='TC-AUDIT-900'));
output.registerBeforeVision=await page.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-state')).centers[0].claimed);
await nav('Live monitor').click(); await page.getByRole('button',{name:'Vision Lab',exact:true}).click();
await page.getByRole('button',{name:'Load AI model',exact:true}).click();
try {await page.getByRole('button',{name:'Model ready',exact:true}).waitFor({timeout:60000});output.realModel='ready';
const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,320,240);return c.toDataURL().split(',')[1]});
await page.getByLabel('Choose an image or video from your device').setInputFiles({name:'blank-control.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
await page.getByRole('button',{name:'Analyze image',exact:true}).click();
await page.getByRole('button',{name:'Save count summary',exact:true}).waitFor();
await page.getByRole('button',{name:'Save count summary',exact:true}).click({timeout:30000});
output.registerAfterVision=await page.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-state')).centers[0].claimed);
output.realInference=await page.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-state')).centers[0].analysis);
} catch(e) {output.realModelError=e.message;output.visionText=await page.locator('.vision-lab').count()?await page.locator('.vision-lab').innerText():await page.locator('body').innerText();}
await page.screenshot({path:'audit/vision.png',fullPage:true});
await context.close();
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await mobile.newPage();await p.goto('http://127.0.0.1:5173');await p.screenshot({path:'audit/mobile.png',fullPage:true});output.mobileOverflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
await browser.close();await writeFile('audit/browser-results.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
