const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toggle=(name,title,value,help='')=>`<label class="setting-toggle" for="${name}"><span>${title}${help?`<small>${help}</small>`:''}</span><input id="${name}" name="${name}" type="checkbox" role="switch" ${value?'checked':''}></label>`;
const number=(name,title,value,min,max)=>`<label class="field" for="${name}"><span>${title}</span><input id="${name}" name="${name}" type="number" inputmode="numeric" value="${value}" min="${min}" max="${max}" step="1" required></label>`;
export const characterProactive=enabled=>toggle('proactiveEnabled','允许 TA 主动联系',enabled,'临近的安排、久未聊天的问候，以及话题未结束时的接话。会额外调用模型。');
export function proactivePanel(p,characters){
  return `<section id="settings-proactive" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-proactive" hidden><h3>主动联系</h3>
    <fieldset class="proactive-group"><legend>允许主动联系的角色</legend>${characters.length?characters.map(c=>toggle(`proactive-character-${c.id}`,esc(c.name),c.proactiveEnabled)).join(''):'<p class="settings-note">创建角色后可以在这里开启。</p>'}</fieldset>
    <fieldset class="proactive-group"><legend>久未聊天</legend><div class="field-row">${number('idleMinHours','最短间隔（小时）',p.idleMinHours,1,168)}${number('idleMaxHours','最长间隔（小时）',p.idleMaxHours,1,168)}</div><p class="settings-note">在这个时间范围内选择一个时刻。收到主动消息后未回复，TA 会先等你。</p></fieldset>
    <fieldset class="proactive-group"><legend>接话与次数</legend>${number('continuationMinutes','热聊后停顿多久可以接话（分钟）',p.continuationMinutes,1,30)}${number('dailyLimit','每个角色每天最多主动联系（次）',p.dailyLimit,1,20)}<p class="settings-note">只接续尚未结束的话题；已经告别或准备休息时不会继续追问。</p></fieldset>
    <fieldset class="proactive-group"><legend>免打扰</legend>${toggle('quietEnabled','开启免打扰时段',p.quietEnabled)}<div class="field-row">${['quietStart','quietEnd'].map((key,i)=>`<label class="field" for="${key}"><span>${i?'结束时间':'开始时间'}</span><input id="${key}" name="${key}" type="time" value="${esc(p[key])}" required></label>`).join('')}</div><p class="settings-note">按本机时区执行，时段内不生成主动消息。</p></fieldset>
    ${toggle('proactiveNotifications','系统通知',p.notifications)}<button type="button" id="allowProactiveNotifications" class="button secondary">${globalThis.BetweenNative?'允许系统通知':'测试系统通知'}</button><p id="notificationPermissionState" class="settings-note" role="status"></p>
    <p class="settings-note">仅本地运行。电脑需保持后端开启；安卓后台可能因省电而延迟。过时的事件不会集中补发。</p></section>`;
}
export function readProactiveForm(f){return {idleMinHours:Number(f.get('idleMinHours')),idleMaxHours:Number(f.get('idleMaxHours')),continuationMinutes:Number(f.get('continuationMinutes')),dailyLimit:Number(f.get('dailyLimit')),quietEnabled:f.has('quietEnabled'),quietStart:f.get('quietStart'),quietEnd:f.get('quietEnd'),notifications:f.has('proactiveNotifications')};}
export function validateProactiveForm(selectTab){
  const panel=document.querySelector('#settings-proactive'),min=panel.querySelector('[name=idleMinHours]'),max=panel.querySelector('[name=idleMaxHours]'),start=panel.querySelector('[name=quietStart]'),end=panel.querySelector('[name=quietEnd]');
  max.setCustomValidity(Number(min.value)>Number(max.value)?'最长间隔不能小于最短间隔。':'');
  end.setCustomValidity(panel.querySelector('[name=quietEnabled]').checked&&start.value===end.value?'开始和结束时间不能相同。':'');
  const invalid=[...panel.querySelectorAll('input')].find(input=>!input.checkValidity());
  if(invalid){selectTab('proactive');invalid.setAttribute('aria-invalid','true');invalid.reportValidity();invalid.focus();throw new Error(invalid.validationMessage);}
}
export function bindProactiveSettings(api,toast){
  const panel=document.querySelector('#settings-proactive');
  panel.addEventListener('input',e=>{e.target.setCustomValidity?.('');e.target.removeAttribute('aria-invalid');document.querySelector('#modalError').hidden=true;});
  document.querySelector('#allowProactiveNotifications').onclick=async()=>{
    const status=document.querySelector('#notificationPermissionState');
    if(globalThis.BetweenNative){BetweenNative.requestNotifications();status.textContent='可在系统弹窗或通知设置中允许此间发送通知。';}
    else {try{await api('/api/proactive/test-notification',{method:'POST'});status.textContent='已发送测试通知。若未看到，请检查系统通知或勿扰设置。';}catch(e){status.textContent=e.message;}}
  };
  if(globalThis.BetweenNative)document.querySelector('#notificationPermissionState').textContent=BetweenNative.notificationsAllowed()?'系统通知已允许':'系统通知尚未允许';
}
export async function characterPlans(id,api){
  const box=document.querySelector('#characterPlans');if(!box)return;
  try{const result=await api(`/api/characters/${encodeURIComponent(id)}/proactive`);if(!box.isConnected)return;
    box.innerHTML=`<h3>待关心的安排</h3>${result.events.length?result.events.map(e=>`<div class="proactive-event"><div><strong>${esc(e.title)}</strong><small>${esc(new Date(e.due_at).toLocaleString('zh-CN'))}</small></div><button class="text-button" type="button" data-cancel-plan="${esc(e.id)}">取消</button></div>`).join(''):'<p class="settings-note">暂无安排。开启后，会从后续聊天中记录明确的未来事项。</p>'}${result.error?`<p class="form-error">${esc(result.error)}</p>`:''}`;
    box.onclick=async e=>{const button=e.target.closest('[data-cancel-plan]');if(!button)return;button.disabled=true;try{await api(`/api/characters/${encodeURIComponent(id)}/proactive/${encodeURIComponent(button.dataset.cancelPlan)}`,{method:'DELETE'});await characterPlans(id,api);}catch(error){button.disabled=false;box.querySelector('h3').textContent=error.message;}};
  }catch{box.textContent='联系计划暂时无法读取。';}
}
export function startProactiveUI({api,getState,getActive,isSending,refresh,selectCharacter,updateMessages}){
  let cursor=0,checking=false,pendingCharacter=null,lastTyping=0,lastPresence=0;
  const input=document.querySelector('#messageInput');
  async function presence(){try{await api('/api/proactive/presence',{method:'POST',body:{characterId:getActive(),visible:document.visibilityState==='visible'&&document.hasFocus(),typing:document.visibilityState==='visible'&&(Boolean(input.value.trim())||isSending()||Date.now()-lastTyping<30000)}});}catch{}}
  async function openCharacter(id){
    if(isSending()){pendingCharacter=id;return;}
    await refresh();if(!getState().characters.some(c=>c.id===id))return;
    document.querySelector('dialog[open]')?.close();
    await selectCharacter(id);document.querySelector('#app').classList.remove('memory-mode','details-open');document.querySelector('#app').classList.add('mobile-chat');
    document.querySelector('#navMemory').classList.remove('selected');document.querySelector('#navMemory').setAttribute('aria-pressed','false');document.querySelector('#navChats').classList.add('selected');document.querySelector('#navChats').setAttribute('aria-pressed','true');
    pendingCharacter=null;await presence();
  }
  window.addEventListener('between-open-character',e=>{openCharacter(e.detail).catch(()=>{});});
  const fromHash=()=>{const id=new URLSearchParams(location.hash.slice(1)).get('character');if(id)openCharacter(id).catch(()=>{});};
  window.addEventListener('hashchange',fromHash);fromHash();
  document.addEventListener('visibilitychange',()=>{presence();poll();});window.addEventListener('focus',()=>{presence();poll();});
  input.addEventListener('input',()=>{lastTyping=Date.now();if(Date.now()-lastPresence>1000){lastPresence=Date.now();presence();}});
  async function poll(){
    if(checking||isSending())return;checking=true;
    try{
      if(pendingCharacter)await openCharacter(pendingCharacter);
      const change=await api(`/api/proactive/updates?after=${cursor}`);
      if(change.characters.length){await refresh();const id=getActive();if(change.characters.includes(id)){const messages=await api(`/api/characters/${encodeURIComponent(id)}/messages`);if(id===getActive()&&!isSending())updateMessages(messages);else return;}}
      cursor=change.cursor;
    }catch{}finally{checking=false;}
  }
  presence();poll();setInterval(presence,20000);setInterval(poll,5000);
}
