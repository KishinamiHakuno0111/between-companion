// Appended only by preview-server.js with QA_RENDER=1. No real provider or user data.
const qaButton=document.createElement('button');
qaButton.textContent='运行渲染回归测试';qaButton.id='renderQA';
qaButton.style.cssText='position:fixed;top:3px;left:50%;transform:translateX(-50%);z-index:1000;padding:6px 12px;background:white;border:1px solid #77556e;border-radius:8px;font-size:12px';
document.body.append(qaButton);
const qaDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function qaUntil(predicate){for(let i=0;i<150;i++){if(predicate())return;await qaDelay(40);}throw new Error('等待界面状态超时');}
qaButton.onclick=async()=>{
  qaButton.disabled=true;qaButton.textContent='正在验证…';
  const check=(condition,label)=>{if(!condition)throw new Error(label);};
  try{
    await qaUntil(()=>activeId&&messages.length&&$('#messages').children.length&&!sending);
    $('#app').classList.add('mobile-chat');
    const oldRows=Array.from($('#messages').children),oldBubble=$('#messages .bubble');
    const scroll=$('#chatScroll');
    check(getComputedStyle(scroll).scrollBehavior==='auto','仍在使用平滑滚动');
    check(oldRows.filter(n=>n.matches('.message-row')).every(n=>getComputedStyle(n).animationName==='none'),'旧消息仍有入场动画');
    $('#messageInput').value='我的生日是9月12日';
    const first=send();
    await qaUntil(()=>$('#streamRow .bubble')?.textContent.includes('第2段'));
    const liveRow=$('#streamRow'),liveBubble=liveRow.querySelector('.bubble');
    check(oldRows.every(n=>n.isConnected),'发送时重建了旧消息');
    check(!$('#messageInput').disabled&&!$('#messageInput').readOnly,'发送时输入框触发失焦');
    scroll.scrollTop=0;await qaDelay(120);const readingPosition=scroll.scrollTop;
    await first;
    check(oldRows.every(n=>n.isConnected),'结束或记忆更新时重建了旧消息');
    check(oldBubble===$('#messages .bubble'),'历史气泡被替换');
    check(liveRow.isConnected&&liveRow.querySelector('.bubble')===liveBubble,'流式气泡结束时被替换');
    check(!liveRow.id&&liveRow.dataset.message,'流式气泡未变为持久化消息');
    check(Math.abs(scroll.scrollTop-readingPosition)<2,'结束时强制滚动，打断阅读');
    check(messages.some(m=>m.role==='notice'),'未覆盖记忆通知流程');
    check(liveBubble.textContent.includes('第24段'),'末尾流式内容丢失');
    // Aborting and retrying must preserve all previously completed bubbles too.
    const beforeRetry=Array.from($('#messages').children);
    $('#messageInput').value='停止与重试测试';const stopped=send();
    await qaUntil(()=>$('#streamRow .bubble')?.textContent.includes('第2段'));
    scroll.scrollTop=0;aborter.abort();await stopped;
    check(retryId&&!$('#streamRow'),'中止后未保留可重试消息');
    check(beforeRetry.every(n=>n.isConnected),'中止时重建了历史');
    await qaDelay(150);const retry=send(true);await qaUntil(()=>$('#streamRow .bubble')?.textContent.includes('第2段'));
    const retryRow=$('#streamRow');await retry;
    check(retryRow.isConnected&&!retryId,'重试结束替换了气泡或状态错误');
    check(beforeRetry.every(n=>n.isConnected),'重试时重建了历史');
    check(nearBottom(),'停留在底部时未跟随流式回复');
    const originalId=activeId,other=state.characters.find(c=>c.id!==originalId);
    if(other){await selectCharacter(other.id);check(!liveRow.isConnected,'切换角色仍留有旧消息');await selectCharacter(originalId);}
    qaButton.textContent=`PASS · ${innerWidth}px · 节点复用 / 流式 / 记忆 / 滚动 / 停止重试 / 角色切换`;
    qaButton.dataset.result='pass';
  }catch(error){qaButton.textContent='FAIL · '+error.message;qaButton.dataset.result='fail';console.error(error);}
  finally{qaButton.disabled=false;}
};
