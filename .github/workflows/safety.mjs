import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function isPublicIp(ip){
 if(isIP(ip)===6)return /^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:db8|0|10|20):/i.test(ip)&&!/^2002:/i.test(ip);
 if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function validateUrl(raw){const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||/^(localhost|.*\.(local|internal|localhost))$/i.test(u.hostname))throw new Error('Non-public or unsupported destination');return u;}
export async function publicAddress(host){const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>!isPublicIp(a.address)))throw new Error('Private or reserved network blocked');return addresses.find(a=>a.family===4)||addresses[0];}
export const destinationMatches=(actual,expected)=>typeof expected==='string'&&expected.length>0&&actual.includes(expected);
export const consequential=/\b(buy|purchase|pay|order|subscribe|unsubscribe|send|submit|sign[ -]?up|register|log[ -]?(in|out)|sign[ -]?(in|out)|delete|remove|confirm|book|reserve|donate|download|accept all|consent|opt[ -]?in)\b/i;
export function classifyControl(c){
 if(c.disabled)return 'disabled';
 if(consequential.test(c.label+' '+(c.href||'')))return 'consequential';
 if(c.href&&!/^https?:|^#|^javascript:/i.test(c.href))return 'unsupported';
 if(c.download)return 'download';
 if(c.type==='reset')return 'form_reset';
 // Being inside a form does not make links or type=button controls submissions.
 // Forward-labelled submit buttons can run their client-side click handlers;
 // the browser guard prevents native form submission and the route blocks writes.
 if(c.submits||c.form&&c.submits===undefined){
  return /^(next|continue|start|get started|learn more|view|show|read|open|see|explore)(?:\s*[→›»!]|\s+.*)?$/i.test(c.label||'')?'guarded_navigation':'form';
 }
 return 'navigation';
}
export const canNavigate=c=>['navigation','guarded_navigation'].includes(classifyControl(c));
