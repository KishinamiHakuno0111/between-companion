import assert from 'node:assert/strict';
import {copyFile,mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url)),build=resolve(root,'build');
const folder=await mkdtemp(resolve(build,'standalone-独立测试 ')),exe=resolve(folder,'此间.exe');
await copyFile(resolve(root,process.env.BETWEEN_EXE_OUTPUT||'../此间.exe'),exe);
const occupied=http.createServer((_req,res)=>res.end('Another application'));
// Keep the fallback range below Windows' reserved ephemeral port ranges.
occupied.listen(19000+Math.floor(Math.random()*1000),'127.0.0.1');await once(occupied,'listening');const basePort=occupied.address().port;let url;
const upstream=http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.writeHead(404);res.end('{}');return;}
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
  assert.equal(input.messages.at(-1).content,'打包后也能聊天吗？');
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'可以，独立程序运行正常。'}}]})+'\n\n');
  res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const children=[];
function launch(){
  const child=spawn(exe,['--no-open','--port',String(basePort)],{cwd:folder,windowsHide:true,env:{...process.env,PATH:resolve(process.env.SystemRoot,'System32'),NODE_OPTIONS:'',NODE_PATH:''}});
  children.push(child);child.output='';child.stdout.on('data',chunk=>child.output+=chunk);child.stderr.on('data',chunk=>child.output+=chunk);return child;
}
async function ready(child){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(child.output);
    for(let port=basePort+1;port<basePort+32;port++)try{const address=`http://127.0.0.1:${port}`,r=await fetch(address+'/api/desktop-instance',{signal:AbortSignal.timeout(300)});if(r.ok&&(await r.json()).app==='between-desktop'){url=address;return;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }throw new Error('启动超时：'+child.output);
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}}
const call=async(path,method='GET',body)=>{
  const response=await fetch(url+path,{method,headers:{'Content-Type':'application/json','X-Companion':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,await response.clone().text());return response.json();
};
try{
  let child=launch();await ready(child);
  const html=await(await fetch(url)).text();assert.ok(html.includes('此间'));assert.ok((await(await fetch(url+'/app.js')).text()).includes('attachmentHTML'));assert.ok((await(await fetch(url+'/style.css')).text()).includes('.composer'));
  assert.ok((await(await fetch(url+'/chat-features.js')).text()).includes('wavFromSamples'),'新版前端模块已内嵌');
  assert.ok((await(await fetch(url+'/proactive-ui.js')).text()).includes('startProactiveUI'),'主动联系界面模块已内嵌');
  const state=await call('/api/state');assert.equal(state.characters.length,0);assert.equal(state.settings.api.hasKey,false);
  const character=await call('/api/characters','POST',{name:'便携测试',persona:'自然地交流',avatar:''});
  await call(`/api/characters/${character.id}/memories`,'POST',{title:'偏好',content:'喜欢红茶',category:'喜好'});
  await call('/api/settings','PUT',{api:{...state.settings.api,provider:'openai',model:'local-test',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,apiKey:'temporary-test-key',autoMemory:false}});
  const response=await fetch(url+`/api/characters/${character.id}/chat`,{method:'POST',headers:{'Content-Type':'application/json','X-Companion':'1'},body:JSON.stringify({content:'打包后也能聊天吗？'})});
  const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done');assert.ok(events.some(e=>e.type==='reply'&&e.message.content.includes('独立程序')));
  await call('/api/proactive/settings','PUT',{idleMinHours:8,idleMaxHours:12,quietStart:'23:00',quietEnd:'07:00'});
  await call(`/api/characters/${character.id}`,'PUT',{proactiveEnabled:true});
  const duplicate=launch();await Promise.race([once(duplicate,'exit'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('重复启动未退出')),10000);timer.unref();})]);
  assert.equal(duplicate.exitCode,0,duplicate.output);assert.ok(duplicate.output.includes('已在运行'));assert.equal(child.exitCode,null);
  await stop(child);child=launch();await ready(child);
  const persisted=await call('/api/state');assert.equal(persisted.characters[0].id,character.id);assert.equal((await call(`/api/characters/${character.id}/memories`))[0].content,'喜欢红茶');
  assert.equal((await call(`/api/characters/${character.id}/messages`)).length,2);
  assert.equal(persisted.characters[0].proactiveEnabled,true);assert.equal(persisted.settings.proactive.idleMinHours,8);
  assert.equal((await readFile(resolve(folder,'data/between.sqlite'))).subarray(0,15).toString(),'SQLite format 3');
  console.log('PASS: standalone EXE without Node on PATH, embedded assets, SQLite, streamed chat, port fallback, duplicate launch and restart persistence.');
}finally{
  for(const child of children)await stop(child);
  await new Promise(r=>occupied.close(r));await new Promise(r=>upstream.close(r));
  // Delete only the unique, resolved test directory made above; never application data.
  if(!folder.startsWith(build+sep))throw new Error('Refusing cleanup outside test build directory');
  await rm(folder,{recursive:true,force:true});
}
