import {chromium} from 'playwright';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startProxy} from './proxy.mjs';
import {probe} from './probe.mjs';

// Never print target URLs, page contents, credentials or raw exceptions to public job logs.
let cycle='',browser,proxy,dir;
let uploadFailures=0,regionFailures=0,jobFailed=false;
const site=new URL(process.env.MONITOR_SITE_URL||'https://invalid.invalid');
const token=process.env.MONITOR_JOB_TOKEN||'';
if(site.protocol!=='https:'||site.username||site.password||site.port||site.pathname!=='/'||site.search||site.hash||!site.hostname.endsWith('.chatgpt.site')||token.length<32){console.error('Set the MONITOR_SITE_URL and MONITOR_JOB_TOKEN repository secrets.');process.exit(1);}
async function api(path,body={},binary=false){
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(new URL('/api/jobs/'+path,site),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':binary?'image/png':'application/json',...(cycle?{'X-Journey-Cycle':cycle}:{})},body:binary?body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   if(response.ok)return await response.json();
   if(response.status<500||attempt===2)throw Object.assign(new Error('Dashboard request failed'),{status:response.status,final:true});
  }catch(e){if(e.final||attempt===2)throw e;}
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
}
async function verifyUS(){
 const context=await browser.newContext();
 try{const page=await context.newPage();await page.goto('https://www.cloudflare.com/cdn-cgi/trace',{timeout:15000,waitUntil:'domcontentloaded'});
  const fields=Object.fromEntries((await page.locator('body').innerText()).split('\n').filter(l=>l.includes('=')).map(l=>l.split('=')));
  if(fields.loc!=='US'||!fields.ip)throw new Error('US browser egress could not be verified');
  return {ip:fields.ip,country:'US',verified_at:Date.now(),source:'Cloudflare trace from the checking browser'};
 }finally{await context.close();}
}
function trimLog(run){
 let trimmed=false;
 while(Buffer.byteLength(JSON.stringify(run))>1700000&&run.events.length){run.events.pop();trimmed=true;}
 if(trimmed){run.coverage.truncated=true;run.issues.push({severity:'review',code:'storage_limit',message:'Event log exceeded the free storage limit; trailing events were omitted.',url:'',step:'Log storage'});if(run.status==='passed')run.status='review';}
 return run;
}
try{
 const start=await api('start');cycle=start.cycle;
 if(!Array.isArray(start.monitors)||start.monitors.length>3)throw new Error('Invalid configuration');
 if(start.monitors.length){
  dir=await mkdtemp(join(tmpdir(),'journey-'));proxy=await startProxy();
  browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:proxy.url},args:['--proxy-bypass-list=<-loopback>','--disable-quic']});
  for(const monitor of start.monitors){
   let egress;try{egress=await verifyUS();}catch{regionFailures++;continue;}
   try{
    const run=await probe(browser,monitor,egress,dir),files=[];
    // Retain destination and every attempted click, including successful pages.
    for(const artifact of run.artifacts.slice(0,22)){
     try{const bytes=await readFile(join(dir,artifact.filename));if(bytes.length<=500000)files.push({...artifact,bytes});else run.events.push({type:'artifact_omitted',message:artifact.label+' exceeded the 500 KB screenshot limit.'});}catch{run.events.push({type:'artifact_omitted',message:artifact.label+' could not be read.'});}
    }
    run.artifacts=files.map(({bytes,...artifact})=>artifact);trimLog(run);
    await api('result',run);
    for(const file of files)try{await api('artifact?name='+encodeURIComponent(file.filename),file.bytes,true);}catch{uploadFailures++;}
   }catch{uploadFailures++;}
  }
 }
 const error=regionFailures?'US egress could not be verified. Affected checks were skipped and were not marked passed.':uploadFailures?'Some check logs or screenshots could not be uploaded. Review the last observation time.':'';
 await api('finish',{error});if(error)jobFailed=true;
 console.log(error?'Check cycle needs attention. Open the private dashboard for status.':'Check cycle finished. Results are in the private dashboard.');
}catch(e){jobFailed=true;if(cycle)try{await api('finish',{error:'The browser job stopped before all results were uploaded. Review the workflow status and run it again.'});}catch{}
 console.error(e.status===409?'A check cycle is already active; this job did not start.':'The checker could not complete. Check repository secrets and the dashboard setup screen.');
}finally{await browser?.close().catch(()=>{});proxy?.server.close();if(dir)await rm(dir,{recursive:true,force:true});}
if(jobFailed)process.exitCode=1;
