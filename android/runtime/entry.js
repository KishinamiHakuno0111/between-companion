import {createApp} from '../../server.js';
import {installNetwork} from './network.js';
// Some older system WebViews need these two AbortSignal helpers.
if(!AbortSignal.timeout)AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;};
if(!AbortSignal.any)AbortSignal.any=signals=>{const c=new AbortController();for(const s of signals){if(s.aborted){c.abort();break;}s.addEventListener('abort',()=>c.abort(),{once:true});}return c.signal;};
const app=createApp({notify:(c,m)=>BetweenNative.notifyMessage(c.id,c.name,m.id,m.content),schedule:delay=>BetweenNative.scheduleProactive(delay)});installNetwork(app.server);
app.startProactive();
globalThis.__betweenPaste=(name,mime,data)=>{
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  window.dispatchEvent(new CustomEvent('between-file-paste',{detail:new File([bytes],name,{type:mime})}));
};
globalThis.__betweenBack=()=>{
  const dialog=document.querySelector('dialog[open]');if(dialog){dialog.dispatchEvent(new Event('cancel',{cancelable:true}));document.querySelector('#closeModal').click();return;}
  const view=document.querySelector('#app');
  if(view.classList.contains('details-open')){document.querySelector('#closeDetails').click();return;}
  if(view.classList.contains('mobile-chat')){document.querySelector('#backToList').click();return;}
  BetweenNative.minimize();
};
await import('../../public/app.js');
window.__betweenOpenCharacter=id=>window.dispatchEvent(new CustomEvent('between-open-character',{detail:id}));
BetweenNative.ready();
document.querySelector('#generationStatus').textContent='长按输入框可粘贴文字或图片';
const mobilePaste=document.createElement('button');mobilePaste.type='button';mobilePaste.className='icon-button';mobilePaste.title='粘贴图片';mobilePaste.setAttribute('aria-label','粘贴图片');mobilePaste.textContent='贴';mobilePaste.onclick=()=>BetweenNative.pasteImage();document.querySelector('#attachFile').after(mobilePaste);
