import {launchPlain,ROOT as REPO_ROOT} from "../helpers/launch.mjs";
const B="http://127.0.0.1:8777";
const stub=`(()=>{window.chrome={runtime:{getURL:p=>"${B}/ext/"+p,sendMessage:(m,cb)=>{cb&&cb({});return Promise.resolve({})},onMessage:{addListener(){},removeListener(){}}},storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}},onChanged:{addListener(){}}},permissions:{contains:async()=>true,request:async()=>true}};})();`;
const b=await launchPlain();
const p=await b.newPage(); await p.setViewport({width:1280,height:800}); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.evaluateOnNewDocument(stub); await p.goto(B+"/ext/editor/editor.html"); await new Promise(r=>setTimeout(r,1000));
const add=()=>p.evaluate(()=>{const c=window.__uiSketch.controller;[1,2,3,4].forEach(i=>c.addShape({id:"s"+i+Math.random(),type:"rect",x:i*60,y:40,w:50,h:50,name:"R"+i}));});
const n=()=>p.evaluate(()=>window.__uiSketch.controller.state.shapes.length);
const R=[]; const t=(a,c,x="")=>R.push([c,a+(x?" — "+x:"")]);
await p.click("#tab-layers"); await add(); await new Promise(r=>setTimeout(r,200));
t("4 layers listed", await p.$$eval(".layer-row",r=>r.length)===4);
// 1. trash icon on a row
const rows=await p.$$(".layer-row"); await rows[0].hover();
const trash=await rows[0].$("[title*=elete]"); t("row has delete (trash) button", !!trash);
if(trash){await trash.click(); await new Promise(r=>setTimeout(r,150)); t("trash deletes that layer", await n()===3, String(await n()));}
// 2. shift range select + Delete key
const r2=await p.$$(".layer-row"); await r2[0].click(); await p.keyboard.down("Shift"); await (await p.$$(".layer-row"))[1].click(); await p.keyboard.up("Shift");
await p.keyboard.press("Delete"); await new Promise(r=>setTimeout(r,150));
t("range select + Delete removes 2", await n()===1, String(await n()));
// 3. context menu delete
await p.click(".layer-row",{button:"right"}); await new Promise(r=>setTimeout(r,150));
const item=await p.evaluateHandle(()=>[...document.querySelectorAll(".layer-menu-item")].find(e=>/delete/i.test(e.textContent)));
t("context menu has Delete", !!item.asElement());
if (item.asElement()) { await item.asElement().click(); await new Promise(r=>setTimeout(r,300)); t("context menu deletes", await n()===0, String(await n())); }
// 4. undo
await p.click("#undo-btn"); await new Promise(r=>setTimeout(r,150)); t("undo restores", await n()===1);
t("no page errors", errs.length===0, errs.join("|"));
await b.close(); for(const [c,a] of R) console.log((c?"PASS ":"FAIL ")+a); 
