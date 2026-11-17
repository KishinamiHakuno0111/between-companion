import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../core.js';
import {createProactive,proactiveDefaults,validateProactive,quietNow} from '../proactive.js';

function fixture(t){
  const store=createStore();let clock=new Date('2026-11-17T10:00:00+08:00').getTime();
  const settings=store.settings();settings.api={...settings.api,apiKey:'mock-only',model:'mock'};settings.proactive={...proactiveDefaults,quietEnabled:false};store.saveSettings(settings);
  const c={id:'a',name:'甲',persona:'甲角色私有人设',proactiveEnabled:true};store.saveCharacter(c);store.saveCharacter({id:'b',name:'乙',persona:'乙私有秘密',proactiveEnabled:true});
  const responses=[],requests=[],notifications=[];
  let responder;
  const engine=createProactive({store,now:()=>clock,random:()=>0,makeProvider:()=>({complete:async input=>{requests.push(input);return responder?responder(input):JSON.stringify(responses.shift()||{send:true,content:'刚才的事情，想接着听你说。'});}}),onMessage:(c,m)=>notifications.push({c,m})});
  const message=(role,content,minutes=0)=>{const m=store.addMessage(c.id,role,content);store.db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(new Date(clock-minutes*60000).toISOString(),m.id);return {...m,created_at:new Date(clock-minutes*60000).toISOString()};};
  t.after(()=>{engine.stop();store.db.close();});
  return {store,c,engine,message,responses,requests,notifications,setTime:value=>clock=value,advance:ms=>clock+=ms,now:()=>clock,setResponder:fn=>responder=fn};
}

test('跨午夜免打扰、白天区间和频率校验',()=>{
  const p={...proactiveDefaults};
  assert.equal(quietNow(p,new Date(2026,10,17,23).getTime()),true);
  assert.equal(quietNow(p,new Date(2026,10,18,7).getTime()),true);
  assert.equal(quietNow(p,new Date(2026,10,18,8).getTime()),false);
  assert.equal(quietNow({...p,quietStart:'12:00',quietEnd:'14:00'},new Date(2026,10,17,13).getTime()),true);
  assert.throws(()=>validateProactive({idleMinHours:12,idleMaxHours:6}));
  assert.throws(()=>validateProactive({quietStart:'25:00'}));
  assert.throws(()=>validateProactive({quietStart:'08:00',quietEnd:'08:00'}));
});

test('热聊停顿接话一次，未回复不追加；不伪造用户，不串角色，不重复人设',async t=>{
  const f=fixture(t);f.message('user','这个故事挺有意思',5);f.message('assistant','接下来呢',4);
  const u=f.message('user','我还想说说后半段',3),a=f.message('assistant','我在听',3);
  f.responses.push({conversation:'open',events:[]});await f.engine.plan(f.c,u,a);
  assert.equal(f.engine.candidate(f.c).kind,'continuation');await f.engine.tick();
  assert.equal(f.notifications.length,1);assert.equal(f.store.messages('a').filter(m=>m.role==='user').length,2);
  const prompt=JSON.stringify(f.requests.at(-1));assert.equal(prompt.split('甲角色私有人设').length-1,1);assert.ok(!prompt.includes('乙私有秘密'));
  f.advance(12*3600000);await f.engine.tick();assert.equal(f.notifications.length,1);
});

test('结束对话压过模型open判断，6小时后可重新问候而非续聊',async t=>{
  const f=fixture(t);f.message('user','前面的话题',5);f.message('assistant','说吧',4);
  const u=f.message('user','我要去睡了，晚安',3),a=f.message('assistant','晚安',3);
  f.responses.push({conversation:'open',events:[]});await f.engine.plan(f.c,u,a);assert.equal(f.engine.candidate(f.c),null);
  f.advance(6*3600000);assert.equal(f.engine.candidate(f.c).kind,'idle');await f.engine.tick();assert.equal(f.notifications.length,1);
});

