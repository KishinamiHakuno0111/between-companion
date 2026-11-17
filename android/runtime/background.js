import {createApp} from '../../server.js';
import {installNetwork} from './network.js';
if(!AbortSignal.timeout)AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;};
if(!AbortSignal.any)AbortSignal.any=signals=>{const c=new AbortController();for(const s of signals){if(s.aborted){c.abort();break;}s.addEventListener('abort',()=>c.abort(),{once:true});}return c.signal;};
const app=createApp({notify:(c,m)=>BetweenNative.notifyMessage(c.id,c.name,m.id,m.content),schedule:delay=>BetweenNative.scheduleProactive(delay)});
installNetwork(app.server);
try{await app.proactive.tick();}finally{BetweenNative.scheduleProactive(app.proactive.nextDelay());app.close();BetweenNative.finished();}
