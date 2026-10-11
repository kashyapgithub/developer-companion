import {launch} from "../helpers/launch.mjs"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const R="/home/claude/developer-companion";
const {Client}=await import(R+"/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const {StdioClientTransport}=await import(R+"/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const store=fs.mkdtempSync(path.join(os.tmpdir(),"dc-"));
const client=new Client({name:"t",version:"1"});
await client.connect(new StdioClientTransport({command:"node",args:[R+"/server/server.js"],env:{...process.env,PORT:"5982",STORE_DIR:store}}));
const out=[]; const t=(n,c,x="")=>out.push([c,n+(x?" — "+x:"")]);
const {browser,id}=await launch();
const page=await browser.newPage(); await page.setViewport({width:1000,height:700}); await page.goto("http://127.0.0.1:8777/page");
const ed=await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await new Promise(r=>setTimeout(r,800));
await ed.evaluate(()=>chrome.storage.local.set({serverUrl:"http://127.0.0.1:5982"}));
await ed.evaluate(()=>chrome.runtime.sendMessage({type:"REC_STATUS"})); // wake SW
await ed.bringToFront(); await new Promise(r=>setTimeout(r,500));
const call=(name,args={})=>client.callTool({name,arguments:args},undefined,{timeout:60000});
// status command
let r=await call("send_browser_command",{command:"status"}); t("send_browser_command status returns", !r.isError, r.content[0].text.slice(0,120));
// capture
r=await call("capture_tab",{url_contains:"8777"});
const img=r.content.find(c=>c.type==="image"); const txt=r.content.find(c=>c.type==="text");
t("capture_tab returns image", !!img && img.data.length>2000, r.isError?r.content[0].text:(txt?.text||"").slice(0,120));
t("text names the page url", /8777\/page/.test(txt?.text||""));
t("user's active tab unchanged (editor still visible)", await ed.evaluate(()=>document.visibilityState)==="visible");
// mismatch
r=await call("capture_tab",{url_contains:"no-such-site.example"});
t("no match -> clear error", r.isError===true || /no .*tab|not found|no matching/i.test(r.content[0].text), r.content[0].text.slice(0,140));
// no double execution: queue 2 commands, count
r=await call("send_browser_command",{command:"status"}); r=await call("send_browser_command",{command:"status"});
const sqlite=await import("node:sqlite"); const db=new sqlite.DatabaseSync(path.join(store,fs.readdirSync(store).find(f=>f.endsWith(".db"))));
const rows=db.prepare("select status,count(*) n from commands group by status").all();
t("all commands finished once", rows.every(x=>x.status==="done"||x.status==="failed"), JSON.stringify(rows));
t("no image data left in db", !db.prepare("select result from commands where command='capture_tab'").all().some(x=>(x.result||"").includes("base64")));
await browser.close(); await client.close();
for(const [c,n] of out) console.log((c?"PASS ":"FAIL ")+n); process.exit(0);
