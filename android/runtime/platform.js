import { Buffer } from 'buffer';
export { Buffer };
export const process={argv:[],platform:'android',env:{}};
const native=()=>globalThis.BetweenNative;
const serialize=value=>JSON.stringify(value,(_key,v)=>{
  if(v instanceof Uint8Array)return {__blob:Buffer.from(v).toString('base64')};
  if(v?.type==='Buffer'&&Array.isArray(v.data))return {__blob:Buffer.from(v.data).toString('base64')};
  return v;
});
const decode=value=>JSON.parse(value,(_key,v)=>v?.__blob?Buffer.from(v.__blob,'base64'):v);
function result(value){const parsed=decode(value);if(parsed?.error)throw new Error(parsed.error);return parsed;}
export class DatabaseSync {
  constructor(){if(!native())throw new Error('请在此间 Android 应用中打开。');}
  exec(sql){return result(native().sql('exec',sql,'[]'));}
  prepare(sql){return {
    all:(...params)=>result(native().sql('all',sql,serialize(params))),
    get:(...params)=>result(native().sql('all',sql,serialize(params)))[0],
    run:(...params)=>result(native().sql('run',sql,serialize(params))),
  };}
  close(){}
}
export const randomUUID=()=>crypto.randomUUID();
export function createHash(){let text='';return {update(value){text+=value;return this;},digest(){return native().sha256(text);}};}
export const fileURLToPath=value=>new URL(value).pathname;
export const dirname=value=>value.slice(0,value.lastIndexOf('/'))||'/';
export const extname=value=>{const file=value.split('/').at(-1);const i=file.lastIndexOf('.');return i<0?'':file.slice(i);};
export const resolve=(...paths)=>'/'+paths.join('/').split('/').filter(Boolean).join('/');
export async function readFile(){throw new Error('本地资源由 Android 提供。');}
export async function mkdir(){}
export function execFile(){throw new Error('Android 不支持执行桌面命令。');}

export function createServer(handler){
  return {handler,close(){},async dispatch(url,options={}){
    const headers=new Headers(options.headers);headers.set('host','127.0.0.1');headers.delete('origin');
    const req={url:new URL(url,location.href).pathname+new URL(url,location.href).search,method:options.method||'GET',headers:Object.fromEntries(headers)};
    req[Symbol.asyncIterator]=async function*(){
      if(options.body!=null){const bytes=new Uint8Array(await new Response(options.body).arrayBuffer());for(let i=0;i<bytes.length;i+=65536)yield Buffer.from(bytes.subarray(i,i+65536));}
    };
    let output,status=200,responseHeaders={},resolveResponse,rejectResponse;
    const promise=new Promise((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
    const stream=new ReadableStream({start(controller){output=controller;},cancel(){abort();}});
    const listeners=[];
    const res={headersSent:false,writableEnded:false,destroyed:false,
      setHeader(name,value){responseHeaders[name]=value;},
      writeHead(code,extra={}){status=code;Object.assign(responseHeaders,extra);this.headersSent=true;resolveResponse(new Response(stream,{status,headers:responseHeaders}));},
      write(value){if(this.destroyed)return;if(!this.headersSent)this.writeHead(status);output.enqueue(typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value));},
      end(value){if(this.destroyed)return;if(value!=null)this.write(value);if(!this.headersSent)this.writeHead(status);this.writableEnded=true;output.close();options.signal?.removeEventListener('abort',abort);},
      on(event,callback){if(event==='close')listeners.push(callback);},
    };
    function abort(){if(res.writableEnded||res.destroyed)return;res.destroyed=true;listeners.forEach(fn=>fn());const error=new DOMException('已停止','AbortError');rejectResponse(error);try{output.error(error);}catch{}}
    if(options.signal?.aborted){abort();return promise;}
    options.signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve(handler(req,res)).catch(error=>{if(!res.headersSent)rejectResponse(error);try{output.error(error);}catch{}});
    return promise;
  }};
}
export default {createServer};
