import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

await build({stdin:{contents:"export {createApp} from '../server.js'; export {installNetwork} from './runtime/network.js';",resolveDir:process.cwd()},outfile:'build/mobile-test-bundle.mjs',bundle:true,format:'esm',platform:'browser',target:'chrome100',inject:[resolve('runtime/platform.js')],plugins:[{name:'android-platform',setup(build){build.onResolve({filter:/^node:/},()=>({path:resolve('runtime/platform.js')}));}}]});
const nativeFetch=globalThis.fetch,db=new DatabaseSync(':memory:');
const unpack=v=>JSON.parse(v,(_key,x)=>x?.__blob?Buffer.from(x.__blob,'base64'):x);
const pack=v=>JSON.stringify(v,(_key,x)=>x instanceof Uint8Array?{__blob:Buffer.from(x).toString('base64')}:x);
const controllers=new Map(),received=[];
globalThis.location=new URL('https://appassets.androidplatform.net/');
globalThis.BetweenNative={
  sql(mode,sql,args){try{const values=unpack(args);if(mode==='exec'){db.exec(sql);return '{}';}const statement=db.prepare(sql);return mode==='all'?pack(statement.all(...values)):JSON.stringify(statement.run(...values));}catch(error){return JSON.stringify({error:error.message});}},
  sha256:value=>createHash('sha256').update(value).digest('hex'),
  cancel(id){controllers.get(id)?.abort();},
  async request(id,raw){const data=JSON.parse(raw),controller=new AbortController();controllers.set(id,controller);
    try{const response=await nativeFetch(data.url,{method:data.method,headers:data.headers,body:data.body?Buffer.from(data.body,'base64'):undefined,signal:controller.signal});
      globalThis.__betweenNetwork(id,{type:'headers',status:response.status,headers:Object.fromEntries(response.headers)});
      for await(const chunk of response.body)globalThis.__betweenNetwork(id,{type:'data',data:Buffer.from(chunk).toString('base64')});globalThis.__betweenNetwork(id,{type:'end'});
    }catch(error){globalThis.__betweenNetwork(id,{type:'error',message:error.message});}finally{controllers.delete(id);}
  },
};
const upstream=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({data:[{id:'mobile-test',context_window:131072}]}));}
  let bytes='';for await(const chunk of req)bytes+=chunk;const input=JSON.parse(bytes);received.push(input);
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'手机独立回复'}}]})+'\n\n');res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
try{
  const {createApp,installNetwork}=await import('./build/mobile-test-bundle.mjs');const app=createApp();installNetwork(app.server);
  const call=async(path,method='GET',body)=>{const response=await fetch(location.origin+path,{method,headers:{'X-Companion':'1','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  let state=await call('/api/state');assert.equal(state.characters.length,0);assert.equal(state.settings.api.hasKey,false);
  const settings={...state.settings.api,provider:'openai',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,model:'mobile-test',apiKey:'test-mobile-only',autoMemory:false};
  const models=await call('/api/models','POST',settings);assert.equal(models.models[0].id,'mobile-test');
  await call('/api/settings','PUT',{api:settings});
  const character=await call('/api/characters','POST',{name:'手机角色',persona:'自然交流',avatar:''});
  const other=await call('/api/characters','POST',{name:'另一个角色',persona:'独立记忆'});
  const png=await readFile('../test/fixtures/attachment.png');
  const upload=await fetch(location.origin+`/api/characters/${character.id}/attachments?name=mobile.png`,{method:'POST',headers:{'X-Companion':'1'},body:new Blob([png])});assert.equal(upload.status,201);const attachment=await upload.json();
  const foreign=await fetch(location.origin+`/api/characters/${other.id}/attachments/${attachment.id}`);assert.equal(foreign.status,404);
  const response=await fetch(location.origin+`/api/characters/${character.id}/chat`,{method:'POST',headers:{'X-Companion':'1'},body:JSON.stringify({content:'看看图片',attachmentIds:[attachment.id]})});
  const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done',JSON.stringify(events));assert.ok(events.some(e=>e.type==='delta'&&e.text==='手机独立回复'));
  assert.ok(received[0].messages.at(-1).content.some(p=>p.type==='image_url'));
  assert.match(received[0].messages[0].content,/当前设备时间/);
  await call('/api/preferences','PUT',{webSearch:true,readUrl:true,thinking:false,voice:'tide'});
  await call(`/api/characters/${character.id}/memories`,'POST',{title:'生日',content:'9月12日',category:'个人信息'});
  await call(`/api/characters/${character.id}`,'PUT',{name:'已更新的手机角色'});
  assert.equal((await call(`/api/characters/${character.id}/messages`)).length,2,'更新角色不会级联删除聊天');
  assert.equal((await call(`/api/characters/${other.id}/memories`)).length,0);
  const restarted=createApp();const persisted=await(await restarted.server.dispatch('/api/state')).json();assert.equal(persisted.characters.length,2);assert.equal(persisted.settings.api.hasKey,true);assert.ok(!JSON.stringify(persisted).includes('test-mobile-only'));
  assert.equal(persisted.settings.api.webSearch,true);assert.equal(persisted.settings.api.voice,'tide');
  const downloaded=await restarted.server.dispatch(`/api/characters/${character.id}/attachments/${attachment.id}`);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),png);
  console.log('PASS: Android runtime startup, SQLite bridge, model discovery, settings, role isolation, attachment round trip, SSE replies and restart persistence.');
}finally{globalThis.fetch=nativeFetch;await new Promise(r=>upstream.close(r));db.close();}
