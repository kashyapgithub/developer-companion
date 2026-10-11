import {launchPlain,ROOT as REPO_ROOT} from "../helpers/launch.mjs";
import fs from "node:fs";
const ROOT=REPO_ROOT, B="http://127.0.0.1:8777";
const stub = `(() => {
  if (window.chrome?.runtime?.getURL && window.__stubbed) return; window.__stubbed = true;
  const mem = {}; const listeners = [];
  const store = { get: async (k) => { if (k==null) return {...mem}; if (typeof k==="string") return k in mem?{[k]:mem[k]}:{}; if (Array.isArray(k)) return Object.fromEntries(k.filter(x=>x in mem).map(x=>[x,mem[x]])); return {...k, ...Object.fromEntries(Object.keys(k).filter(x=>x in mem).map(x=>[x,mem[x]]))}; },
    set: async (o) => { const ch={}; for (const [k,v] of Object.entries(o)) { ch[k]={newValue:v,oldValue:mem[k]}; mem[k]=v; } listeners.forEach(l=>l(ch,"local")); },
    remove: async()=>{} };
  window.chrome = { runtime: { getURL: (p)=>"${B}/ext/"+p, sendMessage: (m,cb)=>{ window.__sent=(window.__sent||[]).concat([m]); cb&&cb({ok:true,enabled:true}); return Promise.resolve({ok:true,enabled:true}); }, onMessage:{addListener:(f)=>{window.__msg=f},removeListener(){}} },
    storage: { local: store, onChanged: { addListener: (f)=>listeners.push(f), removeListener(){} } },
    permissions: { contains: async()=>true, request: async()=>true } };
})();`;
const results=[]; const ok=(n,c,extra="")=>{results.push([c,n+(extra?" — "+extra:"")]);};
const browser = await launchPlain();
const page = await browser.newPage(); await page.setViewport({width:1280,height:800});
const errs=[]; page.on("pageerror",e=>errs.push(String(e)));
await page.evaluateOnNewDocument(stub);
await page.goto(B+"/page");
for (const f of ["config","state","drag","dom","main"]) await page.addScriptTag({url:`${B}/ext/hover/hover-${f}.js`});
await new Promise(r=>setTimeout(r,400));
const q = (sel) => page.evaluate((sel)=>{ const h=document.getElementById("dc-hover-host"); return !!h; }, sel);
ok("host injected", await q());
// closed shadow root: access via test hook not available -> use elementFromPoint on bubble position
const bubblePos = await page.evaluate(()=>({x:innerWidth-52-24+26,y:innerHeight-52-24+26}));
const bubbleHit = await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,bubblePos);
ok("bubble present at bottom-right (host hit)", bubbleHit==="dc-hover-host", String(bubbleHit));
// click bubble => opens panel (iframe lazily created)
await page.mouse.click(bubblePos.x,bubblePos.y); await new Promise(r=>setTimeout(r,1500));
ok("editor iframe frame exists after open", page.frames().some(f=>f.url().includes("editor.html?embedded=1")));
const ed = page.frames().find(f=>f.url().includes("editor.html"));
ok("editor html has embedded class", ed && await ed.evaluate(()=>document.documentElement.classList.contains("embedded")));
ok("hover button hidden when embedded", ed && await ed.evaluate(()=>getComputedStyle(document.getElementById("hover-mode-btn")).display==="none"));
ok("editor boots (controller exists)", ed && await ed.evaluate(()=>!!window.__uiSketch));
// drag header
const st = JSON.parse(await page.evaluate(async()=>JSON.stringify((await chrome.storage.local.get("dcHoverState")).dcHoverState)));
ok("state saved, not minimized", st && st.minimized===false);
const hx = st.panel.x+200, hy = st.panel.y+18;
await page.mouse.move(hx,hy); await page.mouse.down(); await page.mouse.move(hx-300,hy+120,{steps:8}); await page.mouse.up();
await new Promise(r=>setTimeout(r,200));
const st2 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("panel dragged by (-300,+120)", Math.abs(st2.panel.x-(st.panel.x-300))<=2 && Math.abs(st2.panel.y-(st.panel.y+120))<=2, JSON.stringify(st2.panel));
// resize via grip (bottom-right corner)
const gx=st2.panel.x+st2.panel.w-6, gy=st2.panel.y+st2.panel.h-6;
await page.mouse.move(gx,gy); await page.mouse.down(); await page.mouse.move(gx-200,gy-100,{steps:6}); await page.mouse.up();
const st3 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("panel resized smaller", st3.panel.w < st2.panel.w-150 && st3.panel.h < st2.panel.h-80, `${st2.panel.w}x${st2.panel.h} -> ${st3.panel.w}x${st3.panel.h}`);
// drag far off-screen -> clamped
const hx3=st3.panel.x+150, hy3=st3.panel.y+18;
await page.mouse.move(hx3,hy3); await page.mouse.down(); await page.mouse.move(5000>1280?1270:0,790,{steps:5}); await page.mouse.up();
const st4 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("window clamped inside viewport", st4.panel.x<=1280-80 && st4.panel.y<=800-40, JSON.stringify(st4.panel));
// bring window back to the middle so the header buttons are on screen
{ const hx=st4.panel.x+100, hy=st4.panel.y+18; await page.mouse.move(hx,hy); await page.mouse.down(); await page.mouse.move(300,100,{steps:6}); await page.mouse.up(); }
const st4b = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
Object.assign(st4.panel, st4b.panel);
// minimize: find button by position of header buttons (right side) -> use keyboard-free approach: click at header right area
const mx = st4.panel.x+st4.panel.w-8-26-4-13-0, my = st4.panel.y+18; // minimize button is 2nd from right
await page.mouse.click(mx,my); await new Promise(r=>setTimeout(r,200));
const st5 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("minimize button minimizes", st5.minimized===true, `at ${mx},${my}`);
// iframe kept alive (state preserved)
ok("iframe kept after minimize", page.frames().some(f=>f.url().includes("editor.html")));
// drag bubble, then click restores
const bx=st5.bubble.x+26, by=st5.bubble.y+26;
await page.mouse.move(bx,by); await page.mouse.down(); await page.mouse.move(bx-400,by-300,{steps:6}); await page.mouse.up();
const st6 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("bubble dragged, still minimized", st6.minimized===true && st6.bubble.x < st5.bubble.x-300, JSON.stringify(st6.bubble));
await page.mouse.click(st6.bubble.x+26,st6.bubble.y+26); await new Promise(r=>setTimeout(r,200));
const st7 = await page.evaluate(async()=>(await chrome.storage.local.get("dcHoverState")).dcHoverState);
ok("click on bubble restores window", st7.minimized===false);
// HOVER_REMOVE
await page.evaluate(()=>window.__msg({type:"HOVER_REMOVE"}));
ok("HOVER_REMOVE removes host", !(await q()));
ok("no page errors", errs.length===0, errs.join("|"));
// autosave: draw a rect in a fresh editor page, check draft written
const ep = await browser.newPage(); await ep.evaluateOnNewDocument(stub); await ep.setViewport({width:1280,height:800});
const eerr=[]; ep.on("pageerror",e=>eerr.push(String(e)));
await ep.goto(B+"/ext/editor/editor.html"); await new Promise(r=>setTimeout(r,800));
await ep.evaluate(()=>{ window.__uiSketch.controller.addShape({type:"rect",x:10,y:10,w:80,h:50,id:"t1",name:"T"}); });
await new Promise(r=>setTimeout(r,900));
const draft = await ep.evaluate(async()=>(await chrome.storage.local.get("dcCanvasDraft")).dcCanvasDraft);
ok("autosave wrote draft", draft && draft.shapes?.length>=1, draft && String(draft.shapes?.length));
// remote apply: simulate another instance writing
await ep.evaluate(async()=>{ await chrome.storage.local.set({dcCanvasDraft:{by:"other",at:1,shapes:[{id:"r1",type:"rect",x:0,y:0,w:10,h:10,name:"R"},{id:"r2",type:"rect",x:20,y:0,w:10,h:10,name:"R2"}]}}); });
await new Promise(r=>setTimeout(r,200));
const n = await ep.evaluate(()=>window.__uiSketch.controller.state.shapes.length);
ok("remote draft applied", n===2, String(n));
ok("editor no page errors", eerr.length===0, eerr.join("|"));
await browser.close();
for (const [c,n] of results) console.log((c?"PASS ":"FAIL ")+n);
process.exit(results.every(r=>r[0])?0:1);
