const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function url(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function citedText(message) {
  const points=Array.from(message.content||''),ends=new Map(),list=message.metadata?.citations||[];
  list.forEach((c,i)=>{if(url(c.url)&&Number.isInteger(c.end)&&c.end>0&&c.end<=points.length){const items=ends.get(c.end)||[];items.push(`<a class="citation" href="${esc(url(c.url))}" target="_blank" rel="noopener noreferrer" title="${esc(c.title)}" aria-label="来源 ${i+1}：${esc(c.title)}">[${i+1}]</a>`);ends.set(c.end,items);}});
  let out='';points.forEach((c,i)=>{out+=esc(c);if(ends.has(i+1))out+=ends.get(i+1).join('');});return out;
}
export const speechControl=active=>active?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none"/></svg>':'朗读';
export function replyExtras(m,{speaking=false}={}) {
  if(m.role!=='assistant')return '';
  const meta=m.metadata||{},reason=meta.reasoning||meta.providerResponse?.reasoning_content;
  const sources=(list,label)=>list?.length?`<details class="sources"><summary>${label} · ${list.length}</summary><ol>${list.filter(c=>url(c.url)).map(c=>`<li><a href="${esc(url(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.title||c.url)}</a><small>${esc(new URL(c.url).hostname)}</small></li>`).join('')}</ol></details>`:'';
  return `<div class="reply-extras">${reason?`<details class="reasoning"><summary>思考过程</summary><div>${esc(reason)}</div></details>`:''}${sources(meta.citations,'引用来源')}${sources(meta.consulted,'查阅网页')}<div class="reply-actions"><button data-copy-reply="${esc(m.id)}">复制</button><button data-speak-reply="${esc(m.id)}" aria-label="${speaking?'停止朗读':'朗读'}" title="${speaking?'停止朗读':'朗读'}" aria-pressed="${speaking}">${speechControl(speaking)}</button></div></div>`;
}
export function wavFromSamples(parts,rate){
  const length=parts.reduce((n,p)=>n+p.length,0),source=new Float32Array(length);let cursor=0;for(const part of parts){source.set(part,cursor);cursor+=part.length;}
  const count=Math.floor(length*16000/rate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const ascii=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,36+count*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const pos=i*rate/16000,lo=Math.floor(pos),mix=pos-lo;const v=Math.max(-1,Math.min(1,(source[lo]||0)*(1-mix)+(source[lo+1]||0)*mix));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
  return new Blob([buffer],{type:'audio/wav'});
}
export async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器无法录音，请换用新版浏览器。');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});
  let context;
  try {
    context=new AudioContext();await context.resume();
    const input=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1),silent=context.createGain();silent.gain.value=0;
    const parts=[];let samples=0,ended=false,level=0;
    processor.onaudioprocess=e=>{if(ended)return;const part=e.inputBuffer.getChannelData(0);let sum=0;for(const value of part)sum+=value*value;level=Math.min(1,Math.sqrt(sum/part.length)*5);if(samples+part.length<=context.sampleRate*120){parts.push(new Float32Array(part));samples+=part.length;}};
    input.connect(processor);processor.connect(silent);silent.connect(context.destination);
    return {getLevel:()=>level,stop:async()=>{if(ended)return null;ended=true;level=0;processor.disconnect();input.disconnect();silent.disconnect();stream.getTracks().forEach(t=>t.stop());const rate=context.sampleRate;await context.close();return wavFromSamples(parts,rate);}};
  }catch(e){stream.getTracks().forEach(t=>t.stop());await context?.close();throw e;}
}
