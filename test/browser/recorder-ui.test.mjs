import {launchPlain,ROOT as REPO_ROOT} from "../helpers/launch.mjs";
const B="http://127.0.0.1:8777";
const stub=`(()=>{const mem={};const ls=[];
const fire=ch=>ls.forEach(l=>l(ch,"local"));
const store={get:async k=>typeof k==="string"?(k in mem?{[k]:mem[k]}:{}):Array.isArray(k)?Object.fromEntries(k.filter(x=>x in mem).map(x=>[x,mem[x]])):{...mem},set:async o=>{const ch={};for(const[k,v]of Object.entries(o)){ch[k]={newValue:v,oldValue:mem[k]};mem[k]=v}fire(ch)},remove:async()=>{}};
window.__sent=[]; window.__attached=["localhost"];
const handle=(m,cb)=>{window.__sent.push(m.type);
 if(m.type==="REC_START"){const st={active:true,id:"rec-x",startedAt:new Date(Date.now()-65000).toISOString(),counts:{events:5,errors:2,warnings:0,failedRequests:1,markers:0},sites:window.__attached,last:null};store.set({dcRecording:st});cb({ok:true,state:st,attachedApps:window.__attached});}
 else if(m.type==="REC_STOP"){const last={id:"rec-x",ok:window.__stopOk!==false,sent:5,counts:{errors:2},error:window.__stopOk===false?"Can't reach the agent server — is it running?":null,canRetry:window.__stopOk===false};store.set({dcRecording:{active:false,counts:{},sites:[],last}});cb({ok:last.ok,last});}
 else if(m.type==="REC_RETRY"){const last={id:"rec-x",ok:true,sent:5,counts:{errors:2}};cb({ok:true,last});}
 else cb&&cb({ok:true,enabled:false});};
window.chrome={runtime:{getURL:p=>"${B}/ext/"+p,sendMessage:(m,cb)=>{if(cb){handle(m,cb);return}return new Promise(r=>handle(m,r))},onMessage:{addListener(){},removeListener(){}}},storage:{local:store,onChanged:{addListener:f=>ls.push(f),removeListener(){}}},permissions:{contains:async()=>true,request:async()=>true}};})();`;
const b=await launchPlain();
const p=await b.newPage(); await p.setViewport({width:1440,height:800}); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.evaluateOnNewDocument(stub); await p.goto(B+"/ext/editor/editor.html"); await new Promise(r=>setTimeout(r,900));
const R=[]; const t=(n,c,x="")=>R.push([c,n+(x?" — "+x:"")]);
const vis=(sel)=>p.$eval(sel,e=>getComputedStyle(e).display!=="none");
t("idle: Record button visible, live hidden", await vis("#rec-start") && !(await vis("#rec-live")));
t("topbar still one row", await p.$eval("#toolbar",e=>e.getBoundingClientRect().height)===46);
await p.click("#rec-start"); await new Promise(r=>setTimeout(r,400));
t("recording: live pill visible, start hidden", await vis("#rec-live") && !(await vis("#rec-start")));
const tm=await p.$eval("#rec-timer",e=>e.textContent); t("timer shows elapsed >= 01:05", /^01:0[5-9]|^01:1/.test(tm), tm);
t("counts line", (await p.$eval("#rec-counts",e=>e.textContent))==="2 errors · 1 failed request", await p.$eval("#rec-counts",e=>e.textContent));
await new Promise(r=>setTimeout(r,1300)); const tm2=await p.$eval("#rec-timer",e=>e.textContent); t("timer ticks", tm2!==tm, tm+" -> "+tm2);
await p.click("#rec-mark"); t("marker message sent", (await p.evaluate(()=>window.__sent)).includes("REC_MARK"));
await p.click("#rec-stop"); await new Promise(r=>setTimeout(r,300));
t("after stop: idle button back", await vis("#rec-start") && !(await vis("#rec-live")));
const st=await p.$eval("#rec-status",e=>e.textContent); t("success message", /Sent 5 events · 2 errors/.test(st), st);
// failure + retry
await p.evaluate(()=>{window.__stopOk=false}); await p.click("#rec-start"); await new Promise(r=>setTimeout(r,300)); await p.click("#rec-stop"); await new Promise(r=>setTimeout(r,300));
t("failure shows error + Retry", /Can't reach/.test(await p.$eval("#rec-status",e=>e.textContent)) && await vis("#rec-retry"));
await p.click("#rec-retry"); await new Promise(r=>setTimeout(r,300));
t("retry succeeds, Retry hides", /Sent 5 events/.test(await p.$eval("#rec-status",e=>e.textContent)) && !(await vis("#rec-retry")));
// no sites warning
await p.evaluate(()=>{window.__attached=[]}); await p.click("#rec-start"); await new Promise(r=>setTimeout(r,300));
t("no tab captured -> warning", /Open your app on localhost/.test(await p.$eval("#rec-status",e=>e.textContent)) && /Not capturing/.test(await p.$eval("#rec-counts",e=>e.textContent)));
t("no page errors (editor)", errs.length===0, errs.join("|"));
// hover bubble
const hp=await b.newPage(); await hp.setViewport({width:1280,height:800}); await hp.evaluateOnNewDocument(stub); await hp.goto(B+"/page");
for (const f of ["config","state","drag","dom","main"]) await hp.addScriptTag({url:`${B}/ext/hover/hover-${f}.js`});
await new Promise(r=>setTimeout(r,400));
await hp.evaluate(()=>chrome.storage.local.set({dcRecording:{active:true,startedAt:new Date(Date.now()-125000).toISOString(),counts:{},sites:["localhost"]}})); await new Promise(r=>setTimeout(r,700));
const herrs=[]; hp.on("pageerror",e=>herrs.push(String(e)));
await hp.evaluate(()=>chrome.storage.local.set({dcRecording:{active:false,counts:{},sites:[]}})); await new Promise(r=>setTimeout(r,300));
await b.close(); for(const [c,n] of R) console.log((c?"PASS ":"FAIL ")+n);
