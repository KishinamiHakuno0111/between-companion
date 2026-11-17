import test from 'node:test';
import assert from 'node:assert/strict';
import {provider} from '../provider.js';
import {completeObject,parseObject} from '../structured.js';

test('结构化结果仅接受合法对象与正确字段，不把台词或半截JSON当成消息',()=>{
  assert.deepEqual(parseObject('```json\n{"send":false,"content":""}\n```'),{send:false,content:''});
  for(const raw of ['（尾巴在地上拍了一下）','{"send":true','null','[]','解释：{"send":true}'])assert.throws(()=>parseObject(raw),e=>e.code==='MODEL_JSON_FORMAT'&&!e.message.includes(raw));
});

test('真实请求携带JSON模式；空白、截断和错误字段仅重试一次，普通聊天不受影响',async()=>{
  const original=globalThis.fetch,requests=[];let mode='blank',count=0;
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);count++;
    const content=count%2===1?(mode==='blank'?'   ':mode==='schema'?'{"send":"yes","content":"错误"}':'{"send":true'):JSON.stringify({send:true,content:'喵，时间到了。'});
    return Response.json({choices:[{message:{content},finish_reason:mode==='length'&&count%2===1?'length':'stop'}]});};
  try{
    const p=provider({provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'mock',model:'deepseek-flash'});
    const input=[{role:'system',content:'返回 JSON 对象'},{role:'user',content:'测试数据'}];
    for(mode of ['blank','length','schema']){count=0;const out=await completeObject(p,input,{maxTokens:1000,validate:v=>typeof v.send==='boolean'});assert.equal(out.send,true);assert.equal(count,2);}
    assert.ok(requests.every(r=>r.response_format.type==='json_object'&&r.thinking.type==='disabled'&&r.max_tokens===1000));
    await p.complete([{role:'user',content:'普通辅助请求'}]);assert.equal(requests.at(-1).response_format,undefined);
  }finally{globalThis.fetch=original;}
});

test('兼容服务明确不支持JSON参数时降级，认证失败不反复调用',async()=>{
  const original=globalThis.fetch,requests=[];let auth=false;
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);
    if(auth)return Response.json({error:'unauthorized'},{status:401});
    if(body.response_format)return Response.json({error:'response_format json_object is not supported'},{status:400});
    return Response.json({choices:[{message:{content:'{"send":false,"content":""}'},finish_reason:'stop'}]});};
  try{
    const p=provider({provider:'openai',baseUrl:'https://example.org/v1',apiKey:'mock',model:'mock'});
    const input=[{role:'user',content:'Return JSON'}];assert.equal((await completeObject(p,input,{maxTokens:100})).send,false);assert.equal(requests.length,2);assert.ok(requests[0].response_format);assert.equal(requests[1].response_format,undefined);
    auth=true;await assert.rejects(completeObject(p,input,{maxTokens:100}),/401/);assert.equal(requests.length,3);
  }finally{globalThis.fetch=original;}
});
