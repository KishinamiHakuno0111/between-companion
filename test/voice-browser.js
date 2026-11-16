// Appended only by QA_VOICE=1. Fake audio and transcription; no microphone or external API.
const voiceQA=document.createElement('div');voiceQA.id='voiceQA';
voiceQA.innerHTML='<button id="runVoiceQA">检查录音交互</button><button id="previewVoiceQA">模拟录音预览</button><span id="voiceQAResult" role="status"></span>';
voiceQA.style.cssText='position:fixed;top:0;left:0;z-index:1000;background:#fff;padding:4px;font-size:11px;border:1px solid #77556e;max-width:100%';document.body.append(voiceQA);
const pause=ms=>new Promise(r=>setTimeout(r,ms));let voiceUploads=0,voiceStops=0,voiceFail=false;
const voiceFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(url!=='/api/transcribe')return voiceFetch(url,options);
  voiceUploads++;await pause(180);if(voiceFail)return Response.json({error:'模拟识别失败'},{status:503});return Response.json({text:'这是转写后的测试文字。'});
};
const fakeMic=async()=>({getLevel:()=>.15+.75*Math.abs(Math.sin(performance.now()/190)),stop:async()=>{voiceStops++;return new Blob([new Uint8Array(64)]);}});
$('#previewVoiceQA').onclick=()=>{if(recordingBusy)return;$('#app').classList.add('mobile-chat');toggleRecording(fakeMic);};
$('#runVoiceQA').onclick=async()=>{
  $('#runVoiceQA').disabled=true;const check=(v,m)=>{if(!v)throw new Error(m);};
  try{
    $('#app').classList.add('mobile-chat');$('#messageInput').value='原有草稿';
    const mic=$('#voiceInput'),parent=mic.parentElement;
    check(parent.classList.contains('composer-bottom')&&mic.nextElementSibling===$('#sendMessage'),'麦克风未在发送旁');
    await toggleRecording(fakeMic);await pause(180);
    check(voicePhase==='recording'&&recordingBusy&&!$('#voicePanel').hidden,'未进入录音界面');
    check(mic=== $('#voiceInput')&&mic.getAttribute('aria-label')==='停止录音','同一按钮未变成停止');
    check(getComputedStyle($('#messageInput')).display==='none','录音时没有替换输入框');
    check(voiceLevels.some(n=>n>0),'波形未随音量更新');
    check($('#sendMessage').disabled,'录音时可误发送');
    await toggleRecording();check(voicePhase==='idle'&&$('#messageInput').value.includes('原有草稿\n这是转写'),'停止后没有恢复原稿和转写');
    check(voiceFrame===null&&!$('#sendMessage').disabled,'录音动画或按钮未恢复');
    const before=voiceUploads,draft=$('#messageInput').value;await toggleRecording(fakeMic);await cancelRecording();
    check(voiceUploads===before&&$('#messageInput').value===draft,'取消时上传或修改草稿');
    let grant;const pending=toggleRecording(()=>new Promise(r=>grant=r));check(voicePhase==='requesting','缺少授权等待状态');await cancelRecording();const count=voiceStops;grant(await fakeMic());await pending;
    check(voiceStops===count+1&&voicePhase==='idle','取消后晚到的授权未释放麦克风');
    await toggleRecording(async()=>{throw new DOMException('denied','NotAllowedError');});check(!recordingBusy&&voiceFrame===null,'拒绝授权后没有恢复');
    voiceFail=true;await toggleRecording(fakeMic);await toggleRecording();voiceFail=false;check(voicePhase==='idle'&&$('#messageInput').value===draft,'转写失败丢失草稿');
    await toggleRecording(fakeMic);const transcribing=toggleRecording();await cancelRecording();await transcribing;
    check($('#messageInput').value===draft&&!recordingBusy,'取消后晚到的转写污染草稿');
    check(document.documentElement.scrollWidth<=innerWidth,'横向溢出');
    $('#voiceQAResult').textContent=`PASS · ${innerWidth}px · 录音 / 波形 / 停止 / 取消 / 权限 / 失败 / 草稿`;
  }catch(e){$('#voiceQAResult').textContent='FAIL · '+e.message;}finally{$('#runVoiceQA').disabled=false;}
};
