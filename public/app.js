import {citedText,replyExtras,startRecording} from './chat-features.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={attach:'M21 11l-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7L10 16.4a2 2 0 0 1-2.8-2.8L15 5.8',chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z',book:'M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3l-1 2-3 1-2 4 1 2-1 2 2 4 3 1 1 2h6l1-2 3-1 2-4-1-2 1-2-2-4-3-1-1-2z',plus:'M12 5v14M5 12h14',search:'M21 21l-4.5-4.5M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15',chevron:'M9 5l7 7-7 7',back:'M15 5l-7 7 7 7',edit:'M12 20H4V12M16 3l5 5-10 10-6 1 1-6zM14 5l5 5',panel:'M3 4h18v16H3zM15 4v16',close:'M6 6l12 12M6 18L18 6',user:'M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',arrow:'M12 19V5M5 12l7-7 7 7',lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',leaf:'M20 4C11 2 3 9 7 15s14 3 13-11zM4 21l10-11',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',check:'M5 12l4 4L19 6',stop:'M6 6h12v12H6z',plug:'M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.spark}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));

const initials=name=>Array.from(String(name||'').trim())[0]||'';
const avatar=(c,size='')=>`<div class="avatar ${esc(c.color||'plum')} ${size}" aria-hidden="true">${c.avatar?.startsWith('data:')?`<img src="${esc(c.avatar)}" alt="">`:`<span class="avatar-initial">${esc(initials(c.name))}</span>`}</div>`;
let state={characters:[],settings:{api:{},player:{name:'我'}}}, activeId=null, messages=[], memories=[], detailTab='memory', sending=false, aborter=null, retryId=null, stats=null, saveHandler=null, modalBusy=false;
const drafts=new Map();
let pendingAttachments=[], uploading=false;
let toastTimer,recording=null,recordingBusy=false,recordingTimer=null,speech=null,speechController=null,speechURL=null,preferencesBusy=false;
const active=()=>state.characters.find(c=>c.id===activeId);
const effectivePlayer=()=>active()?.playerOverride ?? state.settings.player;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function api(path,{method='GET',body}={}) {
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Companion':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error || '操作失败');return data;
}
function characterPath(suffix=''){return `/api/characters/${encodeURIComponent(activeId)}${suffix}`;}
async function refresh(){state=await api('/api/state');renderSidebar();}
function renderSidebar(){
  renderTools();
  const query=$('#searchCharacters').value.trim().toLowerCase();
  $('#characterCount').textContent=state.characters.length;
  const listHTML=state.characters.filter(c=>c.name.toLowerCase().includes(query)).map(c=>`<button class="character-item ${c.id===activeId?'active':''}" data-character="${esc(c.id)}" ${sending?'aria-disabled="true"':''} ${c.id===activeId?'aria-current="true"':''}>${avatar(c)}<div class="character-copy"><div class="character-top"><strong>${esc(c.name)}</strong><small>${c.memoryCount?`${c.memoryCount} 段记忆`:''}</small></div><p>${esc(c.lastMessage || c.tagline || '暂无消息')}</p></div></button>`).join('') || '<p class="helper">暂无角色</p>';
  if($('#characterList').innerHTML!==listHTML)$('#characterList').innerHTML=listHTML;
  const ready=state.settings.api.hasKey && state.settings.api.model;
  $('#connectionLabel').textContent=ready?`${state.settings.api.provider==='deepseek'?'DeepSeek':'OpenAI 兼容'} · 已配置`:'连接你的 AI 模型';
  $('.status-dot').classList.toggle('connected',Boolean(ready));
  const p=state.settings.player;$('#navPlayer').innerHTML=p.avatar?`<img src="${esc(p.avatar)}" alt="">`:esc(initials(p.name));
}
function renderHeader(){
  const c=active();if(!c)return;
  $('#headerAvatar').innerHTML=avatar(c);$('#chatName').textContent=c.name;$('#chatTagline').textContent=c.tagline || '';
  $('#personaLabel').textContent=`以「${effectivePlayer().name}」的身份聊天${c.playerOverride?' · 专属人设':''}`;
  $('#profileCard').innerHTML=`<div class="profile-card"><div class="portrait-wrap">${avatar(c,'large')}</div><h3>${esc(c.name)}</h3><p>${esc(c.tagline)}</p></div>`;
  $('#conversationIntro').innerHTML='';
  $('#editCharacter').disabled=false;
  $('#personaShortcut').disabled=false;
  $('#contextStatus').disabled=false;
}
const timeLabel=value=>new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
function messageHTML(m){
  if(m.role==='notice')return `<div class="memory-event" data-message="${esc(m.id)}">${icon('leaf')}<button data-open-memory="1">${esc(m.content)}</button></div>`;
  const mine=m.role==='user',p=effectivePlayer(),c=active();
  return `<div class="message-row ${mine?'user':'assistant'}" data-message="${esc(m.id)}">${mine?`<div class="user-letter">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:esc(initials(p.name))}</div>`:avatar(c,'small')}<div class="message-col"><div class="message-name">${esc(mine?p.name:c.name)}</div>${m.content?`<div class="bubble">${citedText(m)}</div>`:''}${attachmentHTML(m)}${replyExtras(m)}<div class="message-time">${m.metadata?.greeting?'角色开场白 · ':''}${timeLabel(m.created_at)}</div></div></div>`;
}
function attachmentURL(a,characterId=activeId){return `/api/characters/${encodeURIComponent(characterId)}/attachments/${encodeURIComponent(a.id)}`;}
const fileSize=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;
function attachmentHTML(m){
  const list=m.metadata?.attachments||[];if(!list.length)return '';
  return `<div class="message-attachments">${list.map(a=>`<a class="message-attachment ${a.kind==='image'?'image-attachment':''}" href="${attachmentURL(a,m.character_id)}" download="${esc(a.name)}">${a.kind==='image'?`<img src="${attachmentURL(a,m.character_id)}" alt="${esc(a.name)}" loading="lazy">`:icon('attach')}<span>${esc(a.name)}<small>${fileSize(a.size)}</small></span></a>`).join('')}</div>`;
}
function renderAttachments(){
  $('#attachFile').disabled=!activeId||sending||uploading;
  $('#attachmentDrafts').hidden=!pendingAttachments.length&&!uploading;
  $('#attachmentDrafts').innerHTML=pendingAttachments.map(a=>`<div class="attachment-chip">${a.kind==='image'?`<img src="${attachmentURL(a)}" alt="">`:icon('attach')}<span title="${esc(a.name)}">${esc(a.name)}<small>${fileSize(a.size)}</small></span><button type="button" data-remove-attachment="${esc(a.id)}" aria-label="移除附件 ${esc(a.name)}" ${sending||uploading?'disabled':''}>${icon('close')}</button></div>`).join('')+(uploading?'<span class="helper">正在添加附件…</span>':pendingAttachments.length?'<small class="attachment-hint">发送时上传给模型服务商；文档解析可能计费。</small>':'');
}
async function addAttachments(fileList){
  if(!activeId||sending||uploading)return;
  const selected=Array.from(fileList);if(!selected.length)return;
  if(selected.length+pendingAttachments.length>4){toast('每条消息最多添加 4 个附件。');return;}
  const id=activeId;uploading=true;renderAttachments();
  try{
    for(const file of selected){
      const ext={ 'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp' }[file.type];
      const name=file.name||`粘贴图片-${Date.now()}${ext||'.bin'}`;
      const response=await fetch(`/api/characters/${encodeURIComponent(id)}/attachments?name=${encodeURIComponent(name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Companion':'1'},body:file});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'添加附件失败');
    }
  }catch(e){toast(e.message);}
  finally{uploading=false;if(activeId===id){try{const list=await api(`/api/characters/${encodeURIComponent(id)}/attachments`);if(activeId===id)pendingAttachments=list;}catch{toast('附件列表刷新失败');}}renderAttachments();$('#attachmentInput').value='';}
}
$('#attachFile').onclick=()=>$('#attachmentInput').click();
$('#attachmentInput').onchange=e=>addAttachments(e.target.files);
window.addEventListener('between-file-paste',e=>{if(e.detail instanceof File)addAttachments([e.detail]);});
$('#messageInput').addEventListener('paste',e=>{
  const files=Array.from(e.clipboardData?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
  if(files.length){e.preventDefault();const text=e.clipboardData.getData('text/plain');if(text){const input=$('#messageInput');input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');}addAttachments(files);}
});
$('.composer').addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
$('.composer').addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();addAttachments(e.dataTransfer.files);}});
$('#attachmentDrafts').onclick=async e=>{const b=e.target.closest('[data-remove-attachment]');if(!b||sending||uploading)return;const id=activeId;b.disabled=true;try{await api(`/api/characters/${encodeURIComponent(id)}/attachments/${encodeURIComponent(b.dataset.removeAttachment)}`,{method:'DELETE'});if(activeId===id){pendingAttachments=pendingAttachments.filter(a=>a.id!==b.dataset.removeAttachment);renderAttachments();}}catch(error){b.disabled=false;toast(error.message);}};
const messageMarkup=new WeakMap();
let renderedCharacterId=null;
const nearBottom=()=>{const box=$('#chatScroll');return box.scrollHeight-box.scrollTop-box.clientHeight<100;};
function renderMessages({bottom=false}={}){
  const list=$('#messages'),follow=bottom||nearBottom();
  if(renderedCharacterId!==activeId){list.replaceChildren();renderedCharacterId=activeId;bottom=true;}
  const existing=new Map(Array.from(list.children,n=>[n.dataset.message?'message:'+n.dataset.message:n.dataset.date,n]));
  let cursor=list.firstElementChild,lastDate='';
  const place=(key,html)=>{
    let node=existing.get(key);existing.delete(key);
    if(!node){const template=document.createElement('template');template.innerHTML=html;node=template.content.firstElementChild;}
    else if(messageMarkup.get(node)!==html){const template=document.createElement('template');template.innerHTML=html;node.replaceChildren(...template.content.firstElementChild.childNodes);}
    messageMarkup.set(node,html);
    if(node!==cursor)list.insertBefore(node,cursor);
    cursor=node.nextElementSibling;
  };
  for(const m of messages){
    const date=new Date(m.created_at).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
    if(date!==lastDate){place('date:'+date,`<div class="date-divider" data-date="${esc('date:'+date)}">${esc(date)}</div>`);lastDate=date;}
    place('message:'+m.id,messageHTML(m));
  }
  for(const node of existing.values())node.remove();
  const last=messages.filter(m=>m.role!=='notice').at(-1);retryId=last?.role==='user'?last.id:null;
  if(retryId&&!sending)showAlert('上一条消息尚未完成，可以继续生成。',true);
  if(bottom||follow)scrollBottom();
}
function scrollBottom(){const box=$('#chatScroll');box.scrollTop=box.scrollHeight;}
function showAlert(message,retry=false){const n=$('#chatAlert');n.hidden=false;n.textContent=message;if(retry){const b=document.createElement('button');b.textContent='重试回复';b.onclick=()=>send(true);n.append(b);const edit=document.createElement('button');edit.textContent='编辑后重试';edit.onclick=restoreFailedMessage;n.append(edit);}}
async function restoreFailedMessage(){
  if(sending||!retryId)return;
  const id=activeId,messageId=retryId;
  try{
    const restored=await api(`/api/characters/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,{method:'DELETE'});
    drafts.set(id,restored.content);
    const history=await api(`/api/characters/${encodeURIComponent(id)}/messages`);
    if(activeId!==id)return;
    $('#messageInput').value=restored.content;pendingAttachments=restored.attachments;retryId=null;$('#chatAlert').hidden=true;
    messages=history;renderMessages();renderAttachments();await refresh();$('#messageInput').focus();
  }catch(error){toast(error.message);}
}
function renderDetails(){
  $('#memoryCount').textContent=memories.length;
  $('#tabMemory').setAttribute('aria-selected',detailTab==='memory');$('#tabPersona').setAttribute('aria-selected',detailTab==='persona');
  const c=active();
  $('.details-heading > span').textContent=$('#app').classList.contains('memory-mode')?'记忆库'+(c?' · '+c.name:''):'角色资料';
  if(!c){$('#detailContent').innerHTML='<div class="empty-memory"><h4>暂无角色</h4><button class="button primary" id="memoryCreateCharacter">创建角色</button></div>';$('#memoryCreateCharacter').onclick=()=>characterModal();return;}
  if(detailTab==='memory'){
    $('#detailContent').innerHTML=`${memories.length?memories.map(m=>`<article class="memory-card"><div class="memory-card-top">${icon(m.category==='约定'?'clock':m.category==='喜好'?'heart':'leaf')}<strong>${esc(m.title)}</strong></div><p>${esc(m.content)}</p><div class="memory-meta"><span>${m.source==='auto'?'从对话中记住':'手动添加'} · ${esc(m.category)}</span><div class="memory-actions"><button data-edit-memory="${esc(m.id)}" aria-label="编辑${esc(m.title)}" title="编辑记忆">${icon('edit')}</button><button data-delete-memory="${esc(m.id)}" aria-label="删除${esc(m.title)}" title="删除记忆">${icon('trash')}</button></div></div></article>`).join(''):`<div class="empty-memory">${icon('book')}<h4>暂无记忆</h4></div>`}<button class="add-memory" id="addMemory">${icon('plus')}添加记忆</button>`;
    $('#addMemory').onclick=()=>memoryModal();
  }else{
    const p=effectivePlayer();
    $('#detailContent').innerHTML=`<div class="persona-card"><small>${c.playerOverride?'仅在这段对话生效':'正在使用全局人设'}</small><h4>${esc(p.name)}</h4><p>${esc(p.persona || '未设置人设。')}</p></div><button class="button secondary full" id="editLocalPersona">${icon('edit')}设置专属人设</button><p class="helper persona-explain">专属人设会完整覆盖全局人设。其他角色仍使用各自的人设设置。</p>`;
    $('#editLocalPersona').onclick=()=>playerModal(true);
  }
}
async function selectCharacter(id){
  if(sending||recordingBusy)return;
  stopSpeech();
  if(activeId)drafts.set(activeId,$('#messageInput').value);
  $('#messageInput').value=drafts.get(id)||'';
  activeId=id;localStorage.setItem('between.active',id);stats=null;$('#chatAlert').hidden=true;renderSidebar();renderHeader();
  const [m,mem,files]=await Promise.all([api(characterPath('/messages')),api(characterPath('/memories')),api(characterPath('/attachments'))]);
  if(activeId!==id)return;messages=m;memories=mem;pendingAttachments=files;renderAttachments();renderMessages();renderDetails();$('#messageInput').disabled=false;$('#sendMessage').disabled=false;
}
function setNavigation(memory){
  $('#app').classList.toggle('memory-mode',memory);
  $('#navMemory').classList.toggle('selected',memory);$('#navChats').classList.toggle('selected',!memory);
  $('#navMemory').setAttribute('aria-pressed',String(memory));$('#navChats').setAttribute('aria-pressed',String(!memory));
}
function showDetails(tab='memory',page=false){detailTab=tab;if(page)setNavigation(true);$('#app').classList.remove('hide-details');$('#app').classList.add('details-open');renderDetails();}
function renderEmpty(){
  activeId=null;messages=[];memories=[];$('#messages').innerHTML='';$('#headerAvatar').innerHTML='';$('#chatName').textContent='聊天';$('#chatTagline').textContent='';$('#profileCard').innerHTML='';
  $('#conversationIntro').innerHTML='<div class="no-character"><p>暂无对话</p><button class="button primary" id="emptyCreateCharacter">创建角色</button></div>';
  $('#emptyCreateCharacter').onclick=()=>characterModal();
  pendingAttachments=[];renderAttachments();
  for(const id of ['messageInput','sendMessage','attachFile','editCharacter','personaShortcut','contextStatus'])$('#'+id).disabled=true;
  if(!$('#app').classList.contains('memory-mode'))$('#app').classList.add('hide-details');renderDetails();
}
function openModal(title,content,handler,{label='保存',extra='',eyebrow=''}={}){
  $('#modalTitle').textContent=title;$('#modalEyebrow').textContent=eyebrow;$('#modalEyebrow').hidden=!eyebrow;$('#modalContent').innerHTML=content;$('#modalExtra').innerHTML=extra;$('#modalError').hidden=true;$('#saveModal').textContent=label;$('#saveModal').disabled=false;$('#cancelModal').hidden=label==='知道了';saveHandler=handler;$('#modal').showModal();
}
function closeModal(){if(!modalBusy)$('#modal').close();}
$('#closeModal').onclick=closeModal;$('#cancelModal').onclick=closeModal;
$('#modal').addEventListener('cancel',e=>{if(modalBusy)e.preventDefault();});
$('#modalForm').onsubmit=async e=>{
  e.preventDefault();if(modalBusy)return;modalBusy=true;$('#saveModal').disabled=true;$('#modalError').hidden=true;
  try{await saveHandler?.(new FormData(e.target));$('#modal').close();}catch(error){$('#modalError').textContent=error.message;$('#modalError').hidden=false;}finally{modalBusy=false;$('#saveModal').disabled=false;}
};
const field=(label,name,value='',{type='text',max=3000,required=false,help='',placeholder=''}={})=>`<label class="field"><span>${esc(label)}</span>${type==='textarea'?`<textarea name="${name}" maxlength="${max}" ${required?'required':''} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:`<input type="${type}" name="${name}" value="${esc(value)}" maxlength="${max}" ${required?'required':''} placeholder="${esc(placeholder)}" ${type==='password'?'autocomplete="new-password"':''}>`}${help?`<small>${esc(help)}</small>`:''}</label>`;

function apiModal(){
  const a=state.settings.api;
  let available=a.models || [], manual=Boolean(a.model&&!available.some(m=>m.id===a.model));
  const options=(models,chosen)=>'<option value="">'+(models.length?'请选择模型':'先连接以获取模型')+'</option>'+models.map(m=>`<option value="${esc(m.id)}" ${m.id===chosen?'selected':''}>${esc(m.name===m.id?m.id:`${m.name} · ${m.id}`)}</option>`).join('');
  openModal('API 设置',`<label class="field"><span>服务类型</span><select name="provider"><option value="openai" ${a.provider==='openai'?'selected':''}>OpenAI 兼容接口</option><option value="deepseek" ${a.provider==='deepseek'?'selected':''}>DeepSeek 官方</option></select></label>${field('API 地址','baseUrl',a.baseUrl,{required:true,max:500})}<div class="field"><label for="apiKeyInput">API Key</label><div class="key-connect"><input type="password" id="apiKeyInput" name="apiKey" maxlength="1000" autocomplete="new-password" placeholder="${a.hasKey?'已保存 · 留空保持不变':'输入 API Key'}"><button type="button" class="button secondary" id="connectApi">连接</button></div><small id="connectionResult" role="status"></small></div><div class="field"><label for="modelSelect">模型</label><select id="modelSelect" name="model" ${manual?'hidden disabled':'required'}>${options(available,a.model)}</select><input id="modelManual" name="model" maxlength="120" value="${esc(a.model)}" placeholder="模型 ID" ${manual?'required':'hidden disabled'}><button type="button" class="text-button" id="toggleModelInput">${manual?'使用下拉选择':'手动填写模型 ID'}</button></div><div class="field-row">${field('上下文上限（token）','contextTokens',a.contextTokens,{type:'number',required:true})}${field('回复上限（token）','outputTokens',a.outputTokens??'',{type:'number',placeholder:'自动：使用模型上限'})}</div><p class="helper" id="modelLimits">回复上限留空为自动，不要求模型写满。</p><label class="check-field"><input name="autoMemory" type="checkbox" ${a.autoMemory?'checked':''}><span>自动记忆<small>记忆提取与历史压缩会额外调用模型。</small></span></label>${a.hasKey?'<label class="check-field"><input type="checkbox" name="clearKey"><span>移除已保存的密钥</span></label>':''}`,async f=>{
    state=await api('/api/settings',{method:'PUT',body:{api:{...Object.fromEntries(f),models:available,contextTokens:Number(f.get('contextTokens')),outputTokens:f.get('outputTokens')===''?null:Number(f.get('outputTokens')),autoMemory:f.has('autoMemory'),clearKey:f.has('clearKey')}}});renderSidebar();renderHeader();toast('API 配置已保存');
  });
  function modelChanged(){
    const m=available.find(m=>m.id===$('#modelSelect').value);
    if(m?.contextTokens)$('[name="contextTokens"]').value=m.contextTokens;
    $('#modelLimits').textContent=$('[name="provider"]').value==='deepseek'?`模型最大输出 ${(m?.maxOutputTokens||393216).toLocaleString()} token；留空使用模型上限。`:'回复上限留空为自动，使用服务商默认设置。';
  }
  function setManual(value){manual=value;$('#modelSelect').hidden=manual;$('#modelSelect').disabled=manual;$('#modelSelect').required=!manual;$('#modelManual').hidden=!manual;$('#modelManual').disabled=!manual;$('#modelManual').required=manual;$('#toggleModelInput').textContent=manual?'使用下拉选择':'手动填写模型 ID';}
  function invalidate(){available=[];$('#modelSelect').innerHTML=options([],'');$('#connectionResult').textContent='';$('#modelManual').value='';setManual(false);}
  $('#toggleModelInput').onclick=()=>setManual(!manual);
  $('#modelSelect').onchange=modelChanged;
  $('[name="provider"]').onchange=e=>{const deep=e.target.value==='deepseek';$('[name="baseUrl"]').value=deep?'https://api.deepseek.com':'https://api.openai.com/v1';$('[name="contextTokens"]').value=deep?1048576:131072;$('[name="outputTokens"]').value='';$('#apiKeyInput').value='';invalidate();};
  $('[name="baseUrl"]').oninput=invalidate;$('#apiKeyInput').oninput=invalidate;
  $('#connectApi').onclick=async()=>{
    if(modalBusy)return;
    const f=new FormData($('#modalForm')), credentials={provider:f.get('provider'),baseUrl:f.get('baseUrl'),apiKey:f.get('apiKey')};
    modalBusy=true;$('#connectApi').disabled=true;$('#saveModal').disabled=true;$('#connectApi').textContent='连接中…';$('#modalError').hidden=true;$('#connectionResult').textContent='';
    try{
      const result=await api('/api/models',{method:'POST',body:credentials});
      const current=new FormData($('#modalForm'));
      if(Object.entries(credentials).some(([key,value])=>current.get(key)!==value)){ $('#connectionResult').textContent='配置已更改，请重新连接。';return; }
      available=result.models;
      const chosen=available.some(m=>m.id===a.model)?a.model:available.find(m=>m.id==='deepseek-flash')?.id||available[0].id;
      $('#modelSelect').innerHTML=options(available,chosen);setManual(false);modelChanged();$('#connectionResult').textContent=`已连接 · ${available.length} 个模型`;
    }catch(e){$('#modalError').textContent=e.message;$('#modalError').hidden=false;}
    finally{modalBusy=false;$('#connectApi').disabled=false;$('#saveModal').disabled=false;$('#connectApi').textContent='连接';}
  };
}
function avatarPicker(){return `<div class="field"><span>角色头像</span><div class="avatar-options"><div id="uploadPreview"></div><label class="avatar-upload">上传头像<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="text-button" id="removeAvatar" hidden>移除头像</button></div><small>可选，未上传时显示名字首字。支持 PNG、JPG、WebP，最大 1 MB。</small></div>`;}
function bindAvatar(initial){
  let selected=initial?.startsWith('data:')?initial:'', version=0;
  const preview=()=>{
    $('#uploadPreview').innerHTML=avatar({name:$('[name="name"]').value,avatar:selected});
    $('#removeAvatar').hidden=!selected;
  };
  $('[name="name"]').addEventListener('input',preview);
  $('#removeAvatar').onclick=()=>{version++;selected='';$('#avatarFile').value='';preview();};
  $('#avatarFile').onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    const current=++version;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1000000){toast('请选择小于 1 MB 的 PNG、JPG 或 WebP 图片');e.target.value='';return;}
    const reader=new FileReader();
    reader.onload=()=>{if(current!==version)return;selected=reader.result;preview();};
    reader.onerror=()=>toast('头像读取失败，请重新选择。');
    reader.readAsDataURL(file);
  };
  preview();return ()=>selected;
}
function characterModal(edit=false){
  const c=edit?active():{name:'',tagline:'',persona:'',greeting:'',avatar:''};if(!c)return;
  let getAvatar=()=>c.avatar;
  openModal(edit?'编辑角色':'创建角色',`${avatarPicker()}<div class="field-row">${field('名字','name',c.name,{required:true,max:40})}${field('一句话介绍','tagline',c.tagline,{max:100,placeholder:'可选'})}</div>${field('TA 的人设','persona',c.persona,{type:'textarea',required:true,max:5000,placeholder:'性格、背景、说话方式，以及你们的关系…',help:'每轮对话都会使用这份人设。每个角色只有一段独立聊天。'})}${field('初见时的开场白','greeting',c.greeting,{type:'textarea',max:1500,help:edit?'修改后不会替换已经发送的开场白。':'创建角色后显示在聊天中。可留空。'})}`,async f=>{
    const body={...Object.fromEntries(f),avatar:getAvatar()};
    const result=await api(edit?`/api/characters/${c.id}`:'/api/characters',{method:edit?'PUT':'POST',body});await refresh();await selectCharacter(result.id);$('#app').classList.add('mobile-chat');toast(edit?'角色设定已更新':'角色已创建');
  },{label:edit?'保存设定':'创建角色',extra:edit?'<button type="button" class="button danger" id="deleteCharacter">删除角色</button>':''});
  getAvatar=bindAvatar(c.avatar);
  if(edit)$('#deleteCharacter').onclick=()=>{closeModal();confirmModal('删除角色？',`「${c.name}」的人设、全部聊天、记忆和摘要都会永久删除。`,async()=>{await api(`/api/characters/${c.id}`,{method:'DELETE'});await refresh();if(state.characters.length)await selectCharacter(state.characters[0].id);else renderEmpty();toast('角色已删除');});};
}
function playerModal(local=false){
  const c=active();if(local&&!c)return;const id=c?.id;const p=local?(c.playerOverride??state.settings.player):state.settings.player;
  openModal(local?'专属玩家人设':'全局玩家人设',`<p class="form-note">${local?'这份人设只在当前对话生效，完整覆盖全局人设；不会与全局人设重复叠加。':'所有对话默认使用此人设。'}</p>${local?`<label class="check-field"><input type="checkbox" name="useGlobal" ${c.playerOverride?'':'checked'}><span>沿用全局人设<small>关闭后使用下方专属人设。</small></span></label>`:''}${field('希望被怎样称呼','name',p.name,{required:true,max:40})}${field('你的人设','persona',p.persona,{type:'textarea',max:3000,placeholder:'可以写性格、生活背景，以及你希望怎样相处…'})}`,async f=>{
    const value={name:f.get('name'),persona:f.get('persona'),avatar:p.avatar||''};
    if(local)await api(`/api/characters/${id}`,{method:'PUT',body:{playerOverride:f.has('useGlobal')?null:value}});
    else await api('/api/settings',{method:'PUT',body:{player:value}});
    await refresh();renderHeader();renderDetails();renderMessages();toast('人设已保存');
  });
  if(local){const update=()=>{const checked=$('[name="useGlobal"]').checked;['name','persona'].forEach(name=>$(`[name="${name}"]`).disabled=checked);};$('[name="useGlobal"]').onchange=update;update();}
}
function memoryModal(memory){
  const id=activeId;if(!id)return;
  openModal(memory?'编辑记忆':'添加记忆',`${field('记忆标题','title',memory?.title || '',{required:true,max:50,placeholder:'例如：生日'})}<label class="field"><span>分类</span><select name="category">${['个人信息','喜好','约定','其他'].map(s=>`<option ${memory?.category===s?'selected':''}>${s}</option>`).join('')}</select></label>${field('想让 TA 记住什么','content',memory?.content || '',{type:'textarea',required:true,max:500,placeholder:'例如：我的生日是 9 月 12 日。'})}`,async f=>{
    await api(`/api/characters/${id}/memories${memory?`/${memory.id}`:''}`,{method:memory?'PUT':'POST',body:Object.fromEntries(f)});memories=await api(`/api/characters/${id}/memories`);await refresh();renderDetails();toast('记忆已保存');
  });
}
function confirmModal(title,description,handler){openModal(title,`<p class="form-note">${esc(description)}</p>`,handler,{label:'确认删除'});}
async function contextModal(){
  if(!activeId)return;const data=await api(characterPath('/context'));
  openModal('上下文管理',`<div class="context-stat"><div><strong>${data.messageCount}</strong><small>保留的原始对话消息</small></div><div><strong>${stats?.estimatedTokens?.toLocaleString() || '—'}</strong><small>最近请求的保守估算 token</small></div></div><p class="form-note">每轮只注入一次角色人设、有效玩家人设和召回记忆。接近上下文预算时，较早对话会合并成摘要，最近对话保留原文；摘要已覆盖的原文不会重复发送。<br><br>摘要仅使用真实对话及上一版摘要，不读取人设或记忆库。文本按 UTF-8 字节数估算，图片及文档另行预留预算；文档解析后的长度可能超过估算，实际以服务商为准。</p><label class="field"><span>当前历史摘要</span><div class="summary-content">${esc(data.summary?.content || '暂无历史摘要。')}</div></label>`,()=>{},{label:'知道了',eyebrow:'BETWEEN · 上下文管理'});
}
async function send(retry=false){
  if(sending||recordingBusy||!activeId)return;
  if(uploading){toast('附件正在添加，请稍候。');return;}
  if(!state.settings.api.hasKey||!state.settings.api.model){apiModal();return;}
  if(retryId&&!retry){showAlert('请先完成上一条消息，再开始新的对话。',true);return;}
  const draft=$('#messageInput').value,content=draft.trim();const attachmentIds=pendingAttachments.map(a=>a.id);if(!retry&&!content&&!attachmentIds.length)return;
  sending=true;aborter=new AbortController();$('#sendMessage').innerHTML=icon('stop');$('#sendMessage').setAttribute('aria-label','停止生成');$('#chatAlert').hidden=true;$('#generationStatus').textContent='正在准备这段对话…';renderSidebar();renderAttachments();
  const id=activeId;let buffer='',streamText='',streamBubble=null,gotReply=false,gotDone=false,streamFrame=null;
  const paintStream=()=>{streamFrame=null;const follow=nearBottom();if(streamBubble&&streamBubble.textContent!==streamText)streamBubble.textContent=streamText;if(follow)scrollBottom();};
  const flushStream=()=>{if(streamFrame!==null){cancelAnimationFrame(streamFrame);paintStream();}};
  const event=event=>{
    if(event.type==='user'){
      if(!messages.some(m=>m.id===event.message.id))messages.push(event.message);retryId=event.message.id;if(!retry&&$('#messageInput').value===draft)$('#messageInput').value='';if(!retry){pendingAttachments=[];renderAttachments();}renderMessages({bottom:true});
      const row=document.createElement('div');row.id='streamRow';row.className='message-row assistant';row.innerHTML=`${avatar(active(),'small')}<div class="message-col"><div class="message-name">${esc(active().name)}</div><div class="bubble"><span class="typing" aria-label="正在输入"><i></i><i></i><i></i></span></div></div>`;$('#messages').append(row);streamBubble=row.querySelector('.bubble');scrollBottom();
    }
    if(event.type==='compact')$('#generationStatus').textContent=event.phase==='start'?'正在把较早的对话整理成摘要…':'压缩完成，正在回复…';
    if(event.type==='context'){stats=event;$('#generationStatus').textContent=`${active().name}正在回复…`;}
    if(event.type==='reasoning'){const row=$('#streamRow');if(row){let box=row.querySelector('.reasoning');if(!box){box=document.createElement('details');box.className='reasoning';box.innerHTML='<summary>思考过程</summary><div></div>';row.querySelector('.message-col').prepend(box);}box.querySelector('div').textContent+=event.text;}$('#generationStatus').textContent='正在思考…';}
    if(event.type==='delta'){streamText+=event.text;if(streamFrame===null)streamFrame=requestAnimationFrame(paintStream);}
    if(event.type==='reply'){
      flushStream();const follow=nearBottom();gotReply=true;retryId=null;messages.push(event.message);
      // Promote the live bubble to the saved message without removing it or its text.
      const row=$('#streamRow');
      if(row){row.removeAttribute('id');row.dataset.message=event.message.id;if(streamBubble.textContent!==event.message.content)streamBubble.textContent=event.message.content;row.querySelector('.reasoning')?.remove();if(event.message.metadata?.citations?.length)streamBubble.innerHTML=citedText(event.message);row.querySelector('.message-col').insertAdjacentHTML('beforeend',replyExtras(event.message));const time=document.createElement('div');time.className='message-time';time.textContent=timeLabel(event.message.created_at);row.querySelector('.message-col').append(time);messageMarkup.set(row,messageHTML(event.message));}
      else renderMessages();
      streamBubble=null;if(follow)scrollBottom();
    }
    if(event.type==='status')$('#generationStatus').textContent=event.message;
    if(event.type==='memory'){memories=memories.filter(m=>m.id!==event.memory.id);memories.unshift(event.memory);messages.push(event.message);renderDetails();renderMessages();}
    if(event.type==='warning')showAlert(event.message);
    if(event.type==='error')throw new Error(event.message);
    if(event.type==='done')gotDone=true;
  };
  try {
    const response=await fetch(`/api/characters/${id}/chat`,{method:'POST',headers:{'Content-Type':'application/json','X-Companion':'1'},body:JSON.stringify({...retry?{retryId}:{content,attachmentIds},timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),signal:aborter.signal});
    if(!response.ok){const data=await response.json();throw new Error(data.error);}
    const reader=response.body.getReader(),decoder=new TextDecoder();
    while(true){const {value,done}=await reader.read();if(done){buffer+=decoder.decode();break;}buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())event(JSON.parse(line));}}
    if(buffer.trim())event(JSON.parse(buffer));if(!gotDone)throw new Error('连接已中断。');
  } catch(e){flushStream();$('#streamRow')?.remove();streamBubble=null;showAlert(e.name==='AbortError'?(gotReply?'回复已保存，已停止后续整理。':'已停止生成，消息已保留。'):e.message,!gotReply&&Boolean(retryId));}
  finally{
    flushStream();
    try{await refresh();messages=await api(`/api/characters/${id}/messages`);memories=await api(`/api/characters/${id}/memories`);renderMessages();renderDetails();}catch{toast('同步失败，请检查本地服务是否还在运行。');}
    sending=false;aborter=null;$('#sendMessage').innerHTML=icon('arrow');$('#sendMessage').setAttribute('aria-label','发送消息');$('#generationStatus').textContent='Enter 发送 · Shift + Enter 换行';renderSidebar();renderAttachments();
    if(matchMedia('(pointer:fine)').matches)$('#messageInput').focus({preventScroll:true});
  }
}

$('#characterList').onclick=e=>{const b=e.target.closest('[data-character]');if(b){selectCharacter(b.dataset.character).catch(e=>toast(e.message));$('#app').classList.add('mobile-chat');}};
$('#searchCharacters').oninput=renderSidebar;
$('#newCharacter').onclick=$('#addCompanion').onclick=()=>characterModal();
$('#editCharacter').onclick=()=>characterModal(true);
$('#navPlayer').onclick=()=>playerModal();$('#personaShortcut').onclick=()=>playerModal(true);
$('#navSettings').onclick=$('#connectionStatus').onclick=apiModal;
$('#navMemory').onclick=()=>showDetails('memory',true);$('#toggleDetails').onclick=()=>showDetails(detailTab);
$('#closeDetails').onclick=()=>{setNavigation(false);$('#app').classList.remove('details-open');$('#app').classList.add('hide-details');};
$('#tabMemory').onclick=()=>{detailTab='memory';renderDetails();};$('#tabPersona').onclick=()=>{detailTab='persona';renderDetails();};
$('#navChats').onclick=$('#backToList').onclick=()=>{setNavigation(false);$('#app').classList.remove('mobile-chat','details-open');if(!active())$('#app').classList.add('hide-details');};
$('#messages').onclick=e=>{if(e.target.closest('[data-open-memory]'))showDetails();const copy=e.target.closest('[data-copy-reply]'),speak=e.target.closest('[data-speak-reply]');if(copy)navigator.clipboard.writeText(messages.find(m=>m.id===copy.dataset.copyReply)?.content||'').then(()=>toast('已复制'),()=>toast('复制失败，请长按文字复制'));if(speak)readReply(speak.dataset.speakReply);};
$('#detailContent').onclick=e=>{const edit=e.target.closest('[data-edit-memory]'),del=e.target.closest('[data-delete-memory]');if(edit)memoryModal(memories.find(m=>m.id===edit.dataset.editMemory));if(del){const id=activeId,m=memories.find(m=>m.id===del.dataset.deleteMemory);confirmModal('删除这段记忆？',`「${m.title}」将从记忆库删除。历史对话及其摘要仍会保留。`,async()=>{await api(`/api/characters/${id}/memories/${m.id}`,{method:'DELETE'});memories=await api(`/api/characters/${id}/memories`);await refresh();renderDetails();toast('记忆已删除');});}};
$('#contextStatus').onclick=()=>contextModal().catch(e=>toast(e.message));
$('#sendMessage').onclick=()=>sending?aborter?.abort():send();
$('#messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}};
function initTools(){
  const bar=document.createElement('div');bar.className='chat-tools';bar.id='chatTools';
  bar.innerHTML='<button type="button" id="webToggle" aria-pressed="false">联网搜索</button><button type="button" id="thinkingToggle" aria-pressed="false">深度思考</button><button type="button" id="voiceInput">语音输入</button><button type="button" id="toolSettings" aria-label="聊天工具设置">工具设置</button><button type="button" id="stopSpeech" hidden>停止朗读</button>';
  $('.composer').prepend(bar);
  $('#webToggle').onclick=()=>savePreference({webSearch:!state.settings.api.webSearch});
  $('#thinkingToggle').onclick=()=>savePreference({thinking:state.settings.api.thinking===false});
  $('#toolSettings').onclick=()=>{
    const a=state.settings.api;
    openModal('聊天工具',`<label class="check-field"><input name="readUrl" type="checkbox" ${a.readUrl?'checked':''}><span>阅读消息中的链接</span></label><label class="field"><span>思考强度</span><select name="thinkingEffort">${[['low','轻度'],['high','标准'],['max','深入']].map(([v,t])=>`<option value="${v}" ${a.thinkingEffort===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span>朗读音色</span><select name="voice"><option value="stella" ${a.voice!=='tide'?'selected':''}>海星 · 女声</option><option value="tide" ${a.voice==='tide'?'selected':''}>暗潮 · 男声</option></select></label><p class="helper">联网与阅读链接需使用 DeepSeek 官方 deepseek-flash。搜索、网页阅读和语音按服务商用量计费。录音会上传 DeepSeek 转成文字，检查后再发送。</p>`,async f=>{state=await api('/api/preferences',{method:'PUT',body:{readUrl:f.has('readUrl'),thinkingEffort:f.get('thinkingEffort'),voice:f.get('voice')}});renderTools();});
  };
  $('#voiceInput').onclick=toggleRecording;$('#stopSpeech').onclick=stopSpeech;
  window.addEventListener('pagehide',()=>{recording?.stop();stopSpeech();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording)toggleRecording();});
}
function renderTools(){
  if(!$('#chatTools'))return;const a=state.settings.api,deep=a.provider==='deepseek',web=deep&&a.model==='deepseek-flash';
  $('#webToggle').setAttribute('aria-pressed',String(web&&Boolean(a.webSearch)));$('#thinkingToggle').setAttribute('aria-pressed',String(deep&&a.thinking!==false));
  $('#webToggle').disabled=!web||sending||preferencesBusy;$('#webToggle').title=web?'搜索与抓取按服务商用量计费':'联网搜索需要 DeepSeek 官方 deepseek-flash';
  $('#thinkingToggle').disabled=!deep||sending||preferencesBusy;
  $('#voiceInput').disabled=!deep||!a.hasKey||sending||recordingBusy&&!recording;$('#toolSettings').disabled=!deep||sending||recordingBusy;
  document.body.classList.toggle('speech-available',deep&&Boolean(a.hasKey));
}
async function savePreference(value){
  if(preferencesBusy||sending)return;preferencesBusy=true;renderTools();
  try{state=await api('/api/preferences',{method:'PUT',body:value});}catch(e){toast(e.message);}finally{preferencesBusy=false;renderTools();}
}
async function toggleRecording(){
  if(recording){
    const take=recording;recording=null;clearTimeout(recordingTimer);$('#voiceInput').textContent='正在转文字…';renderTools();
    try{
      const blob=await take.stop();if(!blob)return;
      const response=await fetch('/api/transcribe',{method:'POST',headers:{'X-Companion':'1','Content-Type':'audio/wav'},body:blob});const data=await response.json();if(!response.ok)throw new Error(data.error);
      const input=$('#messageInput'),value=(input.value?input.value+'\n':'')+data.text;
      if(value.length>12000){openModal('语音转写结果',field('输入框内容过长，请复制需要的部分','transcription',data.text,{type:'textarea',max:12000}),()=>{},{label:'知道了'});return;}
      input.value=value;input.focus();toast('已转成文字，检查后点击发送');
    }catch(e){toast(e.message);}finally{recordingBusy=false;$('#voiceInput').textContent='语音输入';renderTools();}
    return;
  }
  if(recordingBusy||sending)return;if(!activeId){toast('请先选择一个角色');return;}
  recordingBusy=true;renderTools();stopSpeech();
  try{recording=await startRecording();$('#voiceInput').textContent='结束录音';toast('正在录音，点击结束后转文字（最长 120 秒）');recordingTimer=setTimeout(()=>toggleRecording(),119000);}
  catch(e){recordingBusy=false;toast(e.name==='NotAllowedError'?'未获得麦克风权限，请在系统或浏览器设置中允许录音。':e.message);}renderTools();
}
function stopSpeech(){speechController?.abort();speechController=null;if(speech){speech.pause();speech.dispatchEvent(new Event('ended'));speech=null;}if(speechURL){URL.revokeObjectURL(speechURL);speechURL=null;}if($('#stopSpeech'))$('#stopSpeech').hidden=true;}
async function readReply(messageId){
  stopSpeech();const controller=new AbortController();speechController=controller;$('#stopSpeech').hidden=false;
  const id=activeId;
  try{
    for(let index=0,total=1;index<total;index++){
      const response=await fetch(`/api/characters/${encodeURIComponent(id)}/speech/${encodeURIComponent(messageId)}`,{method:'POST',headers:{'Content-Type':'application/json','X-Companion':'1'},body:JSON.stringify({index}),signal:controller.signal});
      if(!response.ok)throw new Error((await response.json()).error);total=Number(response.headers.get('X-Audio-Chunks'))||1;
      const blob=await response.blob();if(controller.signal.aborted)return;
      speechURL=URL.createObjectURL(blob);speech=new Audio(speechURL);const player=speech;
      await new Promise((resolve,reject)=>{player.onended=resolve;player.onerror=()=>reject(new Error('音频播放失败，请重试。'));player.play().catch(reject);});
      if(controller.signal.aborted)return;URL.revokeObjectURL(speechURL);speechURL=null;speech=null;
    }
  }catch(e){if(e.name!=='AbortError')toast(e.message);}finally{if(speechController===controller)stopSpeech();}
}
async function boot(){try{await refresh();const saved=localStorage.getItem('between.active');const id=state.characters.some(c=>c.id===saved)?saved:state.characters[0]?.id;if(id)await selectCharacter(id);else renderEmpty();}catch(e){showAlert(`无法连接本地服务：${e.message}`);}}
initTools();
boot();
