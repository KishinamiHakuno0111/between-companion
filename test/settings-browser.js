// Test-only UI scenarios: mock speech playback, no provider calls or microphone access.
const uiQAButton=document.createElement('button');uiQAButton.id='runSettingsQA';uiQAButton.textContent='检查设置与朗读';voiceQA.append(uiQAButton);
const uiQAResult=document.createElement('span');uiQAResult.id='settingsQAResult';voiceQA.append(uiQAResult);
const uiFetch=globalThis.fetch;let speechRequests=0,speechFailure=false,players=[];
globalThis.fetch=async(url,options)=>{
  if(!String(url).includes('/speech/'))return uiFetch(url,options);
  speechRequests++;await pause(80);
  return speechFailure?Response.json({error:'模拟音频错误'},{status:503}):new Response(new Blob(['audio']),{headers:{'X-Audio-Chunks':'2'}});
};
class MockPlayer extends EventTarget{
  constructor(){super();this.paused=false;players.push(this);}
  play(){return Promise.resolve();}pause(){this.paused=true;}
  dispatchEvent(e){if(e.type==='ended')this.onended?.(e);return super.dispatchEvent(e);}
}
const mockPlayer=()=>new MockPlayer();
uiQAButton.onclick=async()=>{
  uiQAButton.disabled=true;uiQAResult.textContent='检查中…';const check=(ok,label)=>{if(!ok)throw new Error(label);};const waitFor=async(test)=>{for(let i=0;i<80;i++){if(test())return;await pause(30);}throw new Error('等待状态超时');};
  const original={...state.settings.api};
  try{
    stopSpeech();players=[];speechRequests=0;
    $('#app').classList.add('mobile-chat');
    check(!$('#toolSettings')&&!$('#stopSpeech')&&!$('#thinkingToggle'),'旧聊天设置未移除');
    $('#apiShortcut').click();check($('#modal').open&&!$('#settings-api').hidden,'API 快捷入口失效');
    const urlInput=$('[name="baseUrl"]'),draft=urlInput.value;urlInput.value='https://example.org/v1';urlInput.dispatchEvent(new Event('input',{bubbles:true}));
    $('#settings-tab-display').click();check(!$('#settings-display').hidden&&$('#settings-api').hidden,'分类切换失败');
    $('#settings-tab-api').click();check($('[name="baseUrl"]')===urlInput&&urlInput.value==='https://example.org/v1','切换分类丢失草稿');closeModal();
    $('#navSettings').click();check($('#modal').open&&$('[name="baseUrl"]').value===draft,'取消后仍保存草稿');
    $('#settings-tab-display').click();$('[name="showReasoning"]').checked=false;$('[name="messageSize"]').value='large';$('[name="sendKey"]').value='modifier';
    $('#settings-tab-chat').click();$('[name="readUrl"]').checked=false;
    $('#settings-tab-voice').click();$('[name="voice"]').value='tide';
    const apiBefore={...state.settings.api};await saveHandler(new FormData($('#modalForm')));closeModal();
    check(state.settings.api.model===apiBefore.model&&state.settings.api.hasKey===apiBefore.hasKey,'改显示设置影响 API');
    check(state.settings.api.showReasoning===false&&state.settings.api.voice==='tide'&&!state.settings.api.readUrl,'跨分类设置未保存');
    check(document.body.classList.contains('hide-reasoning')&&document.body.classList.contains('large-messages'),'显示设置未应用');
    check($('#generationStatus').textContent.includes('Ctrl'),'快捷键提示未更新');
    const reasoning=messages.find(m=>m.role==='assistant');reasoning.metadata={...reasoning.metadata,reasoning:'仅供测试的思考内容'};renderMessages();
    check(getComputedStyle($('.reasoning')).display==='none','思考未隐藏');check(state.settings.api.thinking===apiBefore.thinking,'隐藏思考关闭了模型思考');
    apiModal();$('#settings-tab-display').click();check(!$('[name="showReasoning"]').checked&&$('[name="messageSize"]').value==='large','再次打开未保留设置');closeModal();
    const noModel=state.settings.api.model;state.settings.api.model='';apiModal();$('#settings-tab-display').click();await saveHandler(new FormData($('#modalForm')));closeModal();check(state.settings.api.model===noModel,'未配置模型时无法保存显示偏好');
    $('#thinkingMode').click();check(!$('#thinkingMenu').hidden&&document.activeElement.getAttribute('role')==='menuitemradio','思考菜单没有展开或聚焦');
    $('#thinkingMenu [data-thinking="low"]').click();await waitFor(()=>!preferencesBusy);check(state.settings.api.thinkingEffort==='low'&&state.settings.api.thinking&&$('#thinkingMenu').hidden,'思考强度选择失败');
    $('#thinkingMode').click();$('#thinkingMenu [data-thinking="off"]').click();await waitFor(()=>!preferencesBusy);check(state.settings.api.thinking===false,'思考关闭失败');
    $('#thinkingMode').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check($('#thinkingMenu').hidden&&document.activeElement===$('#thinkingMode'),'Escape 没有关闭菜单并归还焦点');
    const input=$('#messageInput');input.value='';const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});input.dispatchEvent(enter);check(!enter.defaultPrevented,'换行模式拦截普通 Enter');const modified=new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true});input.dispatchEvent(modified);check(modified.defaultPrevented,'Ctrl + Enter 没有响应发送');
    const first=messages.find(m=>m.role==='assistant').id;
    const play=readReply(first,mockPlayer);check(speechMessageId===first&&document.querySelector(`[data-speak-reply="${first}"] svg circle`),'朗读没有原位变成停止图标');
    await waitFor(()=>players.length>0);const before=speechRequests;await readReply(first,mockPlayer);await play;
    check(speechRequests===before&&speechMessageId===null&&players.at(-1).paused,'再次点击没有停止或重新请求');
    const pending=readReply(first,mockPlayer);await readReply(first,mockPlayer);await pending;check(speechMessageId===null,'加载期间取消失效');
    const p=readReply(first,mockPlayer);await waitFor(()=>speech);speech.dispatchEvent(new Event('ended'));await waitFor(()=>speech&&speech!==players.at(-2));
    // Wait for the second chunk, then complete it naturally.
    await pause(110);check(speechMessageId===first,'分段之间丢失停止状态');speech?.dispatchEvent(new Event('ended'));await p;check(speechMessageId===null,'播放结束没有恢复朗读');
    speechFailure=true;await readReply(first,mockPlayer);speechFailure=false;check(speechMessageId===null,'失败后没有恢复朗读');
    const firstPending=readReply(first,mockPlayer),secondPending=readReply('qa-second',mockPlayer);await firstPending;check(speechMessageId==='qa-second','旧请求结束清除了新朗读');stopSpeech();await secondPending;
    check(document.documentElement.scrollWidth<=innerWidth,'页面横向溢出');
    uiQAResult.textContent=`PASS · ${innerWidth}px · 分类设置 / 保存 / 取消 / 思考隐藏 / 朗读切换 / 分段 / 失败`;
  }catch(e){uiQAResult.textContent='FAIL · '+e.message;}
  finally{speechFailure=false;stopSpeech();closeModal();state=await api('/api/preferences',{method:'PUT',body:{showReasoning:original.showReasoning!==false,messageSize:original.messageSize||'standard',sendKey:original.sendKey||'enter',readUrl:Boolean(original.readUrl),voice:original.voice||'stella',thinking:original.thinking!==false,thinkingEffort:original.thinkingEffort||'high'}});renderSidebar();uiQAButton.disabled=false;}
};
