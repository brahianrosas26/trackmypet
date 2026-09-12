import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const path=location.pathname;
const query=new URLSearchParams(location.search);
const els=Object.fromEntries(['registerView','verifyView','loginView','recoverView','resetView','petsView','notice','accountEmail','petList'].map(id=>[id,document.getElementById(id)]));
const $=id=>document.getElementById(id);
const registerForm=$('registerForm'),registerEmail=$('registerEmail'),registerPassword=$('registerPassword'),requestForm=$('requestForm'),verifyForm=$('verifyForm'),verifyEmail=$('verifyEmail'),verifyCode=$('verifyCode'),resendBtn=$('resendBtn'),resendStatus=$('resendStatus'),loginForm=$('loginForm'),loginEmail=$('loginEmail'),loginPassword=$('loginPassword'),recoverForm=$('recoverForm'),recoverEmail=$('recoverEmail'),resetForm=$('resetForm'),resetPassword=$('resetPassword'),logoutBtn=$('logoutBtn'),claimForm=$('claimForm'),claimTitle=$('claimTitle'),claimIntro=$('claimIntro'),claimCode=$('claimCode'),claimCodeWrap=$('claimCodeWrap'),claimPin=$('claimPin');
const RESEND_DELAY=10*60*1000;
let supabase,resendTimer;

