// Optional live smoke test: stdin credential and in-memory SQLite only.
import { createStore } from '../core.js';
import { attachmentStore } from '../attachments.js';
import { provider } from '../provider.js';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.resume();console.log('Ready for temporary credential on stdin (hidden).');
let input='';
process.stdin.on('data',async chunk=>{
  input+=chunk.toString();if(!/[\r\n]/.test(input))return;
  process.stdin.removeAllListeners('data');process.stdin.pause();
  const api={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:input.trim()};input='';
  const store=createStore(),files=attachmentStore(store.db),remoteIds=[];
  store.saveCharacter({id:'smoke',name:'测试'});
  try{
    const ids=[];
    for(const name of ['attachment.png','attachment.txt','attachment.pdf']){
      const bytes=await readFile(new URL(`./fixtures/${name}`,import.meta.url));
      ids.push(await files.upload('smoke',Readable.from([bytes]),name,api));
    }
    const message=store.addMessage('smoke','user','用一句话回答图片的颜色、文本文件里的验证码、PDF 里的口令。',{attachments:ids});files.bind('smoke',ids.map(a=>a.id),message.id);
    const history=await files.hydrate('smoke',[message],api,undefined,()=>console.log('Uploading synthetic test attachment.'));
    const parts=history[0].metadata.attachments.map(a=>a.part);remoteIds.push(...parts.map(p=>p.file_id));
    const reply=await provider(api).complete([{role:'user',content:[{type:'text',text:message.content},...parts]}],{maxTokens:128});
    console.log(JSON.stringify({uploads:parts.length,reply}));
    if(!reply.includes('732')||!reply.includes('915')||!reply.includes('红'))throw new Error('Reply did not recognize all synthetic test attachments.');
  }catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
  finally{
    // Delete only the disposable remote objects created by this smoke test.
    for(const row of store.db.prepare('SELECT value FROM attachments').all()){
      const id=JSON.parse(row.value).remote?.id;if(id&&!remoteIds.includes(id))remoteIds.push(id);
    }
    for(const id of remoteIds){try{const response=await fetch(`https://api.deepseek.com/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${api.apiKey}`},signal:AbortSignal.timeout(30000)});console.log(JSON.stringify({testFileDeleted:response.ok}));}catch{console.log('Test file cleanup unavailable; expiration is configured.');}}
    api.apiKey='';store.db.close();process.exit(process.exitCode||0);
  }
});
