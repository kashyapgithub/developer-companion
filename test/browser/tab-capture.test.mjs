import {launch} from "../helpers/launch.mjs";
const {browser,id}=await launch(); const R=[]; const t=(n,c,x="")=>R.push([c,n+(x?" — "+x:"")]);
const page=await browser.newPage(); await page.setViewport({width:1000,height:700}); await page.goto("http://127.0.0.1:8777/page"); 
const ed=await browser.newPage(); await ed.setViewport({width:1280,height:800}); const errs=[]; ed.on("pageerror",e=>errs.push(String(e)));
await ed.goto(`chrome-extension://${id}/editor/editor.html`); await new Promise(r=>setTimeout(r,800));
await page.bringToFront(); await new Promise(r=>setTimeout(r,300)); await ed.bringToFront(); await new Promise(r=>setTimeout(r,300));
const res=await ed.evaluate(()=>chrome.runtime.sendMessage({type:"CAPTURE_TAB"}));
t("background replies ok", res?.ok===true, res?.error||"");
if(res?.ok){ t("is a PNG data URL", res.dataUrl.startsWith("data:image/png;base64,")); t("reports page url", res.url.includes("127.0.0.1:8777/page"), res.url);
 const dims=await ed.evaluate(async(u)=>{const i=new Image();i.src=u;await i.decode();return [i.width,i.height]},res.dataUrl); t("image has real size", dims[0]>=900 && dims[1]>=600, dims.join("x")); }
const active=await browser.pages(); 
// UI route
await ed.bringToFront();
await ed.click("#screenshot-btn"); await ed.click('[data-shot="tab"]'); await new Promise(r=>setTimeout(r,2500));
const shapes=await ed.evaluate(()=>window.__uiSketch.controller.state.shapes.filter(s=>s.type==="image").map(s=>({name:s.name,meta:s.meta,w:s.w})));
t("capture-this-tab menu adds an image shape", shapes.length===1, JSON.stringify(shapes[0]||{}).slice(0,160));
t("shape carries url meta", shapes[0]?.meta?.kind==="tab-capture" && /8777\/page/.test(shapes[0].meta.url));
t("editor is back in front after capture", await ed.evaluate(()=>document.visibilityState)==="visible");
t("no editor page errors", errs.length===0, errs.join("|"));
await browser.close(); for(const [c,n] of R) console.log((c?"PASS ":"FAIL ")+n);
