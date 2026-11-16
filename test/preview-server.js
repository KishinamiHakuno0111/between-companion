// Browser QA only: in-memory database + a local deterministic mock, never a real provider.
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { createTestStore as createStore } from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const mock=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/v1/models'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({data:[{id:'local-test-only',name:'QA Model',context_window:1048576,max_output_tokens:393216}]}));return;
  }
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
  if(input.stream){
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    if(process.env.QA_TOOLS==='1'){
      res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'测试思考内容，不调用真实模型。'}}]})+'\n\n');
      res.write('data: '+JSON.stringify({choices:[{delta:{},server_tool_event:{type:'call_started',step:0,call:{action:{type:'search'}}}}]})+'\n\n');
    }
    const words=process.env.QA_RENDER==='1'?Array.from({length:24},(_,i)=>`第${i+1}段流式文字，用于验证连续输出时的滚动稳定性。\n`):['9月12日，','我记住了。\n','到时候，想送你一本写满祝福的书。'];
    for(const word of words){if(process.env.QA_RENDER==='1')await delay(45);if(res.destroyed)return;res.write('data: '+JSON.stringify({choices:[{delta:{content:word}}]})+'\n\n');}
    const delta=process.env.QA_TOOLS==='1'?{annotations:[{type:'url_citation',url_citation:{url:'https://example.com',title:'测试引用来源',start_index:0,end_index:10}}],server_tool_calls:[{index:0,reasoning_content:'',calls:[{index:0,id:'test-call',type:'deepseek_web_search',status:'completed',action:{type:'search',queries:['示例']},sources:[{url:'https://example.org',title:'测试查阅网页'}]}]}]}:{};
    res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  }else{
    const content=input.messages[0].content.includes('提取玩家')?JSON.stringify({memories:[{key:'birthday',title:'生日',content:'生日是9月12日',category:'个人信息',evidence:'我的生日是9月12日'}]}):'双方在书店的夜晚交谈，玩家提到了自己的生日。';
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));
  }
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
const store=createStore();
if(process.env.QA_RENDER==='1')for(const c of store.characters())for(let i=0;i<14;i++)store.addMessage(c.id,i%2?'assistant':'user',`历史对话 ${i+1}：保持原有消息、头像和滚动位置。\n这是用来检查长对话的测试内容。`);
if(process.env.QA_EMPTY==='1')store.db.exec('DELETE FROM characters');
const settings=store.settings();settings.api={...settings.api,baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,model:'local-test-only',apiKey:'test-only'};store.saveSettings(settings);
if(process.env.QA_TOOLS==='1'){settings.api={...settings.api,provider:'deepseek',model:'deepseek-flash',webSearch:true};store.saveSettings(settings);}
const app=createApp({store,loadAsset:async file=>{
  const source=await readFile(new URL('../public/'+file,import.meta.url));
  if(file==='app.js'&&process.env.QA_VOICE==='1'){
    const full=source+'\n'+await readFile(new URL('./voice-browser.js',import.meta.url),'utf8')+(process.env.QA_UI==='1'?'\n'+await readFile(new URL('./settings-browser.js',import.meta.url),'utf8'):'');
    if(process.env.QA_PHONE==='1'){
      const newline=full.indexOf('\n');
      return full.slice(0,newline)+`\nif(window===window.top){const frame=document.createElement('iframe');frame.id='phoneFrame';frame.title='375px 手机界面测试';frame.src='/';frame.style.cssText='width:375px;height:812px;border:0;display:block;margin:20px auto';document.body.replaceChildren(frame);document.body.style.cssText='overflow:auto;height:auto;min-height:860px';}else{\n`+full.slice(newline+1)+'\n}';
    }
    return full;
  }
  return file==='app.js'&&process.env.QA_RENDER==='1'?source+'\n'+await readFile(new URL('./render-browser.js',import.meta.url),'utf8'):source;
}});
// Test-only same-origin iframe for a deterministic 375px layout, independent of host browser size.
if(process.env.QA_PHONE==='1'){
  const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');
  app.server.on('request',(req,res)=>{const set=res.setHeader.bind(res);res.setHeader=(name,value)=>set(name,name==='Content-Security-Policy'?value.replace("frame-ancestors 'none'","frame-ancestors 'self'"):value);handler(req,res);});
}
const port=Number(process.env.QA_PORT||3211);
app.server.listen(port,'127.0.0.1',()=>console.log(`QA fixture only: http://127.0.0.1:${port} (temporary data, mock responses)`));
