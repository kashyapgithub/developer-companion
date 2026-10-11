import {launch} from "../helpers/launch.mjs";
const {browser,id}=await launch(); const R=[]; const t=(n,c,x="")=>R.push([c,n+(x?" — "+x:"")]);
const ed=await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await new Promise(r=>setTimeout(r,800));
const on=await ed.evaluate(()=>chrome.runtime.sendMessage({type:"HOVER_SET",enabled:true})); t("hover mode on", on?.ok===true, JSON.stringify(on));
const page=await browser.newPage(); await page.setViewport({width:1200,height:800}); await page.goto("http://127.0.0.1:8777/page"); await new Promise(r=>setTimeout(r,1500));
// open the floating window by clicking the bubble (bottom-right)
await page.mouse.click(1200-52-24+26, 800-52-24+26); await new Promise(r=>setTimeout(r,2500));
const frame=page.frames().find(f=>f.url().includes("editor.html?embedded=1")); t("floating editor frame present", !!frame);
const res=await frame.evaluate(()=>chrome.runtime.sendMessage({type:"CAPTURE_TAB"})); t("capture ok from floating window", res?.ok===true, res?.error||"");
if(res?.ok){
  const px=await page.evaluate(async(u)=>{const i=new Image();i.src=u;await i.decode();const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const g=c.getContext("2d");g.drawImage(i,0,0);
    // header of the floating window was at top-right: x ~ 1200-960-24.., y ~ 24+18
    const d=g.getImageData(Math.round(i.width*0.7),42,1,1).data; return [d[0],d[1],d[2]];},res.dataUrl);
  t("floating window NOT in its own screenshot (pixel is page-white, not header #1f2430)", px[0]>200&&px[1]>200, px.join(","));
}
const shown=await page.evaluate(()=>document.querySelector("#dc-hover-host")?.style.display ?? "missing"); t("overlay shown again afterwards", shown==="", String(shown));
await browser.close(); for(const [c,n] of R) console.log((c?"PASS ":"FAIL ")+n);
