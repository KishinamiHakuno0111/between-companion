import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createStore,seeds,defaults,outputReservation} from '../core.js';
import {provider} from '../provider.js';

test('新安装没有默认角色，输出默认自动',()=>{
  const store=createStore();assert.equal(store.characters().length,0);assert.equal(store.settings().api.outputTokens,null);assert.equal(store.settings().api.provider,'deepseek');assert.equal(store.settings().api.webSearch,true);assert.equal(store.settings().api.baseUrl,'https://api.deepseek.com');assert.equal(store.settings().api.contextTokens,1048576);const saved=store.settings();saved.api={...saved.api,webSearch:false,provider:'openai',baseUrl:'https://example.org/v1',model:'saved-model'};store.saveSettings(saved);assert.equal(store.settings().api.provider,'openai');assert.equal(store.settings().api.webSearch,false);assert.equal(store.settings().api.baseUrl,'https://example.org/v1');store.db.close();
});

test('升级仅移除未使用的默认角色，保留真实聊天和编辑后的角色',()=>{
  const dir=mkdtempSync(join(tmpdir(),'between-migration-')),file=join(dir,'test.sqlite');
  let store=createStore(file);
  try{
    for(const seed of seeds){store.saveCharacter({...seed,playerOverride:null});store.addMessage(seed.id,'assistant',seed.greeting,{greeting:true});}
    store.addMessage('xia','user','用户真实对话');store.saveCharacter({...store.character('shen'),name:'自定义角色'});
    store.db.exec('PRAGMA user_version=1');store.db.close();store=createStore(file);
    assert.equal(store.character('lin'),undefined);assert.equal(store.messages('xia').at(-1).content,'用户真实对话');assert.equal(store.character('shen').name,'自定义角色');
  }finally{store.db.close();rmSync(file);rmdirSync(dir);}
});

test('DeepSeek 自动输出使用模型最大值；辅助任务单独设置小预算和非思考模式',async()=>{
  const bodies=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);bodies.push(body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const api={...defaults,provider:'deepseek',model:'flash-test',baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test',contextTokens:1048576,models:[{id:'flash-test',maxOutputTokens:393216}]};
    await provider(api).stream([{role:'user',content:'你好'}],()=>{});
    await provider(api).complete([{role:'user',content:'摘要'}],{maxTokens:800});
    assert.equal(bodies[0].max_tokens,393216);assert.equal(bodies[0].thinking.type,'enabled');
    assert.equal(bodies[1].max_tokens,800);assert.equal(bodies[1].thinking.type,'disabled');
    assert.equal(outputReservation(api),393216);
  }finally{await new Promise(r=>server.close(r));}
});