test('事件时间、逐字依据、修改取消、只发送一次',async t=>{
  const f=fixture(t),u=f.message('user','今天11点面试'),a=f.message('assistant','祝你顺利');
  f.responses.push({conversation:'neutral',events:[{key:'interview',title:'面试',eventAt:new Date(f.now()+3600000).toISOString(),remindAt:new Date(f.now()+1800000).toISOString(),evidence:u.content}]});
  await f.engine.plan(f.c,u,a);assert.equal(f.engine.events('a').length,1);assert.equal(f.engine.events('b').length,0);
  f.advance(1800000);assert.equal(f.engine.candidate(f.c).kind,'event');await f.engine.tick();await f.engine.tick();assert.equal(f.notifications.length,1);assert.equal(f.engine.events('a').length,0);
  const u2=f.message('user','面试改为今天13点'),a2=f.message('assistant','知道了');
  f.responses.push({conversation:'neutral',events:[{key:'interview',title:'面试',eventAt:new Date(f.now()+9000000).toISOString(),remindAt:new Date(f.now()+7200000).toISOString(),evidence:u2.content}]});await f.engine.plan(f.c,u2,a2);assert.equal(f.engine.events('a').length,1);
  const u3=f.message('user','面试取消了'),a3=f.message('assistant','那歇一歇');f.responses.push({conversation:'closed',events:[{key:'interview',cancelled:true,evidence:u3.content}]});await f.engine.plan(f.c,u3,a3);assert.equal(f.engine.events('a').length,0);
});

test('没有依据或不带时区的事件不保存；角色关闭不调用模型',async t=>{
  const f=fixture(t),u=f.message('user','明天也许出门'),a=f.message('assistant','好');
  f.responses.push({events:[{key:'fake',title:'约会',eventAt:'2026-11-18T12:00:00',remindAt:'2026-11-18T11:00:00',evidence:u.content},{key:'fake2',title:'电影',eventAt:'2026-11-18T12:00:00+08:00',remindAt:'2026-11-18T11:00:00+08:00',evidence:'明天看电影'}]});await f.engine.plan(f.c,u,a);assert.equal(f.engine.events('a').length,0);
  f.store.saveCharacter({...f.c,proactiveEnabled:false});f.advance(12*3600000);await f.engine.tick();assert.equal(f.requests.length,1);
});

test('生成途中用户发消息、关闭或取消事件时丢弃旧结果',async t=>{
  const f=fixture(t),u=f.message('user','今天的事'),a=f.message('assistant','好');f.responses.push({events:[]});await f.engine.plan(f.c,u,a);f.advance(6*3600000);
  f.setResponder(async()=>{f.message('user','我回来了');return JSON.stringify({send:true,content:'过期的问候'});});await f.engine.tick();assert.equal(f.notifications.length,0);assert.ok(!f.store.messages('a').some(m=>m.metadata.proactive));
});

test('数据库租约阻止两个本地运行时重复生成；重启保留已尝试状态',async t=>{
  const f=fixture(t),u=f.message('user','今天的事'),a=f.message('assistant','好');f.responses.push({events:[]});await f.engine.plan(f.c,u,a);f.advance(6*3600000);
  let release;f.setResponder(()=>new Promise(r=>release=r));const first=f.engine.tick();
  const second=createProactive({store:f.store,now:f.now,makeProvider:()=>({complete(){throw new Error('重复调用');}})});await second.tick();release(JSON.stringify({send:false,content:''}));await first;second.stop();
  assert.equal(f.engine.state('a').idleTriedSeq,u.seq);assert.equal(f.notifications.length,0);await f.engine.tick();assert.equal(f.requests.length,2);
});

test('失败退避、免打扰、输入中、每日上限及过期事件不会发消息',async t=>{
  const f=fixture(t),u=f.message('user','聊聊'),a=f.message('assistant','好');f.responses.push({events:[]});await f.engine.plan(f.c,u,a);f.advance(6*3600000);
  f.engine.touch({characterId:'a',visible:true,typing:true});await f.engine.tick();assert.equal(f.requests.length,1);
  f.advance(60000);f.setResponder(()=>{throw new Error('模型服务返回 402');});await f.engine.tick();assert.match(f.engine.state('a').lastError,/402/);await f.engine.tick();assert.equal(f.requests.length,2);
  f.store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('old','a','old','过期面试',f.now()-10800000,f.now()-10800000,'聊聊',u.seq,'pending');assert.notEqual(f.engine.candidate(f.c)?.kind,'event');
  f.engine.reset('a');assert.equal(f.engine.events('a').length,0);
});

test('每日上限与跨运行时聊天锁生效，无待办时不再唤醒手机',async t=>{
  const f=fixture(t),settings=f.store.settings();settings.proactive.dailyLimit=1;f.store.saveSettings(settings);
  const old=f.message('assistant','先前主动消息',10);f.store.db.prepare('UPDATE messages SET metadata=? WHERE id=?').run(JSON.stringify({proactive:'idle'}),old.id);
  const u=f.message('user','我看到了'),a=f.message('assistant','好');f.responses.push({events:[]});await f.engine.plan(f.c,u,a);f.advance(6*3600000);
  assert.equal(f.engine.candidate(f.c),null);assert.ok(f.engine.nextDelay()>60000);
  settings.proactive.dailyLimit=3;f.store.saveSettings(settings);assert.equal(f.engine.candidate(f.c).kind,'idle');
  f.engine.userArrived('a');assert.equal(f.engine.candidate(f.c),null);f.engine.userFinished('a');assert.equal(f.engine.candidate(f.c).kind,'idle');
  await f.engine.tick();assert.equal(f.engine.nextDelay(),0,'未回复主动消息后不继续唤醒');
});

