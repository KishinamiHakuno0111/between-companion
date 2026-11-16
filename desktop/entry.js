import {createApp} from '../server.js';
import {createStore} from '../core.js';
import {getAsset} from 'node:sea';
import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createInterface} from 'node:readline';

const args=process.argv.slice(1);
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const noOpen=args.includes('--no-open');
function openBrowser(url){
  if(noOpen)return;
  execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true},error=>{if(error)console.error(`无法自动打开浏览器，请访问：${url}`);});
}
async function sameInstance(port,storageId){
  try{const response=await fetch(`http://127.0.0.1:${port}/api/desktop-instance`,{signal:AbortSignal.timeout(1500),redirect:'error'});
    if(!response.ok)return false;const value=await response.json();
    if(value.app!=='between-desktop'||value.storageId!==storageId)return false;
    return value.version==='0.2.1'?true:'outdated';
  }catch{return false;}
}
async function main(){
  if(args.includes('--version')){console.log('此间 Between 0.2.1 · Windows x64');return;}
  if(args.includes('--licenses')){console.log(getAsset('licenses/Node.txt','utf8'));return;}
  const data=resolve(option('--data-dir')||resolve(dirname(process.execPath),'data'));
  const firstPort=Number(option('--port')||process.env.PORT||3210);
  if(!Number.isSafeInteger(firstPort)||firstPort<1024||firstPort>65495)throw new Error('端口需在 1024–65495 之间。');
  const storageId=createHash('sha256').update(data.toLowerCase()).digest('hex');
  // Check before opening SQLite so a second launch does not touch the active database.
  for(let port=firstPort;port<firstPort+32;port++){
    const running=await sameInstance(port,storageId);
    if(running==='outdated')throw new Error('旧版本此间仍在运行。请关闭旧版后台窗口，再打开本程序；聊天记录会保留。');
    if(running){console.log(`此间已在运行：http://127.0.0.1:${port}`);openBrowser(`http://127.0.0.1:${port}`);return;}
  }
  await mkdir(data,{recursive:true});
  const store=createStore(resolve(data,'between.sqlite'));
  const app=createApp({store,loadAsset:file=>Buffer.from(getAsset(`public/${file}`)),runtimeInfo:{app:'between-desktop',version:'0.2.1',storageId}});
  let selected;
  for(let port=firstPort;port<firstPort+32;port++){
    try{
      await new Promise((resolve,reject)=>{
        const error=e=>{app.server.off('listening',ready);reject(e);};
        const ready=()=>{app.server.off('error',error);resolve();};
        app.server.once('error',error);app.server.once('listening',ready);app.server.listen(port,'127.0.0.1');
      });selected=port;break;
    }catch(error){
      if(error.code!=='EADDRINUSE'){store.db.close();throw error;}
      const running=await sameInstance(port,storageId);
      if(running==='outdated'){store.db.close();throw new Error('旧版本此间仍在运行，请关闭旧版后台窗口后重试。');}
      if(running){store.db.close();console.log(`此间已在运行：http://127.0.0.1:${port}`);openBrowser(`http://127.0.0.1:${port}`);return;}
    }
  }
  if(!selected){store.db.close();throw new Error('没有可用的本地端口，请关闭旧实例后重试。');}
  const url=`http://127.0.0.1:${selected}`;
  console.log(`此间 Between 0.2.1\n\n网页：${url}\n数据：${data}\n\n网页将自动打开。使用期间请保留此窗口；关闭窗口或按 Ctrl+C 退出。`);
  openBrowser(url);
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;app.close();app.server.closeAllConnections();store.db.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGBREAK',stop);
}
main().catch(error=>{
  console.error(`启动失败：${error.message}`);process.exitCode=1;
  if(process.stdin.isTTY){const prompt=createInterface({input:process.stdin,output:process.stdout});prompt.question('按回车键退出。',()=>prompt.close());}
});
