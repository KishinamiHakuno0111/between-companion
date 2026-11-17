export function structuredError() {
  return Object.assign(new Error('模型未按主动联系所需的格式返回内容，系统会稍后重试。无需修改文件。'),{code:'MODEL_JSON_FORMAT'});
}

export function parseObject(raw,validate=()=>true) {
  let value;
  try {value=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}
  catch {throw structuredError();}
  if(!value||typeof value!=='object'||Array.isArray(value)||!validate(value))throw structuredError();
  return value;
}

// A format error gets one bounded repair attempt; authentication/network errors are not retried here.
export async function completeObject(p,messages,{maxTokens,validate,signal}={}) {
  for(let attempt=0;attempt<2;attempt++) {
    if(signal?.aborted)throw signal.reason||new Error('已停止');
    const input=attempt?messages.map((m,i)=>i===0?{...m,content:m.content+'\n上次输出格式无效。本次必须只返回一个完整 JSON 对象，不直接扮演角色，不输出说明、括号动作或 Markdown；角色台词只能放在 content 字符串里。'}:m):messages;
    try{return parseObject(await p.complete(input,{maxTokens,json:true}),validate);}
    catch(error){if(error.code!=='MODEL_JSON_FORMAT'||attempt===1||signal?.aborted)throw error;}
  }
}
