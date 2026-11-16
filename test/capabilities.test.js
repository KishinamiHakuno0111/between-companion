import test from 'node:test';
import assert from 'node:assert/strict';
import {currentEnvironment,responseSources} from '../capabilities.js';
import {provider} from '../provider.js';
import {assembleContext,summaryInput,defaults,estimateTokens} from '../core.js';
import {createTestStore} from './fixtures.js';
import {createApp} from '../server.js';
import {once} from 'node:events';
import {citedText,replyExtras,wavFromSamples} from '../public/chat-features.js';
import {transcribe,synthesize,speechChunks} from '../audio.js';

test('日期时区跨日，每轮刷新且只注入一次，摘要不读取环境/工具内部数据',()=>{
  const now=new Date('2026-11-16T16:05:06Z');
  const env=currentEnvironment('Asia/Shanghai',null,now);assert.match(env,/2026年11月17日/);assert.match(env,/00:05:06/);assert.match(env,/GMT\+08:00/);
  assert.match(currentEnvironment('America/Los_Angeles',null,now),/2026年11月16日/);
  assert.doesNotThrow(()=>currentEnvironment('bad\nINJECT',null,now));
  const store=createTestStore(),history=[{seq:1,role:'user',content:'现在几点？'},{seq:2,role:'assistant',content:'你好',metadata:{providerResponse:{reasoning_content:'INTERNAL_TOOL_SECRET',server_tool_calls:[]}}}];
  const input=assembleContext({character:store.character('lin'),player:{name:'我'},memories:[],history,environment:env});
  assert.equal(JSON.stringify(input).split('【当前设备时间】').length,2);
  assert.ok(estimateTokens(input)>estimateTokens(input.map(({_provider,...m})=>m)));
  assert.doesNotMatch(JSON.stringify(summaryInput(null,history)),/当前设备时间|INTERNAL_TOOL_SECRET/);store.db.close();
});

const calls=[{index:0,reasoning_content:'第一步',calls:[{index:0,id:'srvtoolu_test',type:'deepseek_read_url',kind:'read_link',action:{type:'read_link',url:'https://example.com'},status:'completed',page:{url:'https://example.com',title:'示例网页'},signature:'opaque-page-signature'}]}];
const annotations=[{type:'url_citation',url_citation:{url:'https://example.com',title:'来源标题',start_index:0,end_index:3}}];
test('流式工具事件、思考分步、来源、签名多轮回传；辅助任务与兼容接口不携带工具',async t=>{
  const bodies=[],events=[];const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));const chunks=[{choices:[{delta:{reasoning_content:'第一步'}}]},{choices:[{delta:{},server_tool_event:{type:'step_reasoning_done',step:0}}]},{choices:[{delta:{},server_tool_event:{type:'call_started',step:0,call:calls[0].calls[0]}}]},{choices:[{delta:{reasoning_content:'最终思考',content:'🌙你好'}}]},{choices:[{delta:{server_tool_calls:calls,annotations},finish_reason:'stop'}],usage:{server_tool_use:{tool_fetch:1}}}];
    if(!bodies.at(-1).stream)return Response.json({choices:[{message:{content:'摘要'}}]});
    return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});};
  const config={...defaults,provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',apiKey:'fake-test-only',webSearch:true};
  const result=await provider(config).stream([{role:'user',content:'读网页'}],()=>{},e=>events.push(e));
  assert.equal(result.content,'🌙你好');assert.equal(result.metadata.providerResponse.reasoning_content,'最终思考');assert.equal(result.metadata.reasoning,'第一步最终思考');assert.equal(result.metadata.citations.length,1);assert.ok(events.some(e=>e.type==='status'));
  assert.deepEqual(bodies[0].tools,[{type:'deepseek_web_search'},{type:'deepseek_read_url'}]);
  const history=[{role:'assistant',content:result.content,_provider:result.metadata.providerResponse},{role:'user',content:'继续问'}];
  await provider({...config,webSearch:false,readUrl:false,thinking:false}).stream(history,()=>{});
  assert.equal(bodies[1].tools,undefined);assert.equal(bodies[1].thinking.type,'disabled');assert.deepEqual(bodies[1].messages[0].server_tool_calls,calls);assert.ok(!('_provider' in bodies[1].messages[0]));
  await provider(config).complete(history);assert.equal(bodies[2].tools,undefined);assert.equal(bodies[2].messages[0].server_tool_calls,undefined);
  await provider({...config,provider:'openai'}).stream(history,()=>{});assert.equal(bodies[3].tools,undefined);assert.equal(bodies[3].thinking,undefined);assert.equal(bodies[3].messages[0].server_tool_calls,undefined);
});

