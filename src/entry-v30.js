import app from "./entry-v29.js";

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const BASELINES=Object.freeze({structure:"2.1.3",geometry:"2.2.1",visual:"2.3.3",motion:"2.4.1",spatial:"2.5.1",interaction:"2.6.2",accessibility:"2.7+2.9",responsive:"2.8",runtime:"2.9"});

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/api/health"&&request.method==="GET")return handleHealth(request,env,ctx);if(url.pathname==="/api/build-v2"&&request.method==="POST")return handleBuildV30(request,env,ctx);return app.fetch(request,env,ctx)}};

async function handleHealth(request,env,ctx){const base=await app.fetch(request,env,ctx);const payload=await base.json().catch(()=>({}));return json({...payload,buildWebMode:"v3.0-final-composite-baseline + v2.9-runtime-integrity + v2.8-responsive + v2.7-accessibility + six-locked-fidelity-baselines",finalCompositeBaseline:true,finalCompositeVersion:"3.0.0",baselineManifest:BASELINES,regressionAssertions:true,integrityStamp:true,failClosedOnRegression:false,targetJavaScriptCopied:false,targetLayoutCssCopied:false,targetFontFilesCopied:false,v29BaseEngine:"2.9.0",version:"3.0.0"},base.status)}

async function handleBuildV30(request,env,ctx){const started=Date.now();const baseResponse=await app.fetch(request,env,ctx);const contentType=baseResponse.headers.get("content-type")||"";if(!/application\/json/i.test(contentType))return baseResponse;const payload=await baseResponse.json().catch(()=>null);if(!payload||!baseResponse.ok||!payload.ok||!payload.html)return new Response(payload?JSON.stringify(payload):"{}",{status:baseResponse.status,headers:JSON_HEADERS});let html=String(payload.html||"");html=stampV30(html);html=injectManifest(html);html=html.replace(/Runtime Robustness \/ State Integrity Guard V2\.9/g,"Final Composite Baseline V3.0").replace(/Structure, geometry, visual, motion, spatial and interaction-locked reconstruction with responsive guards plus consolidated runtime state integrity\./g,"Final composite reconstruction with locked structure, geometry, visual, motion, spatial, interaction, accessibility, responsive and runtime integrity baselines.");const audit=assertComposite(html,payload);html=injectIntegrityStamp(html,audit);const finalReady=audit.regressions.length===0;return json({...payload,engine:"v3.0-final-composite-baseline",mode:"clean-reconstruction-v30",filename:String(payload.filename||"clean-v29.html").replace(/-clean-v29\.html$/i,"-clean-v30.html"),html,htmlBytes:byteLength(html),durationMs:Date.now()-started,stats:{...(payload.stats||{}),finalCompositeBaselineApplied:true,finalCompositeReady:finalReady,regressionAssertionCount:audit.assertions.length,regressionFailureCount:audit.regressions.length,regressions:audit.regressions,integrityStampApplied:html.includes("pfr-v30-integrity"),baselineManifestApplied:html.includes("pfr-v30-baseline-manifest"),targetScriptsCopied:0,targetLayoutCssCopied:0,targetFontFilesCopied:0},model:{...(payload.model||{}),finalComposite:{version:"3.0.0",base:"2.9.0",baselines:BASELINES,assertions:audit.assertions,regressions:audit.regressions,ready:finalReady}},safety:{...(payload.safety||{}),targetScriptsCopied:false,targetJavaScriptExecutedByBuild:false,targetCssUsedAsLayoutFoundation:false,targetCssCopied:false,targetFontFilesCopied:false,finalCompositeUsesGeneratedMetadataOnly:true,finalCompositeSubmitsTargetForms:false}},baseResponse.status)}

function stampV30(html){return String(html||"").replace(/<html\b([^>]*)>/i,(all,attrs)=>{let next=String(attrs||"").replace(/\sdata-composite-baseline=(['"])[^'"]*\1/i,"").replace(/\sdata-baseline-status=(['"])[^'"]*\1/i,"");return `<html${next} data-composite-baseline="v3.0" data-baseline-status="candidate">`})}

function injectManifest(html){const source=String(html||"");if(source.includes('id="pfr-v30-baseline-manifest"'))return source;const manifest=`<script id="pfr-v30-baseline-manifest" type="application/json">${JSON.stringify({version:"3.0.0",baselines:BASELINES,policy:"generated-code-only; target-js-disabled; target-layout-css-not-copied"})}</script>`;return /<\/head\s*>/i.test(source)?source.replace(/<\/head\s*>/i,`${manifest}</head>`):manifest+source}

function assertComposite(html,payload){const checks=[
 ["structure-stamp",/data-geometry-engine="v2\.2\.1"/.test(html)&&html.includes("pfr-v213-intro-css")],
 ["geometry-lock",html.includes("pfr-v22-geometry-css")&&/--geo-cols:12/.test(html)&&/--geo-wide:995px/.test(html)&&/--geo-encounter-h:602px/.test(html)],
 ["visual-lock",/data-visual-engine="v2\.3"/.test(html)&&html.includes("pfr-v23-visual-fidelity-css")],
 ["motion-lock",/data-motion-guard="v2\.4\.1"/.test(html)&&html.includes("pfr-v241-motion-guard-css")],
 ["spatial-lock",/data-spatial-guard="v2\.5\.1"/.test(html)&&/data-spatial-mode="(?:neutral|active)"/.test(html)],
 ["interaction-lock",/data-interaction-guard="v2\.6\.2"/.test(html)&&html.includes("pfr-v26-interaction-css")],
 ["accessibility-layer",/data-a11y-engine="v2\.7"/.test(html)&&html.includes("pfr-v27-a11y-css")&&html.includes('data-a11y-skip="v2.7"')],
 ["responsive-layer",/data-responsive-engine="v2\.8"/.test(html)&&html.includes("pfr-v28-viewport-css")&&html.includes("pfr-v28-viewport-js")],
 ["runtime-layer",/data-runtime-engine="v2\.9"/.test(html)&&html.includes("pfr-v29-runtime-integrity-js")&&!html.includes("pfr-v262-nested-escape-js")&&!html.includes("pfr-v27-a11y-js")],
 ["csp-safety",/connect-src 'none'/.test(html)&&/frame-src 'none'/.test(html)&&/form-action 'none'/.test(html)&&/object-src 'none'/.test(html)],
 ["build-chain",Boolean(payload.stats?.runtimeBaselineCandidateReady)]
 ];const assertions=checks.map(([name,pass])=>({name,pass:Boolean(pass)}));return{assertions,regressions:assertions.filter(x=>!x.pass).map(x=>x.name)}}

function injectIntegrityStamp(html,audit){const source=String(html||"");const ready=audit.regressions.length===0;const stamp=`<meta id="pfr-v30-integrity" name="pfr-final-composite" content="${ready?'ready':'regression'}; assertions=${audit.assertions.length}; failures=${audit.regressions.length}">`;let out=/<\/head\s*>/i.test(source)?source.replace(/<\/head\s*>/i,`${stamp}</head>`):stamp+source;out=out.replace(/data-baseline-status="candidate"/,`data-baseline-status="${ready?'locked-ready':'regression'}"`);return out}

function byteLength(value){return new TextEncoder().encode(String(value||"")).length}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:JSON_HEADERS})}
