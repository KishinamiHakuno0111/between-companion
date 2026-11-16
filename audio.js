const fail=message=>new Error(message);
export function requireSpeech(api) {
  if(api.provider!=='deepseek'||!api.apiKey||new URL(api.baseUrl).origin!=='https://api.deepseek.com')throw fail('语音功能需要先连接 DeepSeek 官方 API。');
}
export function speechChunks(text) {
  // At most 9,000 billing characters and under 64 KiB, including all-CJK text.
  const points=Array.from(text),chunks=[];for(let i=0;i<points.length;i+=4500)chunks.push(points.slice(i,i+4500).join(''));return chunks;
}
export async function speechRequest(api,kind,body,signal) {
  requireSpeech(api);
  const response=await fetch(`https://api.deepseek.com/v1/tools/${kind}`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${api.apiKey}`,...(kind==='tts'?{'Content-Type':'application/json'}:{})},body,signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(180000)])});
  if(!response.ok){await response.body?.cancel();throw fail(`语音服务返回 ${response.status}，请检查密钥、余额或音频格式后重试。`);}
  return response;
}
export async function transcribe(api,bytes,signal) {
  if(bytes.length<44 || bytes.length>8*1024*1024 || bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('请使用不超过 120 秒、8 MB 的 PCM WAV 录音。');
  const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');
  const response=await speechRequest(api,'asr',form,signal),data=await response.json();
  if(typeof data.text!=='string'||!data.text.trim()||data.text.length>12000)throw fail('没有识别到有效文字，请重试。');
  return {text:data.text};
}
export async function synthesize(api,text,index,signal) {
  const chunks=speechChunks(text);
  if(!Number.isInteger(index)||index<0||index>=chunks.length||!chunks[index].trim())throw fail('没有可朗读的内容。');
  const response=await speechRequest(api,'tts',JSON.stringify({text:chunks[index],voice_id:api.voice||'stella',format:'wav',filter_markdown:true}),signal);
  const pieces=[];let size=0;
  for await(const piece of response.body){size+=piece.length;if(size>64*1024*1024)throw fail('语音响应过大，请重试较短的回复。');pieces.push(Buffer.from(piece));}
  const bytes=Buffer.concat(pieces);if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF')throw fail('语音服务没有返回有效音频。');
  return {bytes,total:chunks.length};
}
