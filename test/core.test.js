import {createTestStore as createStore} from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleContext, prepareContext, parseExtracted, summaryInput, estimateTokens, retrieveMemories } from '../core.js';
import { readSSE, completionUrl } from '../provider.js';

test('角色隔离、人设完整覆盖，注入各一次，摘要覆盖的原文不重复',()=>{
  const store=createStore();
  store.saveMemory('lin',{key:'birthday',title:'生日',content:'独有记忆0912',category:'个人信息',source:'manual',evidence:''});
  store.saveMemory('xia',{key:'birthday',title:'生日',content:'其他角色秘密',category:'个人信息',source:'manual',evidence:''});
  const character={...store.character('lin'),persona:'角色标记-ONE',playerOverride:{name:'月',persona:'专属标记-TWO'}};
  const messages=assembleContext({character,player:{name:'全局玩家',persona:'全局标记-NEVER'},memories:store.memories('lin'),summary:{content:'旧对话摘要',through_seq:9},history:[{seq:8,role:'user',content:'已经压缩的原文'},{seq:10,role:'user',content:'你好'},{seq:11,role:'notice',content:'注入的提示不算对话'}]});
  const raw=JSON.stringify(messages);
  for(const value of ['角色标记-ONE','专属标记-TWO','独有记忆0912','旧对话摘要'])assert.equal(raw.split(value).length-1,1);
  for(const value of ['其他角色秘密','全局标记-NEVER','全局玩家','已经压缩的原文','注入的提示不算对话'])assert.ok(!raw.includes(value));
  assert.equal(messages.at(-1).content,'你好');store.db.close();
});

test('临近上限增量压缩：只使用原始对话，保留数据库历史，后续请求不重复压缩',async()=>{
  const store=createStore(), c={...store.character('lin'),persona:'PRIVATE_PERSONA_MARKER'};
  store.saveCharacter(c);store.saveMemory(c.id,{key:'birthday',title:'生日',content:'PRIVATE_MEMORY_MARKER',category:'个人信息',source:'manual',evidence:''});
  for(let i=0;i<32;i++)store.addMessage(c.id,i%2?'assistant':'user',`原始消息${i} `+'abcdefghij'.repeat(45));
  store.addMessage(c.id,'notice','SYSTEM_NOTICE_NEVER_SUMMARIZE');
  const settings=store.settings();settings.api.contextTokens=4096;settings.api.outputTokens=256;
  let calls=0;
  const complete=async input=>{calls++;const serialized=JSON.stringify(input);assert.ok(!serialized.includes('PRIVATE_PERSONA_MARKER'));assert.ok(!serialized.includes('PRIVATE_MEMORY_MARKER'));assert.ok(!serialized.includes('SYSTEM_NOTICE_NEVER_SUMMARIZE'));const data=JSON.parse(input[1].content);assert.ok(data.dialogue.length>0);return `过去的聊天摘要，批次${calls}。`;};
  const before=store.messages(c.id).length;
  const result=await prepareContext(store,c,settings,complete);
  assert.ok(calls>0);assert.ok(estimateTokens(result.messages)<4096-256);assert.equal(store.messages(c.id).length,before);
  assert.ok(!JSON.stringify(result.messages).includes('原始消息0 '));assert.ok(JSON.stringify(result.messages).includes('原始消息31 '));
  const priorCalls=calls;await prepareContext(store,c,settings,complete);assert.equal(calls,priorCalls);store.db.close();
});

test('压缩失败不推进摘要游标、不删除原文',async()=>{
  const store=createStore();for(let i=0;i<20;i++)store.addMessage('lin',i%2?'assistant':'user','早期对话'.repeat(100));
  const settings=store.settings();settings.api.contextTokens=4096;settings.api.outputTokens=256;
  const count=store.messages('lin').length;
  await assert.rejects(prepareContext(store,store.character('lin'),settings,async()=>{throw Error('模型暂不可用');}),/模型暂不可用/);
  assert.equal(store.summary('lin'),null);assert.equal(store.messages('lin').length,count);store.db.close();
});

test('记忆必须有逐字证据，忽略模型伪造的角色ID；同键更正不新增副本',()=>{
  const good={key:'birthday',title:'生日',content:'9月12日',category:'个人信息',evidence:'我的生日是9月12日',id:'forged',character_id:'xia'};
  const values=parseExtracted(JSON.stringify({memories:[good,{...good,key:'bad',evidence:'不存在的证据'}]}),'我的生日是9月12日');
  assert.equal(values.length,1);assert.equal(values[0].character_id,undefined);assert.equal(values[0].id,undefined);
  const store=createStore();store.saveMemory('lin',values[0]);store.saveMemory('lin',{...values[0],content:'9月13日'});assert.equal(store.memories('lin').length,1);assert.equal(store.memories('lin')[0].content,'9月13日');assert.equal(store.memories('xia').length,0);store.db.close();
});

test('SSE 解码支持分片 UTF-8、CRLF、注释及结束标记',async()=>{
  const bytes=new TextEncoder().encode(': ping\r\ndata: {"text":"你好"}\r\n\r\ndata: [DONE]\n\n');
  async function* chunks(){for(let i=0;i<bytes.length;i+=2)yield bytes.slice(i,i+2);}
  const events=[];for await(const event of readSSE(chunks()))events.push(event);
  assert.deepEqual(events,['{"text":"你好"}','[DONE]']);
  assert.equal(completionUrl('https://api.deepseek.com'),'https://api.deepseek.com/chat/completions');
  assert.equal(completionUrl('https://example.com/v1/chat/completions/'),'https://example.com/v1/chat/completions');
  assert.throws(()=>completionUrl('https://key:secret@example.com/v1'));
});

test('召回预算约束及旧摘要输入不会自行添加注入字段',()=>{
  const memories=Array.from({length:30},(_,i)=>({key:`key${i}`,title:'爱好',content:'喜欢下雨'.repeat(20),updated_at:'2026-01-01'}));
  assert.ok(retrieveMemories(memories,'下雨',500).length<3);
  const input=JSON.parse(summaryInput({content:'旧摘要'},[{role:'user',content:'原始对话'}])[1].content);
  assert.deepEqual(Object.keys(input),['previousDialogueSummary','dialogue']);
});
