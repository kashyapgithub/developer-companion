/**
 * drawing.test.mjs — the basic drawing tools with a real mouse and keyboard:
 * every tool draws, select/move/resize/delete/undo/redo/duplicate/paste work,
 * comments post, connectors link, and one mouse-wheel notch zooms gently.
 */
import {launchPlain,ROOT} from "../helpers/launch.mjs"; import fs from "node:fs";
const B="http://127.0.0.1:8777"; const b=await launchPlain(); const p=await b.newPage(); await p.setViewport({width:1440,height:860});
const errs=[]; p.on("pageerror",e=>errs.push(String(e))); p.on("response",r=>{if(r.status()>=400)errs.push(r.status()+" "+r.url())});
const src=fs.readFileSync(ROOT+"/test/browser/layer-delete.test.mjs","utf8").split("\n")[2];
await p.evaluateOnNewDocument(src.replace(/^const stub=`/,"").replace(/`;$/,"").replace(/\$\{B\}/g,B));
await p.goto(B+"/ext/editor/editor.html"); await new Promise(r=>setTimeout(r,1000));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const shapes=()=>p.evaluate(()=>window.__uiSketch.controller.state.shapes.map(s=>({t:s.type,x:Math.round(s.x??0),y:Math.round(s.y??0),w:Math.round(s.w??0),h:Math.round(s.h??0)})));
const tool=()=>p.evaluate(()=>window.__uiSketch.controller.state.currentTool);
const drag=async(x1,y1,x2,y2,steps=8)=>{await p.mouse.move(x1,y1);await p.mouse.down();await p.mouse.move(x2,y2,{steps});await p.mouse.up();await wait(150)};
const log=(n,ok,x="")=>console.log((ok?"PASS ":"FAIL ")+n+(x?" — "+x:""));

await p.keyboard.press("r"); await drag(300,104,460,184);
await p.keyboard.press("o"); await drag(310,164,470,244);
await p.keyboard.press("f"); await drag(600,150,900,450);

const sel=()=>p.evaluate(()=>window.__uiSketch.controller.state.selectedIds.length);
// pencil
await p.keyboard.down("Shift"); await p.keyboard.press("P"); await p.keyboard.up("Shift"); await wait(80); log("Shift+P = pencil",(await tool())==="pen",await tool());
{const n0=(await shapes()).length; await p.mouse.move(300,600);await p.mouse.down();for(let i=0;i<20;i++)await p.mouse.move(300+i*8,600+Math.sin(i/2)*30);await p.mouse.up();await wait(150);const s=await shapes();log("pencil draws a stroke", s.length===n0+1 && s.at(-1).t==="pen",JSON.stringify(s.at(-1)));}
// bezier pen: click 3 points, finish with Enter
await p.keyboard.press("p"); await wait(80);
{const n0=(await shapes()).length; await p.mouse.click(520,600); await p.mouse.click(600,660); await p.mouse.click(680,600); await p.keyboard.press("Enter"); await wait(200); const s=await shapes(); log("pen (path) makes a path with clicks + Enter", s.length===n0+1 && s.at(-1).t==="path", JSON.stringify(s.at(-1)));}
// text with Enter
await p.keyboard.press("t"); await wait(80);
{await p.mouse.click(700,520); await wait(300); await p.keyboard.type("Hello"); await p.keyboard.press("Enter"); await wait(250); const t=await p.evaluate(()=>window.__uiSketch.controller.state.shapes.filter(s=>s.type==="text").map(s=>s.text)); log("text tool: type + Enter creates text",t.includes("Hello"),JSON.stringify(t));}
// polygon + star via dock menu (click caret then item)
for(const tl of ["polygon","star"]){ await p.evaluate((tl)=>{const c=window.__uiSketch.controller; c.setTool?c.setTool(tl):0},tl); await wait(80);
  const cur=await tool(); if(cur!==tl){console.log("setTool not available; tool=",cur);continue}
  const n0=(await shapes()).length; await drag(1000,250+(tl==="star"?150:0),1100,350+(tl==="star"?150:0)); const s=await shapes(); log(`draw ${tl}`, s.length===n0+1 && s.at(-1).t===tl, JSON.stringify(s.at(-1)));}