test('跨运行时取消事件不能借另一种到期任务提交原事件',async t=>{
  const f=fixture(t),u=f.message('user','约定'),a=f.message('assistant','好');f.responses.push({events:[]});await f.engine.plan(f.c,u,a);f.advance(6*3600000);
  f.store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('cancel','a','cancel','约定',f.now()-1000,f.now()+60000,'约定',u.seq,'pending');
  f.setResponder(()=>{f.store.db.prepare("UPDATE proactive_events SET status='cancelled' WHERE id='cancel'").run();return JSON.stringify({send:true,content:'不应出现'});});
  await f.engine.tick();assert.equal(f.notifications.length,0);assert.ok(!f.store.messages('a').some(m=>m.metadata.proactive));
});

test('临近半小时内新告知的安排可立即关心，不因默认提前量而丢弃',async t=>{
  const f=fixture(t),u=f.message('user','十分钟后面试'),a=f.message('assistant','加油');
  f.responses.push({conversation:'neutral',events:[{key:'near',title:'面试',eventAt:new Date(f.now()+600000).toISOString(),remindAt:new Date(f.now()-1200000).toISOString(),evidence:u.content}]});
  await f.engine.plan(f.c,u,a);assert.equal(f.engine.events('a')[0].due_at,f.now());await f.engine.tick();assert.equal(f.notifications.length,1);
});

test('复现截图：普通猫角色台词触发一次格式修复，成功保存并通知',async t=>{
  const f=fixture(t);f.store.saveCharacter({...f.c,persona:'一只猫'});const u=f.message('user','一分钟后主动找我'),a=f.message('assistant','喵');
  f.store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('cat','a','cat','联系玩家',f.now(),f.now()+60000,u.content,u.seq,'pending');
  let count=0;f.setResponder(input=>{
    assert.equal(input.length,2);assert.equal(input.at(-1).role,'user');assert.equal(JSON.parse(input.at(-1).content).context.at(-1).role,'assistant');
    return ++count===1?'（尾巴在地上拍了一下）喵，时间到啦。':JSON.stringify({send:true,content:'（尾巴在地上拍了一下）喵，时间到啦。'});
  });
  await f.engine.tick();assert.equal(count,2);assert.equal(f.notifications.length,1);assert.equal(f.store.messages('a').at(-1).content,'（尾巴在地上拍了一下）喵，时间到啦。');assert.equal(f.engine.events('a').length,0);assert.equal(f.engine.state('a').lastError,'');
});

test('连续非法输出保留事件且不泄露原始JSON异常，短暂重试并限制调用次数',async t=>{
  const f=fixture(t),u=f.message('user','待会找我');f.message('assistant','好');
  f.store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('format','a','format','联系玩家',f.now(),f.now()+600000,u.content,u.seq,'pending');
  f.setResponder(()=>'{"send":true,"content":"未结束');
  await f.engine.tick();assert.equal(f.requests.length,2);assert.equal(f.engine.state('a').retryAt,f.now()+60000);assert.match(f.engine.state('a').lastError,/无需修改文件/);assert.ok(!f.engine.state('a').lastError.includes('未结束'));
  assert.equal(f.engine.events('a').length,1);assert.equal(f.notifications.length,0);await f.engine.tick();assert.equal(f.requests.length,2);
  f.advance(60000);await f.engine.tick();f.advance(60000);await f.engine.tick();assert.equal(f.requests.length,6);assert.equal(f.engine.state('a').retryAt,f.now()+3600000);
});

test('升级后解除旧JSON异常的一小时等待，未过期事件可重新执行',async t=>{
  const f=fixture(t),u=f.message('user','稍后联系');f.message('assistant','好');
  f.store.db.prepare('INSERT INTO proactive_state(character_id,value) VALUES(?,?)').run('a',JSON.stringify({lastError:'Unexpected token （ is not valid JSON',retryAt:f.now()+3600000}));
  f.store.db.prepare('INSERT INTO proactive_events VALUES(?,?,?,?,?,?,?,?,?)').run('legacy','a','legacy','联系',f.now(),f.now()+60000,u.content,u.seq,'pending');
  await f.engine.tick();assert.equal(f.notifications.length,1);assert.equal(f.engine.state('a').jsonRecoveryVersion,1);
});
