// Reads a test credential from stdin only; never stores it or includes it in output.
import {listModels,provider} from '../provider.js';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.resume();
console.log('Ready for temporary test credential on stdin (hidden).');
let input='';
process.stdin.on('data',async chunk=>{
  input+=chunk.toString();
  if(!/[\r\n]/.test(input))return;
  process.stdin.removeAllListeners('data');process.stdin.pause();
  const api={provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:input.trim(),outputTokens:null};input='';
  try{
    api.models=await listModels(api);api.model=api.models.find(m=>m.id==='deepseek-flash')?.id||api.models[0].id;
    console.log(JSON.stringify({connected:true,models:api.models}));
    const reply=await provider(api).complete([{role:'user',content:'请只回复：连接成功。'}],{maxTokens:32});
    console.log(JSON.stringify({completion:true,reply}));
  }catch(error){console.log(JSON.stringify({connected:false,error:error.message}));process.exitCode=1;}
  finally{api.apiKey='';process.exit(process.exitCode||0);}
});