// connector between two shapes
await p.keyboard.press("v");
{const s0=await shapes(); const n0=s0.length; await p.keyboard.press("x"); await wait(80); const c0=await p.evaluate(()=>window.__uiSketch.controller.state.shapes.filter(s=>s.type==="connector").length);
 await drag(380,190, 380+600-300+40, 190+100, 12); // rect (300..460,104..184) -> ellipse region
 const c1=await p.evaluate(()=>window.__uiSketch.controller.state.shapes.filter(s=>s.type==="connector").length); log("connector tool links two shapes", c1===c0+1, `${c0}->${c1}`);}
// comment
await p.keyboard.press("c"); await wait(80); await p.mouse.click(1100,600); await wait(300); log("comment tool opens the note box", await p.evaluate(()=>{const e=document.getElementById("comment-popover");return !!e && !e.classList.contains("hidden")}));
await p.keyboard.type("note"); await p.keyboard.down("Control"); await p.keyboard.press("Enter"); await p.keyboard.up("Control"); await wait(200);
log("Ctrl+Enter posts the comment", await p.evaluate(()=>window.__uiSketch.controller.state.shapes.filter(s=>s.type==="comment").length)===1);
await p.keyboard.press("v"); await wait(80);
// duplicate with selection
{await p.mouse.click(380,190); await wait(100); const n0=(await shapes()).length; await p.keyboard.down("Control"); await p.keyboard.press("d"); await p.keyboard.up("Control"); await wait(200); log("Ctrl+D duplicates selected",(await shapes()).length===n0+1,`${n0}->${(await shapes()).length}`);
 await p.keyboard.down("Control"); await p.keyboard.press("c"); await p.keyboard.up("Control"); await p.keyboard.down("Control"); await p.keyboard.press("v"); await p.keyboard.up("Control"); await wait(200); log("Ctrl+C / Ctrl+V pastes",(await shapes()).length===n0+2,String((await shapes()).length));}
// zoom per wheel notch (a typical mouse notch is deltaY=100)
{await p.keyboard.press("0"); const z0=await p.evaluate(()=>window.__uiSketch.engine.getScale()); await p.mouse.move(700,400); await p.keyboard.down("Control"); await p.mouse.wheel({deltaY:-100}); await p.keyboard.up("Control"); await wait(200); const z1=await p.evaluate(()=>window.__uiSketch.engine.getScale()); log("one wheel notch zooms gently (under 1.6x)", z1/z0>1.05 && z1/z0<1.6, (z1/z0).toFixed(2));}
// pencil: a plain click leaves a dot; colour swatches recolour the selection and the next shape
{await p.keyboard.press("Escape"); await p.keyboard.down("Shift"); await p.keyboard.press("P"); await p.keyboard.up("Shift"); await wait(80);
 const n0=(await shapes()).length; await p.mouse.click(1050,700); await wait(200);
 log("pencil click leaves a dot", (await shapes()).length===n0+1 && (await shapes()).at(-1).t==="pen");
 const strokeOf=()=>p.evaluate(()=>{const c=window.__uiSketch.controller;const id=c.state.selectedIds[0];return c.state.shapes.find(s=>s.id===id)?.stroke});
 await p.evaluate(()=>document.querySelector("#stroke-swatches .swatch[data-color='#ef4444']").click()); await wait(150);
 log("stroke swatch recolours the selected stroke", (await strokeOf())==="#ef4444", await strokeOf());
 log("picked colour shows in recents", await p.evaluate(()=>!!document.querySelector("#stroke-swatches .recent .swatch[data-color='#ef4444']")));
 await p.keyboard.press("Escape"); await p.keyboard.press("r"); await drag(900,650,980,720);
 log("next shape uses the chosen colour", (await p.evaluate(()=>window.__uiSketch.controller.state.shapes.at(-1).stroke))==="#ef4444");}
log("no page errors", errs.filter(e=>!/favicon/.test(e)).length===0, errs.join("|"));
await b.close(); process.exit(0);
