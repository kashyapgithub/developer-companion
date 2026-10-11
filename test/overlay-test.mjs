import {launch} from "./ext-launch.mjs";
const wait=ms=>new Promise(r=>setTimeout(r,ms)); const out=[]; const t=(n,c,x="")=>out.push([c,n+(x?" — "+x:"")]);
const {browser,id}=await launch();
const page=await browser.newPage(); await page.setViewport({width:1000,height:700}); await page.goto("http://127.0.0.1:8777/page");
const ed=await browser.newPage(); const errs=[]; ed.on("pageerror",e=>errs.push(String(e)));
await ed.setViewport({width:1280,height:800}); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
// a solid red 300x200 rect at world (0,0)
await ed.evaluate(async()=>{const m=await import("./modules/shapes.js"); window.__uiSketch.controller.addShape(m.createShape("rect",{x:0,y:0,w:300,h:200,fill:"#ff0000",stroke:"#ff0000"}))});
await ed.click("#overlay-btn"); await wait(1500);
const label=await ed.$eval("#overlay-btn .lbl",e=>e.textContent); t("button shows on-state", label==="Overlay: on", label);
// capture the page via the extension and look at pixels
const shot=await ed.evaluate(()=>chrome.runtime.sendMessage({type:"CAPTURE_TAB",maxWidth:1000}));
const px=await ed.evaluate(async(u)=>{const i=new Image();i.src=u;await i.decode();const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const g=c.getContext("2d");g.drawImage(i,0,0);
  return {inside:[...g.getImageData(200,150,1,1).data], outside:[...g.getImageData(800,400,1,1).data]}},shot.dataUrl);
t("sketch tints the page where it sits (pinkish)", px.inside[0]>200 && px.inside[1]<200 && px.inside[2]<200, JSON.stringify(px.inside));
t("page elsewhere untouched (white)", px.outside.slice(0,3).every(v=>v>240), JSON.stringify(px.outside));
t("page still clickable through overlay", await page.evaluate(()=>{let n=0;document.querySelector("#save").addEventListener("click",()=>n++);document.querySelector("#save").click();return n===1}));
await ed.click("#overlay-btn"); await wait(800);
const shot2=await ed.evaluate(()=>chrome.runtime.sendMessage({type:"CAPTURE_TAB",maxWidth:1000}));
const px2=await ed.evaluate(async(u)=>{const i=new Image();i.src=u;await i.decode();const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const g=c.getContext("2d");g.drawImage(i,0,0);return [...g.getImageData(200,150,1,1).data]},shot2.dataUrl);
t("second click removes it", px2[1]>230, JSON.stringify(px2));
t("no editor errors", errs.length===0, errs.join("|"));
await browser.close(); for(const [c,n] of out) console.log((c?"PASS ":"FAIL ")+n); process.exit(0);
