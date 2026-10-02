import {createHash,randomUUID} from 'node:crypto';
import {destinationMatches,classifyControl,canNavigate,consequential} from './safety.mjs';
export async function probe(browser,monitor,egress,artifactDir){
 const start=Date.now(),options=monitor.options||{},timeout=options.timeoutMs||30000,maxClicks=options.maxClicks||8,maxDepth=options.maxDepth||2;
 const run={id:randomUUID(),monitor_id:monitor.id,configVersion:monitor.updated_at,started_at:start,finished_at:null,status:'passed',source:monitor.source,expected:monitor.expected,final_url:'',destinationMatched:false,elapsed_ms:0,metrics:{},egress,issues:[],steps:[],events:[],artifacts:[],redirects:[],coverage:{attempted:0,passed:0,failed:0,warnings:0,reviewed:0,skipped:0,discovered:0,truncated:false,maxClicks,maxDepth,depthReached:0,pagesVisited:0,stopReasons:[]},ruleVersion:4};
 const add=(type,message,extra={})=>{if(run.events.length<4000)run.events.push({at:Date.now()-start,type,message:String(message).slice(0,3000),...extra});else run.coverage.truncated=true;};
 const issue=(severity,code,message,url,step)=>{if(run.issues.length<200&&!run.issues.some(i=>i.code===code&&i.url===url&&i.message===message))run.issues.push({severity,code,message:String(message).slice(0,1500),url,step});};
 const context=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'America/New_York'});
 let activeStep='Destination',page,aborted=false;const deadline=setTimeout(()=>{aborted=true;void context.close();},180000);
 await context.addInitScript(({dangerous})=>{
  window.__journeyBlockedForms=[];
  const record=form=>window.__journeyBlockedForms.push({action:form.action||location.href,at:Date.now()});
  const infoNavigation=(form,button)=>{
   if(!button||button.form!==form)return false;
   const label=(button.getAttribute('aria-label')||button.innerText||button.value||'').trim();
   const method=(button.getAttribute('formmethod')||form.method||'get').toLowerCase();
   const action=button.getAttribute('formaction')||form.action||location.href;
   return method==='get'&&/^(view|show|read|open|see|explore)\b/i.test(label)&&!new RegExp(dangerous,'i').test(label+' '+action)&&/^https?:/i.test(new URL(action,location.href).href)&&![...form.elements].some(e=>!e.disabled&&!['hidden','submit','button'].includes(e.type));
  };
  document.addEventListener('submit',event=>{if(infoNavigation(event.target,event.submitter))return;event.preventDefault();record(event.target);},true);
  const nativeSubmit=HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit=function(){if(infoNavigation(this,document.activeElement))return nativeSubmit.call(this);record(this);};
  // requestSubmit still dispatches validation and submit handlers; the capture guard cancels navigation.
  window.__journeyVitals={lcp:null,cls:0};try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__journeyVitals.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__journeyVitals.cls+=e.value;}).observe({type:'layout-shift',buffered:true});}catch{}
 },{dangerous:consequential.source});
 await context.route('**/*',async route=>{const r=route.request();if(!['GET','HEAD','OPTIONS'].includes(r.method())){add('skipped',`${r.method()} request blocked`,{url:r.url(),step:activeStep});issue('review','blocked_submission','A form or state-changing request needs manual review',r.url(),activeStep);return route.abort('blockedbyclient');}return route.continue();});
 await context.routeWebSocket('**/*',ws=>{add('skipped','WebSocket connection not exercised',{url:ws.url(),step:activeStep});issue('review','websocket','Real-time WebSocket behavior needs manual review',ws.url(),activeStep);ws.close();});
 const requestStarts=new WeakMap(),requestSteps=new WeakMap(),requestFroms=new WeakMap(),navigationStarted=new Set();
 const topNavigation=r=>{try{return r.isNavigationRequest()&&!r.frame().parentFrame();}catch{return r.isNavigationRequest();}};
  context.on('requestfailed',r=>{const msg=r.failure()?.errorText||'Network request failed';add('network_error',msg,{url:r.url(),resource:r.resourceType(),step:activeStep});if(!/ERR_ABORTED|BLOCKED_BY_CLIENT/.test(msg))issue(topNavigation(r)?'error':'warning','network_error',msg,r.url(),activeStep);});
  context.on('request',r=>{requestStarts.set(r,Date.now());requestSteps.set(r,activeStep);if(topNavigation(r))navigationStarted.add(activeStep);if(r.isNavigationRequest()&&!r.redirectedFrom()){try{requestFroms.set(r,r.frame().page().url());}catch{}}add('request',r.method()+' '+r.url(),{url:r.url(),resource:r.resourceType(),step:activeStep});});
  context.on('response',r=>{const req=r.request();let mainNavigation=false;try{mainNavigation=req.isNavigationRequest()&&!req.frame().parentFrame();}catch{mainNavigation=req.isNavigationRequest();}
   const from=requestFroms.get(req);
   if(mainNavigation&&requestSteps.get(req)==='Destination'&&from&&from!=='about:blank'&&from!==r.url()&&run.redirects.length<100)run.redirects.push({kind:'page_navigation',from,to:r.url(),status:r.status(),duration_ms:Math.max(0,Date.now()-(requestStarts.get(req)||Date.now())),at:Date.now()-start,step:'Destination'});
   if(mainNavigation&&r.status()>=300&&r.status()<400){
    const location=r.headers()['location'];if(location&&run.redirects.length<100)try{run.redirects.push({from:r.url(),to:new URL(location,r.url()).href,status:r.status(),duration_ms:Math.max(0,Date.now()-(requestStarts.get(req)||Date.now())),at:Date.now()-start,step:requestSteps.get(req)||activeStep});}catch{}
   }
   add('response',String(r.status()),{url:r.url(),status:r.status(),resource:req.resourceType(),step:activeStep});if(r.status()>=400)issue(mainNavigation?'error':'warning','http_'+r.status(),'HTTP '+r.status(),r.url(),activeStep);});
 const attach=p=>{
  p.on('console',m=>{if(['error','warning'].includes(m.type())){add('console',m.text(),{level:m.type(),url:p.url(),step:activeStep});issue('warning','console_'+m.type(),m.text(),p.url(),activeStep);}});
  p.on('pageerror',e=>{add('javascript',e.message,{url:p.url(),step:activeStep});issue('warning','javascript_error',e.message,p.url(),activeStep);});
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
 // Explicit click semantics plus pointer-styled custom controls. Never fill inputs.
 const selector='a,button,[role="button"],[role="link"],input[type="submit"],input[type="button"],[onclick],[ng-click],[data-ng-click],[tabindex="0"],div,span';
 const controls=async p=>p.locator(selector).evaluateAll(els=>{
  const candidates=els.map((e,index)=>{
   const explicit=e.matches('a,button,[role="button"],[role="link"],input[type="submit"],input[type="button"],[onclick],[ng-click],[data-ng-click]');
   const style=getComputedStyle(e),rect=e.getBoundingClientRect(),label=(e.getAttribute('aria-label')||e.innerText||e.getAttribute('value')||e.getAttribute('title')||'Unlabelled control').trim().slice(0,140);
   let container=e.parentElement,contextLabel='';for(let depth=0;container&&depth<4;depth++,container=container.parentElement){const text=(container.innerText||'').trim().replace(/\s+/g,' ');if(text&&text!==label&&text.length<=1000){contextLabel=text.slice(0,400);break;}}
   const identity=e.id||e.getAttribute('data-offer-id')||e.getAttribute('data-study-id')||e.getAttribute('data-id')||e.getAttribute('onclick')||'';
   const semantic=e.matches('a,button,input,[role=button],[role=link]');
   const eligible=explicit||style.cursor==='pointer'&&(!e.parentElement||getComputedStyle(e.parentElement).cursor!=='pointer'||e.getAttribute('tabindex')==='0')&&label!=='Unlabelled control'&&(e.innerText||'').length<=140;
   return {element:e,index,label,identity,contextLabel,semantic,href:e.href||'',tag:e.tagName,type:e.type||'',form:!!(e.form||e.closest('form')),submits:!!e.form&&['submit','image'].includes(e.type),download:e.hasAttribute('download'),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',visible:!!(rect.width&&rect.height)&&style.visibility!=='hidden'&&style.display!=='none',eligible,explicit};
  }).filter(c=>c.visible&&c.eligible&&!c.element.matches('select,textarea,input:not([type="button"]):not([type="submit"])'));
  // Ignore decorative descendants of semantic controls, and pointer-style wrappers.
  const found=candidates.filter(c=>!candidates.some(other=>other!==c&&((other.semantic&&other.element.contains(c.element))||(!c.semantic&&c.element.contains(other.element))))).map(({element,visible,eligible,explicit,semantic,...c})=>c);
  return found.map(c=>{const peers=found.filter(x=>x.label===c.label&&x.href===c.href&&x.tag===c.tag&&x.type===c.type&&x.identity===c.identity&&x.contextLabel===c.contextLabel);return {...c,occurrence:peers.indexOf(c),duplicates:peers.length};});
 });
 const resolve=async(p,c)=>{
  let matches=(await controls(p)).filter(x=>x.label===c.label&&x.href===c.href&&x.tag===c.tag&&x.type===c.type&&x.identity===c.identity&&x.contextLabel===c.contextLabel);
  if(matches.length>1&&matches.length===c.duplicates)matches=[matches[c.occurrence]];
  if(matches.length!==1)throw new Error(matches.length?'Control is ambiguous after the page changed':'Control is no longer available');
  if(!canNavigate(matches[0]))throw new Error('Control is no longer eligible for navigation');
  return p.locator(selector).nth(matches[0].index);
 };
 const state=async p=>({url:p.url(),text:await p.locator('body').innerText(),scroll:await p.evaluate(()=>scrollY),timeOrigin:await p.evaluate(()=>performance.timeOrigin)});
 const key=d=>createHash('sha256').update(d.url+'|'+d.text).digest('hex');
 const stop=(reason,p,depth,step,message)=>{if(run.coverage.stopReasons.length<50)run.coverage.stopReasons.push({reason,url:p.url(),depth,step,message});add('journey_stop',message,{reason,url:p.url(),depth,step});};
 const click=async(p,c)=>{
  const target=await resolve(p,c),oldPages=new Set(context.pages());
  await target.click({timeout:Math.min(timeout,8000)});
  await new Promise(r=>setTimeout(r,700));
  const next=context.pages().find(x=>!oldPages.has(x)&&!x.isClosed())||p;
  await settle(next);return next;
 };
 const screenshot=async(p,name)=>{try{const filename=run.id+'-'+run.artifacts.length+'.png';await p.screenshot({path:artifactDir+'/'+filename,fullPage:false,timeout:5000});run.artifacts.push({filename,label:name,url:p.url(),step:activeStep});}catch(e){add('artifact_error',e.message);}};
 try{
  page=await context.newPage();add('start','Loading source URL',{url:monitor.source});
  await page.goto(monitor.source,{waitUntil:'domcontentloaded',timeout});await settle(page);
  run.final_url=page.url();run.elapsed_ms=Date.now()-start;run.destinationMatched=destinationMatches(run.final_url,monitor.expected);run.metrics=await inspect(page);
  if(!run.destinationMatched)issue('error','destination_mismatch','Final URL does not contain the expected text: '+monitor.expected,run.final_url,activeStep);
  add('destination',run.destinationMatched?'Destination matched':'Destination mismatch',{url:run.final_url,elapsed_ms:run.elapsed_ms});await screenshot(page,'Destination');
  if(run.destinationMatched){
   const root=run.final_url,visited=new Set();
   const replay=async path=>{
    activeStep='Returning to branch';
    for(const other of context.pages())if(other!==page)await other.close().catch(()=>{});
    if(page.isClosed())page=await context.newPage();
    await page.goto(root,{waitUntil:'domcontentloaded',timeout});await settle(page);
    for(const prior of path)page=await click(page,prior);
   };
   const walk=async(path,parentStep=0)=>{
    const depth=path.length,current=await state(page),signature=key(current);
    if(visited.has(signature)){stop('already_visited',page,depth,parentStep,'This page state was already checked; repeated paths were not explored again.');return;}
    visited.add(signature);run.coverage.pagesVisited++;run.coverage.depthReached=Math.max(run.coverage.depthReached,depth);
    const found=await controls(page);run.coverage.discovered+=found.length;
    const eligible=[];
    for(const c of found){
     const classification=classifyControl(c);
     if(canNavigate(c)){eligible.push(c);continue;}
     run.coverage.skipped++;add('skipped',c.label,{reason:classification,control:{tag:c.tag,type:c.type,insideForm:c.form,submits:c.submits},url:page.url(),step:parentStep});
     issue('review',classification==='disabled'?'disabled_control':'manual_step',c.label+' requires manual review ('+classification+')',page.url(),activeStep);
    }
    if(!eligible.length){
     const reason=found.length?'manual_review':'no_controls';
     stop(reason,page,depth,parentStep,found.length?'All visible controls need manual review; no eligible navigation remains.':'No visible navigation controls were found. This may be an endpoint or a blocked journey.');
     issue(found.length?'review':'warning',found.length?'manual_endpoint':'possible_dead_end',found.length?'Journey stopped at controls requiring manual review':'No further visible navigation was found',page.url(),activeStep);return;
    }
    if(depth>=maxDepth){run.coverage.truncated=true;stop('depth_limit',page,depth,parentStep,'Configured depth reached; further controls remain unchecked.');return;}
    // Follow likely forward navigation first, then explore sibling branches.
    const priority=c=>/^(next|continue|start|get started|learn more|view|explore)\b/i.test(c.label)?0:/privacy|terms|cookie|contact|back|home/i.test(c.label+' '+c.href)?2:1;
    eligible.sort((a,b)=>priority(a)-priority(b));
    for(let i=0;i<eligible.length;i++){
     if(run.coverage.attempted>=maxClicks){run.coverage.truncated=true;stop('click_limit',page,depth,parentStep,'Configured click budget reached; further controls remain unchecked.');return;}
     if(i>0){try{await replay(path);}catch(e){stop('replay_failed',page,depth,parentStep,'Could not return to this branch: '+e.message);issue('review','replay_failed','Branch could not be restored: '+e.message,page.url(),'Returning to branch');return;}}
     const c=eligible[i],step={index:run.steps.length+1,parentStep,path:[...path.map(c=>c.label),c.label],label:c.label,from:page.url(),to:'',status:'passed',duration_ms:0,depth:depth+1};
     activeStep='Click '+step.index+': '+c.label;const began=Date.now(),before=await state(page),priorIssues=run.issues.length;let changed=false;
     step.expectedNavigation=!!c.href&&/^https?:/i.test(c.href)&&c.href.split('#')[0]!==before.url.split('#')[0]||/^(next|continue|start|get started|learn more|view|show|read|open|see|explore)\b/i.test(c.label);
     run.coverage.attempted++;run.steps.push(step);
     try{
      page=await click(page,c);step.to=page.url();step.metrics=await inspect(page);
      const blockedForms=await page.evaluate(()=>window.__journeyBlockedForms?.splice(0)||[]);
      if(blockedForms.length){step.status='review';issue('review','form_submission_blocked','This control attempted to submit a form. Its click handler was exercised, but submission was stopped.',step.to,activeStep);add('skipped','Form submission prevented',{reason:'form_submission',step:activeStep});}

      const after=await state(page);step.newDocument=before.timeOrigin!==after.timeOrigin;changed=before.url!==after.url||before.text!==after.text;
      step.navigationAttempted=navigationStarted.has(activeStep);
      if(!changed&&Math.abs(after.scroll-before.scroll)<20){
       if(blockedForms.length||step.expectedNavigation){step.status=blockedForms.length?'review':'warning';issue(blockedForms.length?'review':'warning',blockedForms.length?'submission_required':'no_visible_effect','No navigation was observed after '+c.label,step.from,activeStep);}
       else add('in_page','No redirect expected or observed: '+c.label,{step:activeStep,url:step.to});
       stop(blockedForms.length?'submission_required':step.expectedNavigation?'no_visible_effect':'in_page_only',page,depth+1,step.index,blockedForms.length?'Continuing requires a form submission, which was prevented.':step.expectedNavigation?'No navigation was observed; review this control.':'In-page interaction; no redirect was expected or observed.');
      }else if(!changed)stop('scroll_only',page,depth+1,step.index,'Click scrolled the page without opening a new page state.');
      const findings=run.issues.slice(priorIssues);
      const navigationError=findings.some(i=>i.severity==='error'&&(/^(http_|network_error)/.test(i.code)));
      const timedOut=findings.some(i=>i.code==='load_timeout');
      const noDestination=!/^https?:/i.test(step.to)||!after.text.trim()||(step.to===step.from&&!step.newDocument);
      if(step.navigationAttempted&&(navigationError||timedOut||noDestination)){
       step.status='failed';step.failureKind='redirect';
       issue('error','redirect_failed',timedOut?'Redirect destination timed out':noDestination?'Redirect did not reach a usable destination page':'Redirect destination returned an HTTP or network error',step.to,activeStep);
      }else if(findings.some(i=>i.severity==='warning')&&step.status==='passed')step.status='warning';
     }catch(e){
      step.navigationAttempted=navigationStarted.has(activeStep);step.status=step.navigationAttempted?'failed':'review';step.failureKind=step.navigationAttempted?'redirect':undefined;step.to=page.url();
      issue(step.navigationAttempted?'error':'review',step.navigationAttempted?'redirect_failed':'control_not_tested',c.label+': '+e.message,step.from,activeStep);
      stop(step.navigationAttempted?'redirect_failed':'control_not_tested',page,depth+1,step.index,step.navigationAttempted?'Redirect did not complete: '+e.message:'Control could not be tested reliably; no redirect failure was observed.');
     }
     step.duration_ms=Date.now()-began;add('click',c.label,step);
     if(step.status==='passed')run.coverage.passed++;else if(step.status==='failed')run.coverage.failed++;else if(step.status==='warning')run.coverage.warnings++;else run.coverage.reviewed++;
     run.coverage.depthReached=Math.max(run.coverage.depthReached,step.depth);
     if(step.navigationAttempted||step.newDocument||step.from.split('#')[0]!==step.to.split('#')[0])await screenshot(page,(step.failureKind==='redirect'?'Failed redirect':'Lander')+' after step '+step.index+' · '+c.label);
     if(changed&&step.status!=='failed')await walk([...path,c],step.index);
    }
   };
   await walk([]);
  }else {add('skipped','Click-through skipped because destination did not match');stop('destination_mismatch',page,0,0,'Click-through was skipped because the destination did not match.');}
 }catch(e){if(aborted){run.coverage.truncated=true;if(page)stop('time_limit',page,run.coverage.depthReached,run.steps.length,'Journey exceeded its 180-second time budget.');}issue('error',aborted?'journey_timeout':/Timeout/.test(e.name)?'navigation_timeout':'navigation_error',aborted?'Journey exceeded the 180-second total budget':e.message,page?.url()||monitor.source,activeStep);if(page)await screenshot(page,'Failure');}
 finally{clearTimeout(deadline);await context.close().catch(()=>{});}
 if(run.coverage.truncated)issue('review','coverage_limit','Check reached a click, depth, time, or log limit; unvisited paths remain',run.final_url,activeStep);
 if(!run.elapsed_ms)run.elapsed_ms=Date.now()-start;
 run.status=run.issues.some(i=>i.severity==='error')?'failed':run.issues.some(i=>i.severity==='warning')?'warning':run.issues.some(i=>i.severity==='review')?'review':'passed';run.finished_at=Date.now();run.duration_ms=run.finished_at-start;
 return run;
}
