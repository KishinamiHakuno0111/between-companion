import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { createTestStore } from './fixtures.js';
import { prepareContext, summaryInput, estimateTokens } from '../core.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=','base64');
async function setup(t,provider='deepseek'){
  const uploads=[],requests=[];
  const mock=http.createServer(async(req,res)=>{
    let chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/files'){
      const form=await new Response(bytes,{headers:{'Content-Type':req.headers['content-type']}}).formData();
      uploads.push({keys:[...form.keys()],purpose:form.get('purpose'),name:form.get('file').name,expires:form.get('expires_after[seconds]')});
      res.end(JSON.stringify({id:`file-api-${uploads.length}`,expires_at:Math.floor(Date.now()/1000)+2592000}));return;
    }
    const input=JSON.parse(bytes);requests.push(input);
    res.end(JSON.stringify({choices:[{message:{content:'已收到附件'},finish_reason:'stop'}]}));
  });
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const store=createTestStore(),settings=store.settings();settings.api={...settings.api,provider,baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,model:'deepseek-flash',apiKey:'mock-only',autoMemory:false,contextTokens:1048576};store.saveSettings(settings);
  const app=createApp({store});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(r=>app.server.close(r));await new Promise(r=>mock.close(r));store.db.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{'X-Companion':'1','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const upload=(name,bytes,id='lin')=>fetch(`${base}/api/characters/${id}/attachments?name=${encodeURIComponent(name)}`,{method:'POST',headers:{'X-Companion':'1'},body:bytes});
  const chat=async(content,attachmentIds=[])=>{const response=await request('/api/characters/lin/chat','POST',{content,attachmentIds});assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done',JSON.stringify(events));return events;};
  return {request,upload,chat,store,uploads,requests};
}

test('DeepSeek 图片及文档上传、缓存复用、角色隔离、原件下载及仅附件消息',async t=>{
  const {request,upload,chat,uploads,requests,store}=await setup(t);
  const image=await(await upload('截图.png',png)).json();
  const doc=await(await upload('报告.pdf',Buffer.from('%PDF-1.4\ntest'))).json();
  assert.equal(uploads.length,0,'选择附件仅保存在本地');
  assert.equal((await request(`/api/characters/xia/attachments/${image.id}`)).status,404);
  assert.equal((await request('/api/characters/xia/chat','POST',{content:'偷取附件',attachmentIds:[image.id]})).status,400);
  assert.equal((await request(`/api/characters/xia/attachments/${image.id}`,'DELETE')).status,404);
  assert.deepEqual(Buffer.from(await(await request(`/api/characters/lin/attachments/${image.id}`)).arrayBuffer()),png);
  const events=await chat('',[image.id,doc.id]);
  assert.equal(events.find(e=>e.type==='user').message.content,'');
  assert.equal(uploads.length,2);assert.equal(uploads[0].purpose,'user_data');assert.equal(uploads[1].purpose,'rich_layout_recognition');
  assert.ok(uploads[1].keys.indexOf('purpose')<uploads[1].keys.indexOf('file'));assert.equal(uploads[1].expires,'2592000');
  assert.deepEqual(requests[0].messages.at(-1).content.filter(p=>p.type==='file'),[{type:'file',file_id:'file-api-1'},{type:'file',file_id:'file-api-2'}]);
  assert.ok(!JSON.stringify(requests[0]).includes('_estimatedTokens'));
  assert.equal((await(await request('/api/characters/lin/attachments')).json()).length,0);
  assert.equal((await request(`/api/characters/lin/attachments/${image.id}`,'DELETE')).status,409);
  await chat('接着说');assert.equal(uploads.length,2,'历史引用不会每轮重新上传');
  const a=store.settings();a.api.apiKey='another-mock-account';store.saveSettings(a);await chat('再次查看');assert.equal(uploads.length,4,'切换账户重新上传，不复用其他账户 file_id');
  assert.equal(store.messages('xia').filter(m=>m.role==='user').length,0);
});

test('兼容接口发送标准图片块和文本附件，校验格式、草稿及模型支持',async t=>{
  const {request,upload,chat,uploads,requests,store}=await setup(t,'openai');
  assert.equal((await upload('bad.png',Buffer.from('not-image'))).status,400);
  assert.equal((await upload('bad.txt',Buffer.from([255,0]))).status,400);
  assert.equal((await upload('报告.pdf',Buffer.from('%PDF'))).status,400);
  const removed=await(await upload('草稿.txt',Buffer.from('temporary'))).json();
  await request(`/api/characters/lin/attachments/${removed.id}`,'DELETE');assert.equal((await request(`/api/characters/lin/attachments/${removed.id}`)).status,404);
  const image=await(await upload('图.png',png)).json(), doc=await(await upload('便签.md',Buffer.from('附件独有文字'))).json();
  await chat('看看',[image.id,doc.id]);assert.equal(uploads.length,0);
  const content=requests[0].messages.at(-1).content;assert.ok(content.some(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/png;base64,')));assert.ok(content.some(p=>p.text?.includes('附件独有文字')));
  const settings=store.settings();settings.api.provider='deepseek';settings.api.model='deepseek-v4-pro';store.saveSettings(settings);assert.equal((await upload('图.png',png)).status,400);
});

test('附件参与摘要，但人设和记忆不进入压缩；游标后不重复发送附件',async()=>{
  const store=createTestStore();
  try{
    const c={...store.character('lin'),persona:'PRIVATE_ROLE'},settings=store.settings();settings.api.contextTokens=8192;settings.api.outputTokens=256;
    const history=[];
    for(let i=0;i<14;i++)history.push({seq:i+10,role:i%2?'assistant':'user',content:'原始对话'+i,metadata:i%2?{}:{attachments:[{name:'原始图片.png',part:{type:'file',file_id:`file-api-${i}`,_estimatedTokens:1024}}]}});
    const callInputs=[];
    const result=await prepareContext(store,c,settings,async input=>{callInputs.push(input);return '已讨论图片中的内容。';},()=>{},history);
    assert.ok(callInputs.length>0);assert.ok(!JSON.stringify(callInputs).includes('PRIVATE_ROLE'));
    assert.ok(callInputs.some(input=>Array.isArray(input[1].content)&&input[1].content.some(p=>p.file_id==='file-api-0')));
    assert.ok(!JSON.stringify(result.messages).includes('file-api-0'));assert.ok(estimateTokens(result.messages)<8192);
    const count=callInputs.length;await prepareContext(store,c,settings,async()=>{callInputs.push('unexpected');return '摘要';},()=>{},history);assert.equal(callInputs.length,count);
    assert.ok(estimateTokens(summaryInput(null,history.slice(0,1)))>1024);
  }finally{store.db.close();}
});

test('附件请求失败可以还原草稿并替换文件，已完成消息不能撤回为草稿',async t=>{
  const {store,request,upload,chat}=await setup(t);
  const settings=store.settings();settings.api.contextTokens=4096;store.saveSettings(settings);
  const doc=await(await upload('大文档.pdf',Buffer.from('%PDF-test'))).json();
  const response=await request('/api/characters/lin/chat','POST',{content:'分析文档',attachmentIds:[doc.id]});
  const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'error');
  const user=events.find(e=>e.type==='user').message;
  const restored=await request(`/api/characters/lin/messages/${user.id}`,'DELETE');assert.equal(restored.status,200);
  const body=await restored.json();assert.equal(body.content,'分析文档');assert.equal(body.attachments[0].id,doc.id);
  assert.equal((await request(`/api/characters/lin/attachments/${doc.id}`)).status,200);
  assert.equal((await request(`/api/characters/lin/attachments/${doc.id}`,'DELETE')).status,200);
  const completed=await chat('不用附件了');const completedUser=completed.find(e=>e.type==='user').message;
  assert.equal((await request(`/api/characters/lin/messages/${completedUser.id}`,'DELETE')).status,409);
});
