// Shared by the desktop backend and the Android runtime.
export const hasWebTools = api => api.provider==='deepseek' && api.model==='deepseek-flash';
export function currentEnvironment(timeZone, offset, now=new Date()) {
  let zone=typeof timeZone==='string'&&timeZone.length<=100?timeZone:'';
  try { if(!zone)throw new Error(); new Intl.DateTimeFormat('zh-CN',{timeZone:zone}).format(now); }
  catch { zone=Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  const format=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'long',hourCycle:'h23',timeZoneName:'longOffset'});
  return `【当前设备时间】\n${format.format(now)}\n时区：${zone}；UTC 时间：${now.toISOString()}。这是本轮真实时间；故事内的虚构时间与现实时间分开理解。`;
}
export function safeWebUrl(value) {
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function responseSources(meta={}) {
  const citations=[], consulted=[], seen=new Set();
  for(const a of meta.annotations||[]) {
    const c=a.url_citation,url=safeWebUrl(c?.url);if(a.type!=='url_citation'||!url)continue;
    citations.push({url,title:String(c.title||url).slice(0,500),start:c.start_index,end:c.end_index});seen.add(url);
  }
  for(const step of meta.server_tool_calls||[])for(const call of step.calls||[]) {
    if(call.status!=='completed')continue;
    for(const source of [...(call.sources||[]),...(call.page?[call.page]:[])]) {
      const url=safeWebUrl(source.url);if(!url||seen.has(url))continue;seen.add(url);
      consulted.push({url,title:String(source.title||url).slice(0,500)});
    }
  }
  return {citations,consulted};
}
