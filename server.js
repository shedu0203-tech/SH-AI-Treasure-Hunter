const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=__dirname, PORT=process.env.PORT||3000, FILE=process.env.DATA_FILE||path.join(root,'treasure-data.json');
const missions=JSON.parse(fs.readFileSync(path.join(root,'missions.json'),'utf8'));
let db={teams:{},places:missions.map(m=>m.place),open:true};
try{db={...db,...JSON.parse(fs.readFileSync(FILE,'utf8'))}}catch{}
const save=()=>{fs.mkdirSync(path.dirname(FILE),{recursive:true});const temp=FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify(db));fs.renameSync(temp,FILE)};
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const read=async req=>{let s='';for await(const c of req){s+=c;if(s.length>20000)throw Error('요청이 너무 큽니다')}return s?JSON.parse(s):{}};
const auth=req=>{const pin=process.env.ADMIN_PIN;if(!pin)return false;const a=Buffer.from(String(req.headers['x-admin-pin']||'')),b=Buffer.from(pin);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const token=req=>String(req.headers['x-team-token']||'');
const team=req=>Object.entries(db.teams).find(([id,t])=>t.token===token(req));
const publicTeam=(id,t)=>({id,name:t.name,done:t.done,pending:t.pending,score:t.done.filter(Boolean).length*100,updated:t.updated});
const summary=()=>Array.from({length:40},(_,i)=>{let id=String(i+1),t=db.teams[id];return t?publicTeam(id,t):{id,name:'',done:Array(8).fill(false),pending:[],score:0}});
http.createServer(async(req,res)=>{try{
const u=new URL(req.url,'http://localhost');
if(u.pathname==='/api/config'&&req.method==='GET')return send(res,200,{missions:missions.map((m,i)=>({id:i+1,title:m.title,place:db.places[i],description:m.description,type:m.type})),open:db.open});
if(u.pathname==='/api/join'&&req.method==='POST'){const b=await read(req),id=String(Number(b.team));if(!/^(?:[1-9]|[1-3][0-9]|40)$/.test(id))return send(res,400,{error:'1~40팀만 가능합니다'});if(db.teams[id])return send(res,409,{error:'이미 등록된 팀입니다. 기존 휴대폰으로 접속하거나 관리자에게 초기화를 요청하세요.'});const t={name:String(b.name||id+'팀').slice(0,25),token:crypto.randomBytes(24).toString('hex'),done:Array(8).fill(false),pending:[],updated:Date.now()};db.teams[id]=t;save();return send(res,200,{token:t.token,team:publicTeam(id,t)})}
if(u.pathname==='/api/me'&&req.method==='GET'){const x=team(req);return x?send(res,200,{team:publicTeam(...x),open:db.open}):send(res,401,{error:'팀 로그인이 만료되었습니다'})}
if(u.pathname==='/api/submit'&&req.method==='POST'){const x=team(req);if(!x)return send(res,401,{error:'팀 인증 실패'});if(!db.open)return send(res,403,{error:'행사가 종료되었습니다'});const [id,t]=x,b=await read(req),i=Number(b.mission)-1;if(!Number.isInteger(i)||i<0||i>7)return send(res,400,{error:'미션 번호 오류'});if(i===7&&!t.done.slice(0,7).every(Boolean))return send(res,403,{error:'앞의 7개 미션을 먼저 완료하세요'});if(t.done[i])return send(res,409,{error:'이미 완료했습니다'});if(missions[i].type==='approve'){if(!t.pending.includes(i+1))t.pending.push(i+1)}else{if(String(b.answer||'').trim().toUpperCase()!==missions[i].answer.toUpperCase())return send(res,400,{error:'정답이 아닙니다. 현장 단서를 다시 확인하세요'});t.done[i]=true}t.updated=Date.now();save();return send(res,200,{team:publicTeam(id,t)})}
if(u.pathname.startsWith('/api/admin/')){if(!auth(req))return send(res,401,{error:'관리자 PIN이 틀렸거나 서버에 설정되지 않았습니다'});if(u.pathname==='/api/admin/state'&&req.method==='GET')return send(res,200,{teams:summary(),places:db.places,open:db.open,missions:missions.map(m=>({title:m.title,type:m.type}))});
if(req.method!=='POST')return send(res,405,{error:'POST만 허용합니다'});const b=await read(req);
if(u.pathname==='/api/admin/approve'){const id=String(Number(b.team)),i=Number(b.mission),t=db.teams[id];if(!t||!t.pending.includes(i))return send(res,400,{error:'승인 대기 기록이 없습니다'});t.pending=t.pending.filter(x=>x!==i);t.done[i-1]=true;t.updated=Date.now();save();return send(res,200,{ok:true})}
if(u.pathname==='/api/admin/reset-team'){const id=String(Number(b.team));if(!/^(?:[1-9]|[1-3][0-9]|40)$/.test(id))return send(res,400,{error:'팀 번호 오류'});delete db.teams[id];save();return send(res,200,{ok:true})}
if(u.pathname==='/api/admin/reset-all'){if(b.confirm!=='전체 초기화')return send(res,400,{error:'확인 문구 오류'});db.teams={};save();return send(res,200,{ok:true})}
if(u.pathname==='/api/admin/settings'){if(Array.isArray(b.places)&&b.places.length===8)db.places=b.places.map(x=>String(x).slice(0,100));if(typeof b.open==='boolean')db.open=b.open;save();return send(res,200,{ok:true})}
return send(res,404,{error:'없는 API'})}
if(req.method!=='GET')return send(res,405,{error:'GET만 허용'});let name=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!['index.html','admin.html','manifest.json'].includes(name))return send(res,404,{error:'없음'});const file=path.join(root,name);fs.readFile(file,(err,data)=>{if(err)return send(res,404,{error:'없음'});res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':'application/json','Cache-Control':'no-store'});res.end(data)});
}catch(e){send(res,400,{error:e.message||'서버 오류'})}}).listen(PORT,()=>console.log('SH AI Treasure Hunter on '+PORT));
