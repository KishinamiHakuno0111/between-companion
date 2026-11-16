import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createStore, defaults, prepareContext, extractionInput, parseExtracted } from './core.js';
import { provider, completionUrl, listModels } from './provider.js';
import { attachmentStore } from './attachments.js';

const root=dirname(fileURLToPath(import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,max,required=false)=>{ if(typeof v!=='string' || v.length>max || (required&&!v.trim())) throw fail(`请填写有效内容（最多 ${max} 字）。`); return v.trim(); };
function avatar(v) { if(['lin','xia','shen','moon',''].includes(v)) return ''; if(typeof v==='string' && v.length<1400000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return v; throw fail('头像需为小于 1 MB 的 PNG、JPG 或 WebP 图片。'); }
function player(v) {return {name:text(v.name,40,true),persona:text(v.persona,3000),avatar:avatar(v.avatar || '')};}
async function readBody(req) {
  const chunks=[]; let total=0;
  for await (const chunk of req) {total+=chunk.length;if(total>2000000)throw fail('提交内容过大。',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString() || '{}');}catch{throw fail('请求格式错误。');}
}
function connection(a,current) {
  if(!['openai','deepseek'].includes(a.provider))throw fail('不支持的服务类型。');
  const baseUrl=text(a.baseUrl,500,true);completionUrl(baseUrl);
  if(a.provider==='deepseek'&&new URL(baseUrl).origin!=='https://api.deepseek.com')throw fail('DeepSeek 官方模式请使用 https://api.deepseek.com。');
  const same=current.provider===a.provider&&completionUrl(current.baseUrl)===completionUrl(baseUrl);
  return {provider:a.provider,baseUrl,apiKey:a.clearKey?'':a.apiKey?text(a.apiKey,1000):same?current.apiKey:''};
}

export function createApp({store=createStore(), allowTestHost=false, loadAsset=file=>readFile(resolve(root,'public',file)), runtimeInfo}={}) {
  const files=attachmentStore(store.db);
  const busy=new Set();
  const controllers=new Set();
  const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const snapshot=()=>{const settings=store.settings();return {settings:{...settings,api:{...settings.api,apiKey:undefined,hasKey:Boolean(settings.api.apiKey)}},characters:store.characters().map(c=>({...c,lastMessage:store.messages(c.id).filter(m=>m.role!=='notice').at(-1)?.content || '',memoryCount:store.memories(c.id).length}))};};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host=req.headers.host || '';
      if(!allowTestHost && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw fail('仅允许本机访问。',403);
      const url=new URL(req.url,`http://${host}`), path=url.pathname;
      if(req.headers.origin && req.headers.origin!==`http://${host}`)throw fail('不允许跨站请求。',403);
      if(path.startsWith('/api/') && req.method!=='GET' && req.headers['x-companion']!=='1')throw fail('请求来源无效。',403);
      if(path==='/api/desktop-instance' && req.method==='GET' && runtimeInfo)return json(res,runtimeInfo);
      if(path==='/api/state' && req.method==='GET')return json(res,snapshot());
      if(path==='/api/models' && req.method==='POST') {
        const body=await readBody(req);
        const api=connection(body,store.settings().api);
        // Connection checks never persist the supplied credential or modify saved settings.
        return json(res,{models:await listModels(api)});
      }
      if(path==='/api/settings' && req.method==='PUT') {
        const body=await readBody(req), current=store.settings();
        if(body.player)current.player=player(body.player);
        if(body.api) {
          const a=body.api;
          const credentials=connection(a,current.api);
          const contextTokens=Number(a.contextTokens), outputTokens=a.outputTokens==null||a.outputTokens===''?null:Number(a.outputTokens);
          if(!Number.isSafeInteger(contextTokens)||contextTokens<4096||contextTokens>10000000||outputTokens!==null&&(!Number.isSafeInteger(outputTokens)||outputTokens<1||outputTokens>=contextTokens-256))throw fail('上下文至少 4096；回复长度留空为自动，手动设置时必须小于上下文上限。');
          const models=Array.isArray(a.models)?a.models.slice(0,1000).filter(m=>typeof m.id==='string'&&m.id.length<=120).map(m=>({id:m.id,name:typeof m.name==='string'?m.name.slice(0,160):m.id,contextTokens:Number.isSafeInteger(m.contextTokens)&&m.contextTokens>0?m.contextTokens:null,maxOutputTokens:Number.isSafeInteger(m.maxOutputTokens)&&m.maxOutputTokens>0?m.maxOutputTokens:null})):[];
          const model=text(a.model,120,true), selected=models.find(m=>m.id===model);
          if(selected?.maxOutputTokens&&outputTokens>selected.maxOutputTokens)throw fail('回复长度超过所选模型的输出上限。');
          current.api={...credentials,model,contextTokens,outputTokens,models,autoMemory:Boolean(a.autoMemory)};
        }
        store.saveSettings(current);return json(res,snapshot());
      }
      if(path==='/api/test' && req.method==='POST') {
        const p=provider(store.settings().api);
        await p.complete([{role:'user',content:'Reply with OK.'}],{maxTokens:128});return json(res,{ok:true});
      }
      if(path==='/api/characters' && req.method==='POST') {
        const body=await readBody(req);
        const c={id:randomUUID(),name:text(body.name,40,true),tagline:text(body.tagline || '',100),persona:text(body.persona,5000,true),greeting:text(body.greeting || '',1500),avatar:avatar(body.avatar || ''),color:['sage','rose','blue','plum'].includes(body.color)?body.color:'plum',playerOverride:null};
        store.saveCharacter(c);if(c.greeting)store.addMessage(c.id,'assistant',c.greeting,{greeting:true});return json(res,c,201);
      }
      const match=path.match(/^\/api\/characters\/([^/]+)(?:\/(messages|memories|chat|context|attachments)(?:\/([^/]+))?)?$/);
      if(match) {
        const [,id,resource,item]=match, c=store.character(id);
        if(!c)throw fail('角色不存在。',404);
        if(req.method!=='GET' && busy.has(id))throw fail('这个角色正在回复或整理记忆，请稍后再试。',409);
        if(resource==='attachments') {
          if(req.method==='POST'&&!item)return json(res,await files.upload(id,req,url.searchParams.get('name'),store.settings().api),201);
          if(req.method==='GET'&&!item)return json(res,files.drafts(id));
          if(req.method==='GET'&&item){
            const a=files.get(id,item);if(!a)throw fail('附件不存在。',404);
            res.writeHead(200,{'Content-Type':a.mime,'Content-Length':a.size,'Content-Disposition':`${a.kind==='image'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`});return res.end(a.bytes);
          }
          if(req.method==='DELETE'&&item){files.remove(id,item);return json(res,{ok:true});}
        }
        if(!resource && req.method==='PUT') {
          const b=await readBody(req);
          const updated={...c};
          for(const [key,max] of Object.entries({name:40,tagline:100,persona:5000,greeting:1500}))if(key in b)updated[key]=text(b[key],max,['name','persona'].includes(key));
          if('avatar' in b)updated.avatar=avatar(b.avatar);
          if('playerOverride' in b)updated.playerOverride=b.playerOverride===null?null:player(b.playerOverride);
          store.saveCharacter(updated);return json(res,updated);
        }
        if(!resource && req.method==='DELETE'){store.db.prepare('DELETE FROM characters WHERE id=?').run(id);return json(res,{ok:true});}
        if(resource==='messages' && req.method==='GET')return json(res,store.messages(id));
        if(resource==='messages' && item && req.method==='DELETE'){
          const last=store.messages(id).filter(m=>m.role!=='notice').at(-1);
          if(last?.role!=='user'||last.id!==item)throw fail('只能编辑最后一条尚未完成的消息。',409);
          if(files.drafts(id).length)throw fail('请先移除输入框中尚未发送的附件，再编辑上一条消息。',409);
          store.db.exec('BEGIN');
          try{
            store.db.prepare('UPDATE attachments SET message_id=NULL WHERE character_id=? AND message_id=?').run(id,item);
            store.db.prepare('DELETE FROM messages WHERE character_id=? AND id=?').run(id,item);
            store.db.exec('COMMIT');
          }catch(error){store.db.exec('ROLLBACK');throw error;}
          return json(res,{content:last.content,attachments:files.drafts(id)});
        }
        if(resource==='context' && req.method==='GET')return json(res,{summary:store.summary(id),messageCount:store.messages(id).filter(m=>m.role!=='notice').length});
        if(resource==='memories' && req.method==='GET')return json(res,store.memories(id));
        if(resource==='memories' && req.method==='POST') {
          const b=await readBody(req);const value=store.saveMemory(id,{key:`manual_${randomUUID()}`,title:text(b.title,50,true),content:text(b.content,500,true),category:text(b.category || '其他',20),source:'manual',evidence:''});return json(res,value,201);
        }
        if(resource==='memories' && item) {
          const memory=store.db.prepare('SELECT * FROM memories WHERE id=? AND character_id=?').get(item,id);
          if(!memory)throw fail('记忆不存在。',404);
          if(req.method==='DELETE'){store.db.prepare('DELETE FROM memories WHERE id=? AND character_id=?').run(item,id);return json(res,{ok:true});}
          if(req.method==='PUT'){const b=await readBody(req);const value=store.saveMemory(id,{key:memory.key,title:text(b.title,50,true),content:text(b.content,500,true),category:text(b.category || '其他',20),source:'manual',evidence:memory.evidence});return json(res,value || memory);}
        }
        if(resource==='chat' && req.method==='POST') {
          const b=await readBody(req), settings=store.settings();
          if(!settings.api.apiKey || !settings.api.model)throw fail('先连接你的模型，再开始聊天。',422);
          // Acquire after reading request body as parallel submissions can finish at different times.
          if(busy.has(id))throw fail('这个角色正在回复，请稍后再试。',409);
          busy.add(id);
          const controller=new AbortController();controllers.add(controller);
          res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          let userMessage;
          try {
            const history=store.messages(id).filter(m=>m.role!=='notice');
            if(b.retryId) {userMessage=history.at(-1);if(userMessage?.role!=='user'||userMessage.id!==b.retryId)throw fail('只能重试最后一条尚未完成的对话。');}
            else {
              if(history.at(-1)?.role==='user')throw fail('上一条消息尚未完成，请先重试。',409);
              const attachments=files.validate(id,b.attachmentIds||[],settings.api);
              const content=text(b.content||'',12000,!attachments.length);
              userMessage=store.addMessage(id,'user',content,{attachments});
              files.bind(id,attachments.map(a=>a.id),userMessage.id);
            }
            res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});
            const emit=(type,data)=>{if(!res.destroyed)res.write(JSON.stringify({type,...data})+'\n');};
            emit('user',{message:userMessage});
            const p=provider(settings.api,controller.signal);
            const through=store.summary(id)?.through_seq||0;
            const liveHistory=await files.hydrate(id,store.messages(id).filter(m=>m.seq>through&&m.role!=='notice'),settings.api,controller.signal,message=>emit('status',{message}));
            const context=await prepareContext(store,c,settings,p.complete,data=>emit('compact',data),liveHistory);
            emit('context',context.stats);
            const result=await p.stream(context.messages,text=>emit('delta',{text}));
            const assistant=store.addMessage(id,'assistant',result.content,{finishReason:result.finishReason});
            emit('reply',{message:assistant});
            if(result.finishReason==='length')emit('warning',{message:'本条回复已达到输出上限。手动设置过回复长度时，可在 API 设置中调高或留空使用自动设置。'});
            if(settings.api.autoMemory && userMessage.content.trim() && !controller.signal.aborted) {
              emit('status',{message:'正在整理值得记住的小事…'});
              try {
                const existing=store.memories(id).slice(0,30);
                const input=extractionInput(userMessage.content,existing);
                // Avoid sending an oversized extraction request; a reply remains successful.
                const {estimateTokens}=await import('./core.js');
                if(estimateTokens(input)+1000>settings.api.contextTokens)throw new Error('本条内容过长，自动记忆已跳过；你可以手动添加。');
                const extracted=parseExtracted(await p.complete(input,{maxTokens:800}),userMessage.content);
                for(const m of extracted) {
                  const saved=store.saveMemory(id,m);
                  if(saved) {const note=store.addMessage(id,'notice',`${c.name}记住了你的${m.title}`,{memoryId:saved.id});emit('memory',{memory:saved,message:note});}
                }
              } catch(error) {if(!controller.signal.aborted)emit('warning',{message:`回复已保存；自动记忆暂未完成。${error.message}`});}
            }
            emit('done',{});res.end();
          } catch(error) {
            if(res.headersSent) {if(!res.destroyed)res.end(JSON.stringify({type:'error',message:controller.signal.aborted?'已停止生成，消息已保留，可重试。':error.message})+'\n');}
            else throw error;
          } finally {busy.delete(id);controllers.delete(controller);}
          return;
        }
      }
      if(path.startsWith('/api/'))throw fail('接口不存在。',404);
      if(req.method!=='GET')throw fail('不支持此请求。',405);
      const staticFiles={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/avatars.svg':'avatars.svg'};
      const file=staticFiles[path];if(!file)throw fail('页面不存在。',404);
      const bytes=await loadAsset(file);
      res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[extname(file)]});res.end(bytes);
    }catch(error){if(!res.headersSent)json(res,{error:error.message || '操作失败，请重试。'},error.status || 400);else res.end();}
  });
  return {server,store,close:()=>{for(const c of controllers)c.abort();server.close();}};
}

async function startLocal() {
  const data=resolve(root,'data');await mkdir(data,{recursive:true});
  const app=createApp({store:createStore(resolve(data,'between.sqlite'))});
  const port=Number(process.env.PORT || 3210);
  app.server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${app.server.address().port}`;
    console.log(`此间 Between 已启动：${url}\n数据保存在 ${data}\n按 Ctrl+C 停止。`);
    if(process.argv.includes('--open')){
      const [command,args]=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
      execFile(command,args,{windowsHide:true},error=>{if(error)console.error(`无法自动打开浏览器，请访问：${url}`);});
    }
  });
  process.on('SIGINT',()=>{app.close();process.exit(0);});
}
if(!globalThis.BETWEEN_EMBEDDED && process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))startLocal().catch(error=>{console.error(error.message);process.exitCode=1;});
