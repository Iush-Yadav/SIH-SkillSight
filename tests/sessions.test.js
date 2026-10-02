import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addSample, summarizeSession, syncPayload } from '../src/sessionEngine.js';
import { mergeSession } from '../server/sessionApi.js';
import { normalizeState, saveVision, simulateTick, saveSettings } from '../src/appState.js';
import { compileReport } from '../src/reports.js';
const fresh = () => createSession({centreId:'TC-TEST-001',centreName:'Test',claimed:20,threshold:3,sustainedSeconds:5,source:'camera'},'2026-10-03T00:00:00.000Z');
test('sustained mismatch needs continuous observed duration; gaps and unknowns break the window', () => {
 let s=fresh(); for(let i=0;i<=5;i++) s=addSample(s,i*1000,10);
 assert.equal(summarizeSession(s).needsReview,true);assert.equal(summarizeSession(s).coveredMs,5000);
 let gap=fresh();gap=addSample(gap,0,10);gap=addSample(gap,1000,10);gap=addSample(gap,7000,10);gap=addSample(gap,8000,null);gap=addSample(gap,9000,10);
 assert.equal(summarizeSession(gap).needsReview,false);assert.equal(summarizeSession(gap).coveredMs,1000);assert.equal(summarizeSession(gap).unknownMs,8000);
});
test('server deduplicates retries, rejects conflicts and recomputes metrics from actual samples', () => {
 let s=fresh();for(let i=0;i<=6;i++) s=addSample(s,i*1000,10);
 s={...s,endedAt:'2026-10-03T00:00:06.000Z',endReason:'completed'};
 const payload={...syncPayload(s),summary:{needsReview:false}};
 const first=mergeSession([],payload);const retry=mergeSession(first.records,payload);
 assert.equal(retry.records.length,1);assert.equal(retry.session.samples.length,7);assert.equal(retry.session.summary.needsReview,true);
 assert.throws(()=>mergeSession(first.records,{...payload,samples:[{elapsedMs:0,persons:99}]}),/Conflicting/);
 assert.throws(()=>mergeSession([],{...payload,offset:2}),/Missing/);
});
test('incremental batches keep the end marker until the final batch', () => {
 let s=fresh();for(let i=0;i<150;i++)s=addSample(s,i*1000,20);
 s={...s,endedAt:'2026-10-03T00:02:30.000Z'};const first=syncPayload(s);assert.equal(first.samples.length,100);assert.equal(first.endedAt,null);
 const second=syncPayload({...s,ackCount:100});assert.equal(second.samples.length,50);assert.equal(second.endedAt,s.endedAt);
});
test('AI save preserves register; explicit full-view confirmation updates seating without inventing operability', () => {
 const state=normalizeState(null);const next=saveVision(state,state.centers[0].id,{persons:2,chairs:3,claimed:0,applyChairs:true});
 assert.equal(next.centers[0].claimed,40);assert.equal(next.centers[0].inventory[0].detected,3);assert.equal(next.centers[0].inventory[0].operability,'Unknown');
 const untouched=saveVision(state,state.centers[0].id,{persons:2,chairs:3,claimed:0});assert.equal(untouched.centers[0].inventory[0].detected,48);
});
test('tick and policy changes evaluate mismatch alerts, with deduplication', () => {
 const s=normalizeState(null);s.alerts=[];s.centers[1].claimed=36;s.centers[1].detected=27;
 const next=simulateTick(s,()=>0);assert.equal(next.alerts.filter(a=>a.centreId===s.centers[1].id).length,1);
 const repeated=simulateTick(next,()=>0);assert.equal(repeated.alerts.filter(a=>a.centreId===s.centers[1].id).length,1);
 const policy=saveSettings(s,{...s.settings,mismatchThreshold:5});assert.ok(policy.alerts.some(a=>a.centreId===s.centers[1].id));
});
test('offline camera connectivity does not discard a real saved local observation in reports', () => {
 let s=normalizeState(null);const c=s.centers.find(c=>c.connection==='offline');s=saveVision(s,c.id,{persons:20,chairs:2,claimed:0});
 const r=compileReport(s,{type:'attendance',period:'7d',centreId:c.id,sections:{attendance:true,infrastructure:false,reviews:false}});
 assert.equal(r.summary.attendance.observedTotal,20);assert.equal(s.centers.find(x=>x.id===c.id).connection,'offline');
});
