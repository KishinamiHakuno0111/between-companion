import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { createTestStore as createStore } from './fixtures.js';

async function fixture(t){
  const received=[];
  const upstream=http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'test-model',name:'Test model',context_window:1048576,max_output_tokens:393216}]}));return;}
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);received.push(body);
    if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'记住啦，9月12日。'}}]})+'\n\n');res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({memories:[{key:'birthday',title:'生日',content:'玩家的生日是9月12日',category:'个人信息',evidence:'我的生日是9月12日'}]})}}]}));}
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const store=createStore();const settings=store.settings();settings.api={...settings.api,baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,apiKey:'test-key-never-return',model:'test-model'};store.saveSettings(settings);
  const app=createApp({store});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(r=>app.server.close(r));await new Promise(r=>upstream.close(r));store.db.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Companion':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  return {store,request,received,base};
}

test('主动联系设置验证、角色独立开关、计划取消隔离和增量消息游标',async t=>{
  const {store,request}=await fixture(t);
  assert.equal((await request('/api/proactive/settings','PUT',{idleMinHours:12,idleMaxHours:6})).status,400);
  let response=await request('/api/proactive/settings','PUT',{idleMinHours:4,idleMaxHours:8,quietStart:'23:00',quietEnd:'07:00'});assert.equal(response.status,200);
  assert.equal(store.settings().proactive.idleMinHours,4);assert.ok(!JSON.stringify(await response.json()).includes('test-key-never-return'));
  assert.equal((await request('/api/characters/lin','PUT',{proactiveEnabled:'yes'})).status,400);
  await request('/api/characters/lin','PUT',{proactiveEnabled:true});assert.equal(store.character('lin').proactiveEnabled,true);assert.ok(!store.character('xia').proactiveEnabled);
  store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('event-one','lin','exam','考试',Date.now()+1000,Date.now()+100000,'考试',1,'pending');
  await request('/api/characters/xia/proactive/event-one','DELETE');assert.equal((await(await request('/api/characters/lin/proactive')).json()).events.length,1);
  await request('/api/characters/lin/proactive/event-one','DELETE');assert.equal((await(await request('/api/characters/lin/proactive')).json()).events.length,0);
  const start=(await(await request('/api/proactive/updates')).json()).cursor;
  store.addMessage('lin','assistant','主动消息',{proactive:'idle'});
  const delta=await(await request('/api/proactive/updates?after='+start)).json();assert.deepEqual(delta.characters,['lin']);assert.ok(delta.cursor>start);
  assert.deepEqual((await(await request('/api/proactive/updates?after='+delta.cursor)).json()).characters,[]);
  await request('/api/characters/lin','PUT',{proactiveEnabled:false});assert.equal(store.character('lin').proactiveEnabled,false);
});

test('完整聊天流、自动记忆提示、角色隔离、密钥不回传',async t=>{
  const {store,request,received}=await fixture(t);
  const response=await request('/api/characters/lin/chat','POST',{content:'我的生日是9月12日'});assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.type==='delta'));assert.ok(events.some(e=>e.type==='memory'&&e.message.content==='林屿记住了你的生日'));assert.equal(events.at(-1).type,'done');
  assert.equal(received.length,2);assert.equal(store.memories('lin').length,1);assert.equal(store.memories('xia').length,0);
  assert.equal('max_tokens' in received[0],false,'兼容接口自动回复不传自定义输出上限');
  const memoryId=store.memories('lin')[0].id;
  assert.equal((await request(`/api/characters/xia/memories/${memoryId}`,'DELETE')).status,404);assert.equal(store.memories('lin').length,1);
  assert.ok(!(await(await request('/api/state')).text()).includes('test-key-never-return'));
  const count=store.messages('lin').length;
  assert.equal((await request('/api/characters/lin/chat','POST',{retryId:events.find(e=>e.type==='user').message.id})).status,400);assert.equal(store.messages('lin').length,count);
});

test('人设覆盖的 API 保存、手动记忆修改删除、禁止跨站写入',async t=>{
  const {store,request,base}=await fixture(t);
  assert.equal((await request('/api/characters/lin','PUT',{playerOverride:{name:'专属名字',persona:'专属背景',avatar:''}})).status,200);
  assert.equal(store.character('lin').playerOverride.name,'专属名字');assert.equal(store.character('xia').playerOverride,null);
  const added=await(await request('/api/characters/lin/memories','POST',{title:'喜好',content:'不喝咖啡',category:'喜好'})).json();
  await request(`/api/characters/lin/memories/${added.id}`,'PUT',{title:'饮品偏好',content:'喜欢红茶',category:'喜好'});assert.equal(store.memories('lin')[0].content,'喜欢红茶');
  await request(`/api/characters/lin/memories/${added.id}`,'DELETE');assert.equal(store.memories('lin').length,0);
  assert.equal((await fetch(base+'/api/settings',{method:'PUT',headers:{'Origin':'https://unrelated.example','Content-Type':'application/json'},body:'{}'})).status,403);
});

test('缺少 API 配置时保留草稿语义，不写入用户消息',async t=>{
  const {store,request}=await fixture(t);const settings=store.settings();settings.api.apiKey='';store.saveSettings(settings);
  const count=store.messages('lin').length;assert.equal((await request('/api/characters/lin/chat','POST',{content:'你好'})).status,422);assert.equal(store.messages('lin').length,count);
});

test('连接获取模型不保存 Key；选择模型后支持 1M 上下文和自动输出',async t=>{
  const {store,request}=await fixture(t);const before=store.settings();
  const response=await request('/api/models','POST',{provider:'openai',baseUrl:before.api.baseUrl,apiKey:'ephemeral-new-key'});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.models[0].contextTokens,1048576);assert.equal(data.models[0].maxOutputTokens,393216);
  assert.deepEqual(store.settings(),before);assert.ok(!JSON.stringify(data).includes('ephemeral-new-key'));
  const saved=await request('/api/settings','PUT',{api:{...before.api,models:data.models,contextTokens:1048576,outputTokens:null}});
  assert.equal(saved.status,200);assert.equal(store.settings().api.outputTokens,null);
});

test('更换服务地址不能把旧地址的 Key 自动发送给新地址',async t=>{
  const {store,request}=await fixture(t);
  const response=await request('/api/models','POST',{provider:'openai',baseUrl:'http://127.0.0.1:1/v1',apiKey:''});
  assert.equal(response.status,400);assert.match((await response.json()).error,/填写 API Key/);
  assert.equal(store.settings().api.apiKey,'test-key-never-return');
});