test('最终 chunk 报错或中断不会当成成功回复，非流式错误同样处理',async t=>{
  const orig=globalThis.fetch;t.after(()=>globalThis.fetch=orig);const p=provider({...defaults,apiKey:'fake',model:'test'});
  for(const [data,stream] of [[{error:{message:'failed'},choices:[]},true],[{choices:[{delta:{content:'半句话'}}]},true],[{error:{message:'failed'}},false]]){
    globalThis.fetch=async()=>new Response(stream?'data: '+JSON.stringify(data)+'\n\n':JSON.stringify(data),{headers:{'Content-Type':stream?'text/event-stream':'application/json'}});
    await assert.rejects(()=>p.stream([{role:'user',content:'test'}],()=>{}));
  }
});

test('引用按 Unicode 码点定位，过滤脚本地址并转义模型文字',()=>{
  const meta=responseSources({annotations:[...annotations,{type:'url_citation',url_citation:{url:'javascript:alert(1)',title:'unsafe'}}],server_tool_calls:calls});
  assert.equal(meta.citations.length,1);assert.equal(meta.consulted.length,0);
  const m={role:'assistant',id:'id',content:'🌙你好<script>',metadata:meta};const html=citedText(m);
  assert.match(html,/🌙你好<a /);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(replyExtras(m),/javascript:/);
});

test('语音 WAV 编码、分段、转写与朗读协议',async t=>{
  const wav=Buffer.from(await wavFromSamples([new Float32Array(48000).fill(.2)],48000).arrayBuffer());assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.length,32044);
  assert.equal(speechChunks('中'.repeat(9001)).length,3);
  const orig=globalThis.fetch;t.after(()=>globalThis.fetch=orig);let posted;
  globalThis.fetch=async(url,options)=>{posted={url,options};return url.endsWith('asr')?Response.json({text:'你好'}):new Response(wav,{headers:{'content-type':'audio/wav'}});};
  const api={...defaults,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'fake'};
  assert.equal((await transcribe(api,wav)).text,'你好');assert.equal(posted.options.body.get('file').type,'audio/wav');
  const result=await synthesize(api,'朗读',0);assert.deepEqual(result.bytes,wav);assert.equal(JSON.parse(posted.options.body).voice_id,'stella');
  await assert.rejects(()=>transcribe(api,Buffer.from('not audio')));await assert.rejects(()=>synthesize({...api,provider:'openai'},'test',0));
});

test('偏好持久化、网页响应角色隔离、重启后保留；朗读不能跨角色获取',async t=>{
  const store=createTestStore(),app=createApp({store});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(r=>app.server.close(r));store.db.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;const call=(path,body)=>fetch(base+path,{method:'PUT',headers:{'X-Companion':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await call('/api/preferences',{webSearch:true,thinking:false,voice:'tide'})).status,200);assert.equal(store.settings().api.webSearch,true);assert.equal(store.settings().api.voice,'tide');assert.equal((await call('/api/preferences',{voice:'unknown'})).status,400);
  const message=store.addMessage('lin','assistant','test',{providerResponse:{server_tool_calls:calls},citations:responseSources({annotations}).citations});
  assert.equal(store.messages('xia').some(m=>m.id===message.id),false);
  assert.equal((await fetch(base+`/api/characters/xia/speech/${message.id}`,{method:'POST',headers:{'X-Companion':'1'},body:'{}'})).status,404);
});