function pendingTag(){
  const incoming=query.get('tag');
  if(/^[0-9]{4,10}$/.test(incoming||'')) sessionStorage.setItem('trackmypetPendingTag',incoming);
  const stored=sessionStorage.getItem('trackmypetPendingTag')||'';
  return /^[0-9]{4,10}$/.test(stored)?stored:'';
}
function destination(pathname){
  const tag=pendingTag();
  return pathname+(tag?'?tag='+encodeURIComponent(tag):'');
}
function show(id){for(const key of ['registerView','verifyView','loginView','recoverView','resetView','petsView'])els[key].classList.toggle('hidden',key!==id)}
function note(message,error=false){els.notice.textContent=message;els.notice.className='notice'+(error?' error':'');els.notice.style.display='block'}
function carryTagLinks(){
  for(const link of document.querySelectorAll('[data-carry-tag]')) link.href=destination(link.getAttribute('href'));
}
function setVerificationStep(email=''){
  verifyEmail.value=email;
  requestForm.classList.toggle('hidden',Boolean(email));
  verifyForm.classList.toggle('hidden',!email);
  if(email) updateResend();
}
function startCooldown(){
  sessionStorage.setItem('trackmypetVerifyResendAt',String(Date.now()+RESEND_DELAY));
  updateResend();clearInterval(resendTimer);resendTimer=setInterval(updateResend,1000);
}
function updateResend(){
  const until=Number(sessionStorage.getItem('trackmypetVerifyResendAt')||0),remaining=Math.max(0,until-Date.now());
  if(!remaining){resendBtn.disabled=false;resendStatus.textContent='¿No recibiste el código?';clearInterval(resendTimer);return}
  const minutes=Math.floor(remaining/60000),seconds=Math.ceil((remaining%60000)/1000);
  resendBtn.disabled=true;resendStatus.textContent='Podrás solicitar otro código en '+minutes+':'+String(seconds).padStart(2,'0');
}
async function sendVerificationCode(email){
  const {error}=await supabase.auth.resend({type:'signup',email});
  if(error){note('No se pudo reenviar el código. Intentá nuevamente más tarde.',true);return false}
  sessionStorage.setItem('trackmypetVerifyEmail',email);setVerificationStep(email);startCooldown();
  note('Enviamos un código de 8 dígitos a tu correo.');return true;
}
async function setup(){
  pendingTag();carryTagLinks();
  const response=await fetch('/api/auth-config',{cache:'no-store'}),json=await response.json();
  if(!response.ok) throw Error(json.error||'Las cuentas todavía no están disponibles.');
  supabase=createClient(json.supabaseUrl,json.supabasePublishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true}});
  if(path==='/registro') return show('registerView');
  if(path==='/verificar-email'){
    const email=sessionStorage.getItem('trackmypetVerifyEmail')||'';
    setVerificationStep(email);return show('verifyView');
  }
  if(path==='/recuperar-clave') return show('recoverView');
  if(path==='/restablecer-clave') return show('resetView');
  if(path==='/mis-mascotas'){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){location.replace(destination('/iniciar-sesion'));return}
    return loadPets(session);
  }
  show('loginView');
}
async function loadPets(session){
  const user=session.user;els.accountEmail.textContent=user.email;
  if(!user.email_confirmed_at){note('Confirmá tu email antes de vincular o administrar TAGs.',true);return show('petsView')}
  const response=await fetch('/api/account',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'}),json=await response.json();
  if(!response.ok){note(json.error||'No se pudieron cargar tus mascotas.',true);return show('petsView')}
  els.petList.innerHTML=json.data.length?json.data.map(tag=>`<article class="pet"><h2>${escapeHtml(tag.nombre||'TAG '+tag.codigo)}</h2><p>Código ${escapeHtml(tag.codigo)} · ${tag.activo?'Activo':'Pendiente de activación'}</p><div class="links"><a href="/${encodeURIComponent(tag.codigo)}?${tag.activo?'account-edit':'account-activate'}=1">${tag.activo?'Editar perfil':'Continuar activación'}</a><a href="/${encodeURIComponent(tag.codigo)}">Ver ficha</a></div></article>`).join(''):'<p>Aún no tenés TAGs vinculados. Agregá tu primer TAG con su código y PIN.</p>';
  const tag=pendingTag();
  if(tag){claimTitle.textContent='Activá tu TAG';claimIntro.textContent='Ingresá el PIN del TAG que acabás de escanear.';claimCode.value=tag;claimCodeWrap.classList.add('hidden')}
  else {claimTitle.textContent='Agregar TAG';claimIntro.textContent='Ingresá el código y PIN para vincularlo a tu cuenta.';claimCodeWrap.classList.remove('hidden')}
  show('petsView');
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

registerForm?.addEventListener('submit',async e=>{
  e.preventDefault();const email=registerEmail.value.trim();
  const {error}=await supabase.auth.signUp({email,password:registerPassword.value});
  if(error)return note(error.message,true);
  sessionStorage.setItem('trackmypetVerifyEmail',email);startCooldown();location.replace(destination('/verificar-email'));
});
verifyForm?.addEventListener('submit',async e=>{
  e.preventDefault();const email=verifyEmail.value.trim(),token=verifyCode.value.trim();
  if(!/^\d{8}$/.test(token))return note('Ingresá el código de 8 dígitos.',true);
  const {error}=await supabase.auth.verifyOtp({email,token,type:'signup'});
  if(error)return note('El código es inválido o venció.',true);
  sessionStorage.removeItem('trackmypetVerifyEmail');sessionStorage.removeItem('trackmypetVerifyResendAt');
  location.replace(destination('/mis-mascotas'));
});
resendBtn?.addEventListener('click',async()=>{await sendVerificationCode(verifyEmail.value.trim())});
loginForm?.addEventListener('submit',async e=>{
  e.preventDefault();const {error}=await supabase.auth.signInWithPassword({email:loginEmail.value.trim(),password:loginPassword.value});
  if(error)return note('Email o contraseña incorrectos.',true);location.replace(destination('/mis-mascotas'));
});
recoverForm?.addEventListener('submit',async e=>{
  e.preventDefault();const {error}=await supabase.auth.resetPasswordForEmail(recoverEmail.value.trim(),{redirectTo:location.origin+'/restablecer-clave'});
  note(error?error.message:'Si existe una cuenta con ese email, enviamos un enlace de recuperación.',Boolean(error));
});
resetForm?.addEventListener('submit',async e=>{
  e.preventDefault();const {error}=await supabase.auth.updateUser({password:resetPassword.value});
  if(error)return note(error.message,true);note('Contraseña actualizada. Ya podés iniciar sesión.');setTimeout(()=>location.replace('/iniciar-sesion'),800);
});
logoutBtn?.addEventListener('click',async()=>{const {error}=await supabase.auth.signOut();if(error)return note('No se pudo cerrar la sesión. Intentá nuevamente.',true);sessionStorage.removeItem('trackmypetPendingTag');location.replace('/iniciar-sesion')});
claimForm?.addEventListener('submit',async e=>{
  e.preventDefault();const {data:{session}}=await supabase.auth.getSession();
  if(!session)return location.replace(destination('/iniciar-sesion'));
  const code=claimCode.value.trim(),response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'claim',code,pin:claimPin.value})}),json=await response.json();
  if(!response.ok)return note(json.error||'No se pudo vincular el TAG.',true);
  const tag=pendingTag();claimForm.reset();
  if(tag===code){sessionStorage.removeItem('trackmypetPendingTag');location.replace('/'+encodeURIComponent(code)+'?account-activate=1');return}
  note(json.data.alreadyLinked?'Este TAG ya estaba vinculado a tu cuenta.':'TAG vinculado correctamente.');await loadPets(session);
});
setup().catch(error=>note(error.message,true));

