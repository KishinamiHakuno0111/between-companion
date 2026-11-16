import {hasWebTools, responseSources} from './capabilities.js';
export function completionUrl(baseUrl) {
  const url=new URL(baseUrl);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写不含账号、查询参数的 HTTP(S) API 地址。');
  const path=url.pathname.replace(/\/+$/,'');
  url.pathname=path.endsWith('/chat/completions')?path:`${path}/chat/completions`;
  return url.toString();
}

export async function* readSSE(body) {
  const decoder=new TextDecoder();
  let buffer='', data=[];
  const line = value => {
    if(value==='') { const result=data.join('\n'); data=[]; return result; }
    if(value.startsWith('data:')) data.push(value.slice(5).trimStart());
    return null;
  };
  for await (const chunk of body) {
    buffer+=decoder.decode(chunk,{stream:true});
    let index;
    while((index=buffer.indexOf('\n'))!==-1) {
      const event=line(buffer.slice(0,index).replace(/\r$/,'')); buffer=buffer.slice(index+1);
      if(event) yield event;
    }
  }
  buffer+=decoder.decode();
  if(buffer) line(buffer.replace(/\r$/,''));
  const tail=line(''); if(tail) yield tail;
}

export function modelsUrl(baseUrl) {
  const url=new URL(completionUrl(baseUrl));
  url.pathname=url.pathname.replace(/\/chat\/completions$/,'/models');
  return url.toString();
}
export async function listModels(api) {
  if(!api.apiKey)throw new Error('请填写 API Key。');
  const response=await fetch(modelsUrl(api.baseUrl),{redirect:'error',headers:{Authorization:`Bearer ${api.apiKey}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();throw new Error(`连接失败（${response.status}）：${response.status===401?'API Key 无效或已过期':response.status===404?'服务商未提供模型列表接口，可手动填写模型 ID':'请检查 API 地址、权限或网络'}。`);}
  const body=await response.json();
  if(!Array.isArray(body.data))throw new Error('服务商未返回有效模型列表，可手动填写模型 ID。');
  const positive=v=>Number.isSafeInteger(v)&&v>0?v:null;
  const models=body.data.filter(m=>typeof m.id==='string'&&m.id.length<=120).map(m=>({id:m.id,name:typeof m.name==='string'?m.name.slice(0,160):m.id,contextTokens:positive(m.context_window)||positive(m.context_length),maxOutputTokens:positive(m.max_output_tokens)}));
  if(!models.length)throw new Error('连接成功，但没有可用模型。');
  return [...new Map(models.map(m=>[m.id,m])).values()];
}

export function provider(api, signal) {
  async function request(messages, {stream=false,maxTokens=api.outputTokens}={}) {
    if(!api.apiKey || !api.model) throw new Error('请先在 API 设置中填写密钥和模型名称。');
    const model=api.models?.find(m=>m.id===api.model);
    if(maxTokens == null && api.provider==='deepseek')maxTokens=model?.maxOutputTokens || 393216;
    const wire=messages.map(({_provider,...m})=>{
      const content=Array.isArray(m.content)?m.content.map(({_estimatedTokens,...part})=>part):m.content;
      const compatible=stream && api.provider==='deepseek' && _provider?.model===api.model && _provider?.baseUrl===api.baseUrl;
      return {...m,content,...(stream&&api.provider==='deepseek'&&m.role==='assistant'?{reasoning_content:compatible?_provider.reasoning_content||'':''}:{}),...(compatible&&_provider.server_tool_calls?.length?{server_tool_calls:_provider.server_tool_calls}:{})};
    });
    const payload={model:api.model,messages:wire,stream};
    if(maxTokens != null)payload.max_tokens=maxTokens;
    // Background extraction/summary tasks should not consume their small budget on hidden reasoning.
    if(api.provider==='deepseek' && !stream)payload.thinking={type:'disabled'};
    if(api.provider==='deepseek' && stream) {
      payload.thinking={type:api.thinking===false?'disabled':'enabled'};
      if(api.thinking!==false)payload.reasoning_effort=api.thinkingEffort||'high';
      if(hasWebTools(api)) {
        const tools=[];
        if(api.webSearch)tools.push({type:'deepseek_web_search'});
        if(api.readUrl)tools.push({type:'deepseek_read_url'});
        if(tools.length)payload.tools=tools;
      }
    }
    const encoded=JSON.stringify(payload);
    if(Buffer.byteLength(encoded)>48*1024*1024)throw new Error('请求中的图片过大，请减少图片或使用 DeepSeek 官方文件上传。');
    const response=await fetch(completionUrl(api.baseUrl), {
      method:'POST', redirect:'error', signal:AbortSignal.any([signal || new AbortController().signal,AbortSignal.timeout(600000)]),
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${api.apiKey}`},
      body:encoded,
    });
    if(!response.ok) {
      await response.body?.cancel();
      const hints={401:'密钥无效或已过期',403:'没有访问该模型的权限',404:'API 地址、模型名称或远端附件不正确',429:'请求过于频繁或额度不足',400:'请检查模型是否支持附件及当前上下文上限；文档解析后的实际长度可能超过估算，请拆分大文档'};
      throw new Error(`模型服务返回 ${response.status}：${hints[response.status] || '服务暂时不可用，请稍后重试'}。`);
    }
    return response;
  }
  return {
    async complete(messages, options={}) {
      const response=await request(messages,options);
      const body=await response.json();
      const content=body.choices?.[0]?.message?.content;
      if(typeof content!=='string' || !content.trim()) throw new Error('模型没有返回正文，请检查模型是否支持文本 Chat Completions。');
      return content;
    },
    async stream(messages,onDelta,onEvent=()=>{}) {
      const response=await request(messages,{stream:true});
      let content='', reasoning='', finalReasoning='', finished=false, finishReason='', server_tool_calls=[], annotations=[], usage;
      const consume=choice=>{
        const delta=choice?.delta || choice?.message || {};
        if(typeof delta.reasoning_content==='string') {reasoning+=delta.reasoning_content;finalReasoning+=delta.reasoning_content;onEvent({type:'reasoning',text:delta.reasoning_content});}
        if(typeof delta.content==='string'){content+=delta.content;onDelta(delta.content);}
        if(Array.isArray(delta.server_tool_calls))server_tool_calls=delta.server_tool_calls;
        if(Array.isArray(delta.annotations))annotations=delta.annotations;
        const e=choice?.server_tool_event;
        if(e?.type==='step_reasoning_done')finalReasoning='';
        if(e?.type==='call_started')onEvent({type:'status',message:e.call?.action?.type==='search'?'正在搜索网页…':'正在阅读网页…'});
        if(e?.type==='call_completed' && e.call?.status==='failed')onEvent({type:'warning',message:'一项网页搜索或阅读未成功，回复可能缺少相关资料。'});
        if(choice?.finish_reason){finished=true;finishReason=choice.finish_reason;}
      };
      if(!response.headers.get('content-type')?.includes('text/event-stream')) {
        const body=await response.json();if(body.error)throw new Error('模型生成失败，请重试。');consume(body.choices?.[0]);usage=body.usage;
      } else {
        for await (const event of readSSE(response.body)) {
          if(event==='[DONE]') {finished=true; break;}
          const body=JSON.parse(event);
          if(body.error) throw new Error('模型在生成过程中返回错误，请重试。');
          consume(body.choices?.[0]);if(body.usage)usage=body.usage;
        }
        if(!finished) throw new Error('模型连接中断，回复未完成，请重试。');
      }
      if(finishReason==='content_filter')throw new Error('服务商未返回这条回复，请修改内容后重试。');
      if(!content.trim()) throw new Error('模型没有返回可显示的回复，请增加回复长度或更换模型。');
      const providerResponse={model:api.model,baseUrl:api.baseUrl,reasoning_content:finalReasoning,server_tool_calls,annotations};
      return {content, finishReason,metadata:{providerResponse,reasoning,...responseSources(providerResponse),usage}};
    },
  };
}
