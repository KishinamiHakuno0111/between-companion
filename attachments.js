import { randomUUID, createHash } from 'node:crypto';
import { extname } from 'node:path';
import { completionUrl } from './provider.js';

const MiB=1024*1024;
const textExtensions=new Set(['.txt','.md','.csv','.json','.log','.yaml','.yml','.xml','.html','.css','.js','.ts','.py','.java','.c','.cpp','.h','.sql','.sh','.ini','.toml']);
const parsedExtensions=new Set(['.pdf','.doc','.docx','.ppt','.pptx','.bmp','.tif','.tiff']);
const convertedExtensions=new Set(['.xls','.xlsx','.epub','.mobi']);
const error=(message,status=400)=>Object.assign(new Error(message),{status});
export function attachmentType(name) {
  const ext=extname(name).toLowerCase();
  if(['.png','.jpg','.jpeg','.gif','.webp'].includes(ext))return {kind:'image',limit:64*MiB,purpose:'user_data'};
  if(textExtensions.has(ext))return {kind:'text',limit:32*MiB,purpose:'user_data'};
  if(parsedExtensions.has(ext))return {kind:'document',limit:100*MiB,purpose:'rich_layout_recognition'};
  if(convertedExtensions.has(ext))return {kind:'document',limit:32*MiB,purpose:'user_data'};
  throw error('不支持此文件格式。请选择图片、PDF、Office 文档或文本文件。');
}
export function checkCapability(api,kind) {
  if(api.provider==='deepseek'&&!['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(api.model))throw error('DeepSeek 图片和文件输入请选用 deepseek-flash。');
  if(api.provider!=='deepseek'&&kind==='document')throw error('通用兼容模式目前支持图片和 UTF-8 文本；PDF、Office 等文档请使用 DeepSeek 官方 Flash。');
}
function imageMime(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  throw error('图片内容不是有效的 PNG、JPEG、GIF 或 WebP。');
}
export const attachmentInfo=a=>({id:a.id,name:a.name,kind:a.kind,mime:a.mime,size:a.size});
export function attachmentStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, value TEXT NOT NULL, bytes BLOB NOT NULL); CREATE INDEX IF NOT EXISTS attachments_character ON attachments(character_id,message_id);`);
  const get=(characterId,id)=>{const row=db.prepare('SELECT * FROM attachments WHERE character_id=? AND id=?').get(characterId,id);return row?{...JSON.parse(row.value),bytes:Buffer.from(row.bytes),messageId:row.message_id}:null;};
  return {
    get,
    drafts:characterId=>db.prepare('SELECT value FROM attachments WHERE character_id=? AND message_id IS NULL').all(characterId).map(r=>attachmentInfo(JSON.parse(r.value))),
    async upload(characterId,req,name,api) {
      if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f]/.test(name))throw error('文件名无效。');
      const type=attachmentType(name);checkCapability(api,type.kind);
      if(this.drafts(characterId).length>=4)throw error('每条消息最多添加 4 个附件。');
      const limit=api.provider==='deepseek'?type.limit:Math.min(type.limit,20*MiB);
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>limit)throw error(`文件超过 ${limit/MiB} MiB 上限。`,413);chunks.push(chunk);}
      if(!size)throw error('不能上传空文件。');
      const bytes=Buffer.concat(chunks);let mime='application/octet-stream';
      if(type.kind==='image')mime=imageMime(bytes);
      if(type.kind==='text') {try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))throw Error();}catch{throw error('文本文件请使用 UTF-8 编码。');}mime='text/plain; charset=utf-8';}
      if(this.drafts(characterId).length>=4)throw error('每条消息最多添加 4 个附件。');
      const a={id:randomUUID(),name,kind:type.kind,purpose:type.purpose,mime,size};
      db.prepare('INSERT INTO attachments VALUES(?,?,NULL,?,?)').run(a.id,characterId,JSON.stringify(a),bytes);
      return attachmentInfo(a);
    },
    remove(characterId,id) {const a=get(characterId,id);if(!a)throw error('附件不存在。',404);if(a.messageId)throw error('已发送的附件不能作为草稿删除。',409);db.prepare('DELETE FROM attachments WHERE character_id=? AND id=?').run(characterId,id);},
    validate(characterId,ids,api) {
      if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length)throw error('每条消息最多 4 个不同附件。');
      return ids.map(id=>{const a=get(characterId,id);if(!a||a.messageId)throw error('附件不存在或已经发送。');checkCapability(api,a.kind);return attachmentInfo(a);});
    },
    bind(characterId,ids,messageId) {for(const id of ids)db.prepare('UPDATE attachments SET message_id=? WHERE character_id=? AND id=? AND message_id IS NULL').run(messageId,characterId,id);},
    async hydrate(characterId,history,api,signal,onStatus=()=>{}) {
      const hydrated=[];
      for(const m of history){const attachments=[];
        for(const info of m.metadata?.attachments||[]){
          const a=get(characterId,info.id);if(!a||a.messageId!==m.id)throw error('历史附件缺失，请检查本地数据库。');checkCapability(api,a.kind);
          let part;
          if(api.provider==='deepseek'){
            const endpoint=completionUrl(api.baseUrl).replace(/\/chat\/completions$/,'/files');
            const credential=createHash('sha256').update(endpoint+'\0'+api.apiKey).digest('hex');
            if(a.remote?.credential!==credential||a.remote.expiresAt<Date.now()+60000){
              onStatus(`正在上传${a.kind==='document'?'并解析':''}：${a.name}`);
              const form=new FormData();form.append('purpose',a.purpose);
              form.append('expires_after[anchor]','created_at');form.append('expires_after[seconds]','2592000');
              form.append('file',new Blob([a.bytes],{type:a.mime}),a.name);
              const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${api.apiKey}`},body:form,redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(600000)])});
              if(!response.ok){await response.body?.cancel();throw error(`附件上传或解析失败（${response.status}）：${a.name}。请检查文件格式、额度和文件大小后重试。`);}
              const uploaded=await response.json();if(typeof uploaded.id!=='string'||!uploaded.id.startsWith('file-'))throw error('服务商未返回有效文件 ID。');
              a.remote={credential,id:uploaded.id,expiresAt:uploaded.expires_at?uploaded.expires_at*1000:Date.now()+2592000000};
              const {bytes,messageId,...saved}=a;db.prepare('UPDATE attachments SET value=? WHERE character_id=? AND id=?').run(JSON.stringify(saved),characterId,a.id);
            }
            part={type:'file',file_id:a.remote.id};
          }else if(a.kind==='image')part={type:'image_url',image_url:{url:`data:${a.mime};base64,${a.bytes.toString('base64')}`}};
          else part={type:'text',text:`附件「${a.name}」内容（引用资料）：\n${a.bytes.toString('utf8')}`};
          // Parsed document size is opaque to clients. Reserve an estimate; upstream remains authoritative.
          const tokens=a.kind==='image'?(api.provider==='deepseek'?1024:8192):a.kind==='text'?a.size:Math.min(131072,Math.max(8192,a.size*2));
          attachments.push({...info,part:{...part,_estimatedTokens:tokens}});
        }
        hydrated.push({...m,metadata:{...m.metadata,attachments}});
      }
      return hydrated;
    },
  };
}
