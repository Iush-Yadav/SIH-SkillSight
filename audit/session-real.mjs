import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const c=await b.newContext({permissions:['camera'],viewport:{width:1440,height:1000}});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
try {
 await p.goto('http://127.0.0.1:5173');await p.getByRole('button',{name:'Session evidence',exact:true}).click();
 await p.getByRole('button',{name:'Use camera',exact:true}).click();await p.getByRole('button',{name:'Start evidence session'}).click();
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('skillsight-sessions-v1')||'[]')[0]?.samples.length>=3,{},{timeout:60000});
 await p.getByRole('button',{name:'End session',exact:true}).click();
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('skillsight-sessions-v1')||'[]')[0]?.endSynced,{},{timeout:15000});
 const record=await p.evaluate(()=>JSON.parse(localStorage.getItem('skillsight-sessions-v1'))[0]);
 await p.screenshot({path:'audit/session-desktop.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'audit/session-mobile.png',fullPage:true});
 const result={record,errors,mobileOverflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),note:'Real COCO-SSD model; synthetic Chromium camera, not field accuracy validation.'};await writeFile('audit/session-real-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await b.close();}
