import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const path = location.pathname;
const els = Object.fromEntries(['registerView','loginView','recoverView','resetView','petsView','notice','accountEmail','petList'].map(id=>[id,document.getElementById(id)]));
let supabase;
function show(id){for(const key of ['registerView','loginView','recoverView','resetView','petsView'])els[key].classList.toggle('hidden',key!==id)}
function note(message,error=false){els.notice.textContent=message;els.notice.className='notice'+(error?' error':'');els.notice.style.display='block'}
async function setup(){
  const response=await fetch('/api/auth-config',{cache:'no-store'});const json=await response.json();
  if(!response.ok)throw Error(json.error||'Las cuentas todavía no están disponibles.');
  supabase=createClient(json.supabaseUrl,json.supabasePublishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true}});
  if(path==='/registro')return show('registerView');
  if(path==='/recuperar-clave')return show('recoverView');
  if(path==='/restablecer-clave')return show('resetView');
  if(path==='/mis-mascotas'){const {data:{session}}=await supabase.auth.getSession();if(!session){location.replace('/iniciar-sesion');return}return loadPets(session)}
  show('loginView');
}
async function loadPets(session){
  const user=session.user;els.accountEmail.textContent=user.email;
  if(!user.email_confirmed_at){note('Confirmá tu email antes de vincular o administrar TAGs.',true);return show('petsView')}
  const response=await fetch('/api/account',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});const json=await response.json();
  if(!response.ok){note(json.error||'No se pudieron cargar tus mascotas.',true);return show('petsView')}
  els.petList.innerHTML=json.data.length?json.data.map(tag=>`<article class="pet"><h2>${escapeHtml(tag.nombre||'TAG '+tag.codigo)}</h2><p>Código ${escapeHtml(tag.codigo)} · ${tag.activo?'Activo':'Pendiente de activación'}</p></article>`).join(''):'<p>Aún no tenés TAGs vinculados.</p>';
  show('petsView');
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
document.getElementById('registerForm')?.addEventListener('submit',async e=>{e.preventDefault();const {error}=await supabase.auth.signUp({email:registerEmail.value.trim(),password:registerPassword.value,options:{emailRedirectTo:location.origin+'/mis-mascotas'}});note(error?error.message:'Revisá tu email para confirmar la cuenta.',Boolean(error))});
document.getElementById('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const {error}=await supabase.auth.signInWithPassword({email:loginEmail.value.trim(),password:loginPassword.value});if(error)return note('Email o contraseña incorrectos.',true);location.replace('/mis-mascotas')});
document.getElementById('recoverForm')?.addEventListener('submit',async e=>{e.preventDefault();const {error}=await supabase.auth.resetPasswordForEmail(recoverEmail.value.trim(),{redirectTo:location.origin+'/restablecer-clave'});note(error?error.message:'Si existe una cuenta con ese email, enviamos un enlace de recuperación.',Boolean(error))});
document.getElementById('resetForm')?.addEventListener('submit',async e=>{e.preventDefault();const {error}=await supabase.auth.updateUser({password:resetPassword.value});if(error)return note(error.message,true);note('Contraseña actualizada. Ya podés iniciar sesión.');setTimeout(()=>location.replace('/iniciar-sesion'),800)});
document.getElementById('logoutBtn')?.addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('/iniciar-sesion')});
document.getElementById('claimForm')?.addEventListener('submit',async e=>{e.preventDefault();const {data:{session}}=await supabase.auth.getSession();if(!session)return location.replace('/iniciar-sesion');const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'claim',code:claimCode.value.trim(),pin:claimPin.value})});const json=await response.json();if(!response.ok)return note(json.error||'No se pudo vincular el TAG.',true);note(json.data.alreadyLinked?'Este TAG ya estaba vinculado a tu cuenta.':'TAG vinculado correctamente.');claimForm.reset();await loadPets(session)});
setup().catch(error=>note(error.message,true));

