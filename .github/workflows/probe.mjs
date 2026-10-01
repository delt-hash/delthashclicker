import {randomUUID} from 'node:crypto';
import {destinationMatches,classifyControl} from './safety.mjs';
export async function probe(browser,monitor,egress,artifactDir){
 const start=Date.now(),options=monitor.options||{},timeout=options.timeoutMs||30000,maxClicks=options.maxClicks||8,maxDepth=options.maxDepth||2;
 const run={id:randomUUID(),monitor_id:monitor.id,configVersion:monitor.updated_at,started_at:start,finished_at:null,status:'passed',source:monitor.source,expected:monitor.expected,final_url:'',destinationMatched:false,elapsed_ms:0,metrics:{},egress,issues:[],steps:[],events:[],artifacts:[],coverage:{attempted:0,passed:0,failed:0,skipped:0,discovered:0,truncated:false,maxClicks,maxDepth},ruleVersion:1};
 const add=(type,message,extra={})=>{if(run.events.length<4000)run.events.push({at:Date.now()-start,type,message:String(message).slice(0,3000),...extra});else run.coverage.truncated=true;};
 const issue=(severity,code,message,url,step)=>{if(run.issues.length<200&&!run.issues.some(i=>i.code===code&&i.url===url&&i.message===message))run.issues.push({severity,code,message:String(message).slice(0,1500),url,step});};
 const context=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'America/New_York'});
 let activeStep='Destination',page,aborted=false;const deadline=setTimeout(()=>{aborted=true;void context.close();},180000);
 await context.addInitScript(()=>{
  window.__journeyVitals={lcp:null,cls:0};try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__journeyVitals.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__journeyVitals.cls+=e.value;}).observe({type:'layout-shift',buffered:true});}catch{}
 });
 await context.route('**/*',async route=>{const r=route.request();if(!['GET','HEAD','OPTIONS'].includes(r.method())){add('skipped',`${r.method()} request blocked`,{url:r.url(),step:activeStep});issue('review','blocked_submission','A form or state-changing request needs manual review',r.url(),activeStep);return route.abort('blockedbyclient');}return route.continue();});
 await context.routeWebSocket('**/*',ws=>{add('skipped','WebSocket connection not exercised',{url:ws.url(),step:activeStep});issue('review','websocket','Real-time WebSocket behavior needs manual review',ws.url(),activeStep);ws.close();});
 const attach=p=>{
  p.on('console',m=>{if(['error','warning'].includes(m.type())){add('console',m.text(),{level:m.type(),url:p.url(),step:activeStep});issue('warning','console_'+m.type(),m.text(),p.url(),activeStep);}});
  p.on('pageerror',e=>{add('javascript',e.message,{url:p.url(),step:activeStep});issue('warning','javascript_error',e.message,p.url(),activeStep);});
  p.on('requestfailed',r=>{const msg=r.failure()?.errorText||'Network request failed';add('network_error',msg,{url:r.url(),resource:r.resourceType(),step:activeStep});if(!/ERR_ABORTED|BLOCKED_BY_CLIENT/.test(msg))issue(r.isNavigationRequest()?'error':'warning','network_error',msg,r.url(),activeStep);});
  p.on('request',r=>{add('request',r.method()+' '+r.url(),{url:r.url(),resource:r.resourceType(),step:activeStep});});
  p.on('response',r=>{const req=r.request();add('response',String(r.status()),{url:r.url(),status:r.status(),resource:req.resourceType(),step:activeStep});if(r.status()>=400)issue(req.isNavigationRequest()?'error':'warning','http_'+r.status(),'HTTP '+r.status(),r.url(),activeStep);});
  p.on('framenavigated',f=>{if(f===p.mainFrame())add('navigation',f.url(),{url:f.url(),step:activeStep});});
  p.on('dialog',d=>{issue('review','dialog','Page opened a '+d.type()+' dialog: '+d.message(),p.url(),activeStep);void d.dismiss();});
  p.on('download',d=>{issue('review','download','Download requires manual review: '+d.suggestedFilename(),p.url(),activeStep);void d.cancel();});
  p.on('crash',()=>issue('error','browser_crash','Page crashed',p.url(),activeStep));
 };
 context.on('page',attach);
 const settle=async p=>{
  const end=Date.now()+timeout;let last='',stable=Date.now();while(Date.now()<end){const u=p.url();if(u!==last){last=u;stable=Date.now();}if(Date.now()-stable>=1500)break;await p.waitForTimeout(200);}
  try{await p.waitForLoadState('load',{timeout:Math.max(500,end-Date.now())});}catch{issue('warning','load_timeout','Page did not finish loading within the configured timeout',p.url(),activeStep);}
 };
 const inspect=async p=>{
  const d=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],text=document.body?.innerText||'';return {metrics:n?{ttfb:Math.round(n.responseStart-n.requestStart),domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),fcp:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime||0),lcp:Math.round(window.__journeyVitals?.lcp||0),cls:window.__journeyVitals?.cls||0}:null,text:text.slice(0,30000),images:[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&i.currentSrc).map(i=>i.currentSrc).slice(0,25),iframes:document.querySelectorAll('iframe').length};});
  if(/verify (you are|you're) human|captcha|access denied|unusual traffic|checking your browser|security check/i.test(d.text))issue('warning','challenge','Possible CAPTCHA, access block, or bot challenge',p.url(),activeStep);
  if(/deceptive site|dangerous site|malware detected|phishing|security warning/i.test(d.text))issue('warning','security_warning','Page contains a possible security warning; review evidence',p.url(),activeStep);
  if(!d.text.trim())issue('warning','blank_page','No readable content was found',p.url(),activeStep);
  if(d.iframes)issue('review','iframe_coverage',`${d.iframes} embedded frame(s) loaded; controls inside frames are not clicked`,p.url(),activeStep);
  for(const url of d.images)issue('warning','broken_image','Image failed to render',url,activeStep);
  if(d.metrics?.load>(options.slowMs||5000)||d.metrics?.lcp>(options.slowMs||5000))issue('warning','slow_load','Page loading exceeded the configured threshold',p.url(),activeStep);
  if(p.url().startsWith('http:'))issue('warning','insecure_http','Destination uses unencrypted HTTP',p.url(),activeStep);
  return d.metrics;
 };
 const controls=async p=>p.locator('a,button,[role="button"],input[type="submit"],input[type="button"]').evaluateAll(els=>els.map((e,index)=>({index,label:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('value')||e.getAttribute('title')||'Unlabelled control').trim().slice(0,140),href:e.href||'',type:e.type||'',form:!!e.closest('form'),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',visible:!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=='hidden'})).filter(c=>c.visible));
 const screenshot=async(p,name)=>{try{const filename=run.id+'-'+run.artifacts.length+'.png';await p.screenshot({path:artifactDir+'/'+filename,fullPage:false,timeout:5000});run.artifacts.push({filename,label:name});}catch(e){add('artifact_error',e.message);}};
 try{
  page=await context.newPage();add('start','Loading source URL',{url:monitor.source});
  await page.goto(monitor.source,{waitUntil:'domcontentloaded',timeout});await settle(page);
  run.final_url=page.url();run.elapsed_ms=Date.now()-start;run.destinationMatched=destinationMatches(run.final_url,monitor.expected);run.metrics=await inspect(page);
  if(!run.destinationMatched)issue('error','destination_mismatch','Final URL does not contain the expected text: '+monitor.expected,run.final_url,activeStep);
  add('destination',run.destinationMatched?'Destination matched':'Destination mismatch',{url:run.final_url,elapsed_ms:run.elapsed_ms});await screenshot(page,'Destination');
  if(run.destinationMatched){
   const root=run.final_url,queue=[{path:[],depth:0,url:root}],visited=new Set();
   while(queue.length&&run.coverage.attempted<maxClicks){
    const node=queue.shift();if(visited.has(node.url+'|'+node.path.map(p=>p.label).join('>')))continue;visited.add(node.url+'|'+node.path.map(p=>p.label).join('>'));
    if(node.path.length){await page.goto(root,{waitUntil:'domcontentloaded',timeout});await settle(page);for(const prior of node.path){const c=page.locator('a,button,[role="button"],input[type="submit"],input[type="button"]').nth(prior.index);const current=(await c.innerText().catch(()=>''))||await c.getAttribute('aria-label')||await c.getAttribute('value')||'Unlabelled control';if(current.trim().slice(0,140)!==prior.label)throw new Error('Page controls changed during journey replay');const oldPages=new Set(context.pages());await c.click({timeout:7000});await page.waitForTimeout(400);page=context.pages().find(p=>!oldPages.has(p))||page;await settle(page);}}
    const found=await controls(page);run.coverage.discovered+=found.length;
    if(!found.length)issue('warning','dead_end','No visible buttons or links were found at this step',page.url(),activeStep);
    for(const c of found){
     if(run.coverage.attempted>=maxClicks){run.coverage.truncated=true;break;}
     const classification=classifyControl(c);if(classification!=='navigation'){run.coverage.skipped++;add('skipped',c.label,{reason:classification,url:page.url(),step:activeStep});if(classification==='disabled')issue('review','disabled_control','Disabled control: '+c.label,page.url(),activeStep);else issue('review','manual_step',c.label+' requires manual review ('+classification+')',page.url(),activeStep);continue;}
     // Return to the same parent for every branch, then revalidate the control identity.
     if(run.coverage.attempted>0){await page.goto(root,{waitUntil:'domcontentloaded',timeout});await settle(page);for(const prior of node.path){const oldPages=new Set(context.pages());const replay=page.locator('a,button,[role="button"],input[type="submit"],input[type="button"]').nth(prior.index);const attrs=await replay.evaluate(e=>({label:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('value')||e.getAttribute('title')||'Unlabelled control').trim().slice(0,140),href:e.href||''}));if(attrs.label!==prior.label||attrs.href!==prior.href)throw new Error('Page controls changed during replay');await replay.click({timeout:7000});await page.waitForTimeout(400);page=context.pages().find(p=>!oldPages.has(p))||page;await settle(page);}}
     const step={index:run.steps.length+1,label:c.label,from:page.url(),to:'',status:'passed',duration_ms:0,depth:node.depth+1};activeStep='Click '+step.index+': '+c.label;const began=Date.now(),beforeUrl=page.url(),beforeText=await page.locator('body').innerText(),beforeScroll=await page.evaluate(()=>scrollY),priorIssues=run.issues.length;
     run.coverage.attempted++;try{
      const target=page.locator('a,button,[role="button"],input[type="submit"],input[type="button"]').nth(c.index);const attrs=await target.evaluate(e=>({label:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('value')||e.getAttribute('title')||'Unlabelled control').trim().slice(0,140),href:e.href||''}));if(attrs.label!==c.label||attrs.href!==c.href)throw new Error('Control changed before clicking');
      const oldPages=new Set(context.pages());await target.click({timeout:Math.min(timeout,8000)});await page.waitForTimeout(700);page=context.pages().find(p=>!oldPages.has(p))||page;await settle(page);step.to=page.url();step.metrics=await inspect(page);
      const afterText=await page.locator('body').innerText(),afterScroll=await page.evaluate(()=>scrollY);if(beforeUrl===step.to&&beforeText===afterText&&Math.abs(afterScroll-beforeScroll)<20){step.status='warning';issue('warning','no_visible_effect','Click produced no observable navigation, content, or scroll change: '+c.label,step.from,activeStep);}
      const next=await controls(page);if(!next.length){step.status='warning';issue('warning','possible_dead_end','No further visible navigation after '+c.label,step.to,activeStep);}
      if(node.depth+1<maxDepth&&next.some(x=>classifyControl(x)==='navigation'))queue.push({path:[...node.path,c],url:step.to,depth:node.depth+1});else if(node.depth+1>=maxDepth&&next.length)run.coverage.truncated=true;
      if(run.issues.slice(priorIssues).some(i=>i.severity==='error'))step.status='failed';
     }catch(e){step.status='failed';step.to=page.url();issue('error','click_failed',c.label+': '+e.message,step.from,activeStep);}
     step.duration_ms=Date.now()-began;run.steps.push(step);add('click',c.label,step);if(step.status==='passed')run.coverage.passed++;else{run.coverage.failed++;await screenshot(page,'Problem: '+c.label);}
     for(const other of context.pages())if(other!==page)await other.close().catch(()=>{});
    }
   }
   if(queue.length)run.coverage.truncated=true;
  }else add('skipped','Click-through skipped because destination did not match');
 }catch(e){issue('error',aborted?'journey_timeout':/Timeout/.test(e.name)?'navigation_timeout':'navigation_error',aborted?'Journey exceeded the 180-second total budget':e.message,page?.url()||monitor.source,activeStep);if(page)await screenshot(page,'Failure');}
 finally{clearTimeout(deadline);await context.close().catch(()=>{});}
 if(run.coverage.truncated)issue('review','coverage_limit','Check reached a click, depth, time, or log limit; unvisited paths remain',run.final_url,activeStep);
 if(!run.elapsed_ms)run.elapsed_ms=Date.now()-start;
 run.status=run.issues.some(i=>i.severity==='error')?'failed':run.issues.some(i=>i.severity==='warning')?'warning':run.issues.some(i=>i.severity==='review')?'review':'passed';run.finished_at=Date.now();run.duration_ms=run.finished_at-start;
 return run;
}
