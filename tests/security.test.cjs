const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHandler } = require('../api/tag');

const base = { id:'test-id', codigo:'9999999999', pin:'001234', activo:false,
  nombre:'Luna', sexo:'hembra', telefono:'099123456', zona:'Prado', info:'',
  foto1:null, foto2:null, foto3:null, updated_at:'2026-09-10T00:00:00.000Z' };
function fixture(options = {}) {
  const state = { tag:{...base,...options.tag}, calls:[], allowed:true, failSave:false, conflict:false, now:Date.parse('2026-09-10T01:00:00Z') };
  const env = { SUPABASE_URL:'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-only-not-a-real-key', ...options.env };
  const handler = createHandler({env,now:()=>state.now,fetcher:async (url, init) => {
    const u = new URL(url);
    const payload = init.body && !(init.body instanceof Buffer) ? JSON.parse(init.body) : init.body;
    state.calls.push({u,init,payload});
    let result;
    if (u.pathname.endsWith('/rpc/tmp_pin_attempt')) result = {allowed:state.allowed,retry_after:900};
    else if (u.pathname === '/rest/v1/tags' && init.method === 'PATCH') {
      if (state.failSave) return new Response('{}',{status:500});
      result = state.conflict ? [] : [{...state.tag,...payload}];
      if (!state.conflict) Object.assign(state.tag,payload);
    } else if (u.pathname === '/rest/v1/tags') {
      result = u.searchParams.get('codigo') === 'eq.' + state.tag.codigo ? [{...state.tag}] : [];
    } else if (u.pathname.startsWith('/storage/v1/object/pet-photos/')) result = {Key:'test'};
    else throw Error('Unexpected request: ' + url);
    return new Response(JSON.stringify(result),{status:200});
  }});
  async function request(body, token, method='POST') {
    const res = {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
    await handler({method,url:method === 'GET' ? '/api/tag?code='+(body.code || base.codigo) : '/api/tag',
      headers:{'content-type':'application/json','x-vercel-forwarded-for':'192.0.2.1',...(token ? {authorization:'Bearer '+token}:{})}, body},res);
    return res;
  }
  const verify = (purpose = state.tag.activo ? 'edit':'activate') => request({code:base.codigo,action:'verify',pin:base.pin,purpose});
  const data = () => ({nombre:'Luna nueva',sexo:'hembra',telefono:'099123456',zona:'Prado',info:'',photos:[],updated_at:state.tag.updated_at});
  return {state,request,verify,data};
}
test('public inactive response has no PIN, private id, draft contact or photo',async()=>{
  const f=fixture(); const r=await f.request({},null,'GET');
  assert.equal(r.code,200);assert.deepEqual(r.body,{data:{codigo:base.codigo,activo:false}});
  assert.ok(!f.state.calls[0].u.searchParams.get('select').split(',').includes('pin'));
  assert.equal(r.headers['Cache-Control'],'no-store, max-age=0');
});
test('active public response whitelists fields even if upstream leaks extra columns',async()=>{
  const f=fixture({tag:{activo:true,internal_secret:'secret'}});const r=await f.request({},null,'GET');
  assert.equal(r.body.data.nombre,'Luna');assert.equal(r.body.data.pin,undefined);assert.equal(r.body.data.id,undefined);
  assert.equal(r.body.data.internal_secret,undefined);
});
test('leading-zero PIN survives verification and is absent from token and response',async()=>{
  const f=fixture();const r=await f.verify();assert.equal(r.code,200);
  assert.ok(!JSON.stringify(r.body).includes(base.pin));
  const payload=JSON.parse(Buffer.from(r.body.token.split('.')[0],'base64url'));
  assert.equal(payload.pin,undefined);assert.ok(!JSON.stringify(payload).includes(base.pin));
  assert.equal(r.body.data.updated_at,base.updated_at);
});
test('wrong PIN is rejected; limiter denial happens before reading a PIN',async()=>{
  const f=fixture();let r=await f.request({code:base.codigo,action:'verify',pin:'wrong',purpose:'activate'});
  assert.equal(r.code,401);f.state.calls=[];f.state.allowed=false;r=await f.verify();
  assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'900');assert.equal(f.state.calls.length,1);
});
test('save and upload without a session never reach the database',async()=>{
  for(const action of ['save','upload']) {const f=fixture();const r=await f.request({code:base.codigo,action});
    assert.equal(r.code,401);assert.equal(f.state.calls.length,0);}
});
test('forged, expired and cross-TAG sessions are rejected',async()=>{
  const f=fixture();const token=(await f.verify()).body.token;
  for(const [code,t] of [[base.codigo,token+'x'],['8888888888',token]]) {
    assert.equal((await f.request({code,action:'save',data:f.data()},t)).code,401);
  }
  f.state.now+=1800001;assert.equal((await f.request({code:base.codigo,action:'save',data:f.data()},token)).code,401);
});
test('changing a PIN invalidates prior sessions',async()=>{
  const f=fixture();const token=(await f.verify()).body.token;f.state.tag.pin='changed';
  assert.equal((await f.request({code:base.codigo,action:'save',data:f.data()},token)).code,401);
});
test('activation saves all allowed fields but never overwrites PIN, code or id',async()=>{
  const f=fixture();const token=(await f.verify()).body.token;
  const r=await f.request({code:base.codigo,action:'save',data:{...f.data(),pin:'hacked',id:'other',codigo:'1234'}},token);
  assert.equal(r.code,200);assert.equal(f.state.tag.activo,true);assert.equal(f.state.tag.pin,base.pin);
  assert.equal(f.state.tag.codigo,base.codigo);assert.equal(f.state.tag.id,base.id);assert.equal(r.body.data.pin,undefined);
  assert.equal((await f.request({code:base.codigo,action:'save',data:f.data()},token)).code,409);
});
test('active TAG cannot be activated again and inactive TAG cannot be edited',async()=>{
  assert.equal((await fixture({tag:{activo:true}}).verify('activate')).code,409);
  assert.equal((await fixture().verify('edit')).code,409);
});
test('foreign photo URLs are rejected, old URLs and owned uploaded URLs preserved',async()=>{
  const old='https://legacy.example/photo.jpg';const f=fixture({tag:{activo:true,foto1:old}});
  const token=(await f.verify()).body.token;
  for(const photo of ['https://test.supabase.co/storage/v1/object/public/pet-photos/8888/a.jpeg',
    'https://evil.example/x.jpg','https://test.supabase.co/storage/v1/object/public/pet-photos/'+base.codigo+'/%2e%2e/x']) {
    const r=await f.request({code:base.codigo,action:'save',data:{...f.data(),photos:[photo]}},token);assert.equal(r.code,400);
  }
  const r=await f.request({code:base.codigo,action:'save',data:{...f.data(),photos:[old]}},token);assert.equal(r.code,200);
});
test('concurrent or stale save does not report success and does not delete photos',async()=>{
  const f=fixture({tag:{activo:true}});const token=(await f.verify()).body.token;
  let r=await f.request({code:base.codigo,action:'save',data:{...f.data(),updated_at:'old'}},token);assert.equal(r.code,409);
  f.state.conflict=true;r=await f.request({code:base.codigo,action:'save',data:f.data()},token);assert.equal(r.code,409);
  f.state.conflict=false;f.state.failSave=true;r=await f.request({code:base.codigo,action:'save',data:f.data()},token);assert.equal(r.code,503);
  assert.ok(!f.state.calls.some(c=>c.init.method==='DELETE'));
});
test('upload is authorized, bounded and stored only in the verified TAG folder',async()=>{
  const f=fixture();const token=(await f.verify()).body.token;
  let r=await f.request({code:base.codigo,action:'upload',image:Buffer.from('<svg></svg>').toString('base64')},token);assert.equal(r.code,400);
  r=await f.request({code:base.codigo,action:'upload',image:Buffer.alloc(513*1024).toString('base64')},token);assert.equal(r.code,413);
  r=await f.request({code:base.codigo,action:'upload',image:Buffer.from([255,216,255,224,255,217]).toString('base64'),path:'another/file'},token);
  assert.equal(r.code,200);assert.match(r.body.url,new RegExp('/pet-photos/'+base.codigo+'/[a-f0-9-]+\\.jpeg$'));
  const upload=f.state.calls.find(c=>c.u.pathname.includes('/storage/'));
  assert.equal(upload.init.headers['x-upsert'],'false');
});
test('preview refuses verification and changes to production TAGs',async()=>{
  const f=fixture({env:{VERCEL_ENV:'preview'}});assert.equal((await f.verify()).code,403);
  assert.equal((await f.request({},null,'GET')).code,200);
  assert.equal((await fixture({env:{VERCEL_ENV:'preview',TRACKMYPET_PREVIEW_TEST_CODE:base.codigo}}).verify()).code,200);
});
test('configuration errors fail closed and never disclose the key',async()=>{
  const f=fixture({env:{SUPABASE_SERVICE_ROLE_KEY:''}});const r=await f.request({},null,'GET');
  assert.equal(r.code,503);assert.equal(f.state.calls.length,0);
});
test('frontend compiles and contains no direct Supabase access or PIN comparison',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach(s=>new vm.Script(s));
  assert.doesNotMatch(html,/SUPABASE_KEY|createClient|tag\.pin|\.from\("tags"\)|deleteOldPhotos/);
  assert.match(html,/image\.alt = 'Foto de ' \+ petName/);
  assert.match(html,/escapeAttribute\(url\)/);
});
