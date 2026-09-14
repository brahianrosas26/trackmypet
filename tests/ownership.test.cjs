const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHandler } = require('../api/account');
const { createHandler: createConfigHandler } = require('../api/auth-config');

function response() {
  return { headers:{}, setHeader(k,v){this.headers[k]=v;}, status(n){this.code=n;return this;}, json(b){this.body=b;return this;} };
}

function fixture(options = {}) {
  const state = { owner: options.owner || null, calls: [], allowed: options.allowed !== false };
  const env = {
    SUPABASE_URL: 'https://staging.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role-test-key',
    SUPABASE_PUBLISHABLE_KEY: 'staging-publishable-test-key',
    TRACKMYPET_ACCOUNTS_ENABLED: 'true',
    ...options.env
  };
  const tag = { id:'11111111-1111-4111-8111-111111111111', codigo:'000000', pin:'0123', activo:true, nombre:'Luna' };
  const user = { id:'22222222-2222-4222-8222-222222222222', email:'owner@example.com', email_confirmed_at:'2026-09-11T00:00:00Z' };
  const fetcher = async (url, init) => {
    const u = new URL(url); state.calls.push({u,init});
    if (u.pathname === '/auth/v1/user') {
      if (init.headers.Authorization !== 'Bearer valid-user-token') return new Response('{}',{status:401});
      return new Response(JSON.stringify(options.user || user),{status:200});
    }
    if (u.pathname.endsWith('/rpc/tmp_pin_attempt')) return new Response(JSON.stringify({allowed:state.allowed,retry_after:900}),{status:200});
    if (u.pathname.endsWith('/rpc/tmp_tag_by_pin')) {
      const body=JSON.parse(init.body);
      if (options.duplicatePin) return new Response(JSON.stringify([tag,{...tag,id:'44444444-4444-4444-8444-444444444444',codigo:'000001'}]),{status:200});
      return new Response(JSON.stringify(body.p_pin===tag.pin?[{id:tag.id,codigo:tag.codigo,activo:tag.activo}]:[]),{status:200});
    }
    if (u.pathname.endsWith('/rpc/tmp_reset_tag')) {
      if (!state.owner || state.owner !== user.id || options.deleteConflict) return new Response(JSON.stringify([]),{status:200});
      state.owner=null;
      return new Response(JSON.stringify([{codigo:tag.codigo,foto1:null,foto2:null,foto3:null}]),{status:200});
    }
    if (u.pathname === '/rest/v1/tags') return new Response(JSON.stringify(u.searchParams.get('codigo') === 'eq.000000' ? [tag] : []),{status:200});
    if (u.pathname === '/rest/v1/tag_owners' && init.method === 'GET') {
      if (u.searchParams.has('tag_id')) return new Response(JSON.stringify(state.owner ? [{user_id:state.owner}] : []),{status:200});
      return new Response(JSON.stringify([]),{status:200});
    }
    if (u.pathname === '/rest/v1/tag_owners' && init.method === 'POST') {
      if (options.conflict) return new Response('{}',{status:409});
      const body=JSON.parse(init.body); state.owner=body.user_id;
      return new Response(JSON.stringify([{...body,claimed_at:'2026-09-11T00:00:00Z'}]),{status:201});
    }
    if (u.pathname === '/rest/v1/tag_owners' && init.method === 'DELETE') {
      if (options.deleteConflict) return new Response(JSON.stringify([]),{status:200});
      const removed=state.owner; state.owner=null;
      return new Response(JSON.stringify(removed ? [{tag_id:tag.id}] : []),{status:200});
    }
    throw new Error('Unexpected request '+url);
  };
  const handler=createHandler({env,fetcher});
  async function request(body, token='valid-user-token', method='POST') {
    const res=response();
    await handler({method,url:'/api/account',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-vercel-forwarded-for':'192.0.2.1'},body,socket:{}},res);
    return res;
  }
  return {state,env,user,request,fetcher};
}

test('account endpoints are disabled by default and expose no staging configuration', async()=>{
  const f=fixture({env:{TRACKMYPET_ACCOUNTS_ENABLED:'false'}});
  assert.equal((await f.request({},'valid-user-token','GET')).code,404);
  const res=response(); await createConfigHandler({env:f.env})({method:'GET',headers:{}},res);
  assert.equal(res.code,404); assert.equal(res.body.supabasePublishableKey,undefined);
});

test('server validates the access token with Supabase Auth and requires confirmed email', async()=>{
  let f=fixture(); assert.equal((await f.request({},'forged','GET')).code,401);
  f=fixture({user:{id:f.user.id,email:'owner@example.com',email_confirmed_at:null}});
  assert.equal((await f.request({},'valid-user-token','GET')).code,403);
});

test('claim validates PIN server-side and creates one ownership row', async()=>{
  const f=fixture();
  const result=await f.request({action:'claim',code:'000000',pin:'0123'});
  assert.equal(result.code,201); assert.equal(result.body.data.code,'000000');
  assert.equal(result.body.data.active,true);
  assert.ok(!JSON.stringify(result.body).includes('0123'));
  const insert=f.state.calls.find(c=>c.u.pathname==='/rest/v1/tag_owners' && c.init.method==='POST');
  assert.ok(insert); assert.ok(!insert.init.body.includes('0123'));
});

test('dashboard can claim by PIN only without exposing or storing the PIN in a lookup URL', async()=>{
  const f=fixture();
  const result=await f.request({action:'claim',code:'',pin:'0123'});
  assert.equal(result.code,201); assert.equal(result.body.data.code,'000000');
  const lookup=f.state.calls.find(c=>c.u.pathname.endsWith('/rpc/tmp_tag_by_pin'));
  assert.ok(lookup); assert.equal(lookup.u.search.includes('0123'),false);
  const limiter=f.state.calls.find(c=>c.u.pathname.endsWith('/rpc/tmp_pin_attempt'));
  assert.equal(JSON.parse(limiter.init.body).p_code.includes('0123'),false);

  const duplicate=fixture({duplicatePin:true});
  assert.equal((await duplicate.request({action:'claim',code:'',pin:'0123'})).code,409);
});

test('claim rejects wrong PIN, limiter denial and ownership conflicts', async()=>{
  let f=fixture(); assert.equal((await f.request({action:'claim',code:'000000',pin:'9999'})).code,401);
  f=fixture({allowed:false}); assert.equal((await f.request({action:'claim',code:'000000',pin:'0123'})).code,429);
  f=fixture({owner:'33333333-3333-4333-8333-333333333333'});
  assert.equal((await f.request({action:'claim',code:'000000',pin:'0123'})).code,409);
  f=fixture({conflict:true}); assert.equal((await f.request({action:'claim',code:'000000',pin:'0123'})).code,409);
});

test('only the current owner can remove a TAG and the PIN is validated again', async()=>{
  let f=fixture({owner:'22222222-2222-4222-8222-222222222222'});
  let result=await f.request({action:'unlink',code:'000000',pin:'0123'});
  assert.equal(result.code,200); assert.equal(result.body.data.reset,true); assert.equal(f.state.owner,null);
  assert.ok(!JSON.stringify(result.body).includes('0123'));
  f=fixture({owner:'22222222-2222-4222-8222-222222222222'});
  result=await f.request({action:'unlink',code:'000000',pin:'9999'});
  assert.equal(result.code,401); assert.ok(f.state.owner);
  f=fixture({owner:'33333333-3333-4333-8333-333333333333'});
  result=await f.request({action:'unlink',code:'000000',pin:'0123'});
  assert.equal(result.code,403); assert.ok(f.state.owner);
});

test('unlink handles missing or concurrently changed ownership', async()=>{
  let f=fixture();
  assert.equal((await f.request({action:'unlink',code:'000000',pin:'0123'})).code,409);
  f=fixture({owner:'22222222-2222-4222-8222-222222222222',deleteConflict:true});
  assert.equal((await f.request({action:'unlink',code:'000000',pin:'0123'})).code,409);
});

test('ownership migrations deny browser roles and preserve data and photo reads',()=>{
  const cleanup=fs.readFileSync(require.resolve('../supabase/005_remove_obsolete_public_policies.sql'),'utf8');
  const owners=fs.readFileSync(require.resolve('../supabase/006_tag_owners.sql'),'utf8');
  const release=fs.readFileSync(require.resolve('../supabase/007_owner_release.sql'),'utf8');
  assert.match(owners,/tag_id uuid primary key references public\.tags\(id\) on delete restrict/i);
  assert.match(owners,/user_id uuid not null references auth\.users\(id\) on delete restrict/i);
  assert.match(owners,/revoke all privileges.*public, anon, authenticated/is);
  assert.doesNotMatch(owners,/grant .*authenticated/i);
  assert.match(owners,/grant select, insert.*service_role/is);
  assert.doesNotMatch(cleanup,/drop policy if exists "allow public photo read"/i);
  assert.doesNotMatch(cleanup,/delete from|update public\.tags|alter table public\.tags.*drop column/is);
  assert.match(release,/revoke all privileges.*public, anon, authenticated/is);
  assert.match(release,/grant select, insert, delete.*service_role/is);
  assert.doesNotMatch(release,/grant[^\r\n]*\b(?:anon|authenticated)\b/i);
  assert.match(release,/revoke all on function public\.tmp_tag_by_pin\(text\) from public, anon, authenticated/is);
  assert.match(release,/create or replace function public\.tmp_reset_tag\(p_tag_id uuid, p_user_id uuid\)/i);
  assert.match(release,/revoke all on function public\.tmp_reset_tag\(uuid, uuid\) from public, anon, authenticated/is);
});

