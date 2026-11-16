import { Buffer } from 'buffer';
const pending=new Map();let counter=0;
export function installNetwork(server){
  const original=globalThis.fetch.bind(globalThis);
  globalThis.__betweenNetwork=(id,event)=>{
    const job=pending.get(id);if(!job)return;
    if(event.type==='headers')job.resolve(new Response([204,205,304].includes(event.status)?null:job.stream,{status:event.status,headers:event.headers}));
    else if(event.type==='data')job.controller.enqueue(new Uint8Array(Buffer.from(event.data,'base64')));
    else if(event.type==='end'){job.controller.close();job.cleanup();}
    else if(event.type==='error'){const error=new Error(event.message||'网络请求失败');job.reject(error);job.controller.error(error);job.cleanup();}
  };
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    if(url.origin===location.origin){
      if(url.pathname.startsWith('/api/')){
        if(options.body instanceof Blob&&options.body.size>20*1024*1024)return Response.json({error:'手机版单个附件最多 20 MiB。'},{status:413});
        return server.dispatch(url,options);
      }
      return original(input,options);
    }
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('API 地址必须是 HTTP(S)。');
    if(options.signal?.aborted)throw new DOMException('已停止','AbortError');
    const id=String(++counter),headers=new Headers(options.headers);
    let body='';
    if(options.body!=null){
      const encoded=new Response(options.body);if(!headers.has('content-type')&&encoded.headers.has('content-type'))headers.set('content-type',encoded.headers.get('content-type'));
      body=Buffer.from(await encoded.arrayBuffer()).toString('base64');
    }
    return new Promise((resolve,reject)=>{
      const job={resolve,reject,cleanup(){pending.delete(id);options.signal?.removeEventListener('abort',abort);}};
      const abort=()=>{if(!pending.has(id))return;BetweenNative.cancel(id);job.cleanup();const error=new DOMException('已停止','AbortError');reject(error);job.controller.error(error);};
      job.stream=new ReadableStream({start(controller){job.controller=controller;},cancel(){abort();}});pending.set(id,job);
      options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted){abort();return;}
      try{BetweenNative.request(id,JSON.stringify({url:url.href,method:options.method||'GET',headers:Object.fromEntries(headers),body}));}catch(error){job.cleanup();reject(error);}
    });
  };
}
