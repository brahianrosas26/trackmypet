import './account-controls.js';

const path=location.pathname;
const query=new URLSearchParams(location.search);
const els=Object.fromEntries(['registerView','verifyView','loginView','recoverView','resetView','petsView','notice','accountEmail','petList'].map(id=>[id,document.getElementById(id)]));
const $=id=>document.getElementById(id);
const registerForm=$('registerForm'),registerEmail=$('registerEmail'),registerPassword=$('registerPassword'),registerPasswordConfirm=$('registerPasswordConfirm'),requestForm=$('requestForm'),verifyForm=$('verifyForm'),verifyEmail=$('verifyEmail'),verifyEmailText=$('verifyEmailText'),verifyCode=$('verifyCode'),resendBtn=$('resendBtn'),resendStatus=$('resendStatus'),loginForm=$('loginForm'),loginEmail=$('loginEmail'),loginPassword=$('loginPassword'),recoverRequestPanel=$('recoverRequestPanel'),recoverRequestForm=$('recoverRequestForm'),recoverEmail=$('recoverEmail'),recoverVerifyForm=$('recoverVerifyForm'),recoverVerifyEmail=$('recoverVerifyEmail'),recoverEmailText=$('recoverEmailText'),recoverCode=$('recoverCode'),recoverResendBtn=$('recoverResendBtn'),recoverResendStatus=$('recoverResendStatus'),resetForm=$('resetForm'),resetPassword=$('resetPassword'),resetPasswordConfirm=$('resetPasswordConfirm'),logoutBtn=$('logoutBtn'),addTagBtn=$('addTagBtn'),cancelClaimBtn=$('cancelClaimBtn'),petCount=$('petCount'),claimForm=$('claimForm'),claimTitle=$('claimTitle'),claimIntro=$('claimIntro'),claimCode=$('claimCode'),claimCodeWrap=$('claimCodeWrap'),claimPin=$('claimPin');
const RESEND_DELAY=10*60*1000;
let supabase,resendTimer,recoverResendTimer;

function pendingTag(){
  const incoming=query.get('tag');
  if(/^[0-9]{4,10}$/.test(incoming||'')) sessionStorage.setItem('trackmypetPendingTag',incoming);
  const stored=sessionStorage.getItem('trackmypetPendingTag')||'';
  return /^[0-9]{4,10}$/.test(stored)?stored:'';
}
function destination(pathname){
  const tag=pendingTag();
  claimCode.required=Boolean(tag);
  return pathname+(tag?'?tag='+encodeURIComponent(tag):'');
}
function show(id){for(const key of ['registerView','verifyView','loginView','recoverView','resetView','petsView'])els[key].classList.toggle('hidden',key!==id)}
function note(message,error=false){els.notice.textContent=message;els.notice.className='notice'+(error?' error':'');els.notice.style.display='block';els.notice.setAttribute('role',error?'alert':'status')}
function clearNote(){els.notice.style.display='none';els.notice.textContent=''}
function busy(form,on,label){const button=form?.querySelector('button[type="submit"],button:not([type])');if(!button)return;if(!button.dataset.label)button.dataset.label=button.textContent;button.disabled=on;button.textContent=on?label:button.dataset.label;form.setAttribute('aria-busy',String(on))}
function authMessage(error,context){
  const message=String(error?.message||'').toLowerCase();
  if(message.includes('rate')||message.includes('too many'))return 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.';
  if(message.includes('expired'))return context==='verify'||context==='recover-verify'?'El código venció. Solicitá uno nuevo.':'No pudimos enviar el código. Intentá nuevamente.';
  if(context==='login'&&(message.includes('confirm')||message.includes('verified')))return 'Tu email todavía no está confirmado. Revisá el código que enviamos a tu correo.';
  if(context==='login')return 'Email o contraseña incorrectos.';
  if(context==='verify')return 'El código es incorrecto, venció o ya fue utilizado.';
  if(context==='register'&&message.includes('password'))return 'La contraseña no cumple los requisitos de seguridad.';
  return 'No pudimos completar la solicitud. Revisá tu conexión e intentá nuevamente.';
}
function carryTagLinks(){
  for(const link of document.querySelectorAll('[data-carry-tag]')) link.href=destination(link.getAttribute('href'));
}
function setVerificationStep(email=''){
  verifyEmail.value=email;
  if(verifyEmailText)verifyEmailText.textContent=email;
  requestForm.classList.toggle('hidden',Boolean(email));
  verifyForm.classList.toggle('hidden',!email);
  if(email){updateResend();clearInterval(resendTimer);resendTimer=setInterval(updateResend,1000)}
}
function startCooldown(){
  sessionStorage.setItem('trackmypetVerifyResendAt',String(Date.now()+RESEND_DELAY));
  updateResend();clearInterval(resendTimer);resendTimer=setInterval(updateResend,1000);
}
function updateResend(){
  const until=Number(sessionStorage.getItem('trackmypetVerifyResendAt')||0),remaining=Math.max(0,until-Date.now());
  if(!remaining){resendBtn.disabled=false;resendStatus.textContent='¿No recibiste el código?';clearInterval(resendTimer);return}
  const totalSeconds=Math.ceil(remaining/1000),minutes=Math.floor(totalSeconds/60),seconds=totalSeconds%60;
  resendBtn.disabled=true;resendStatus.textContent='Podrás solicitar otro código en '+minutes+':'+String(seconds).padStart(2,'0');
}
async function sendVerificationCode(email){
  resendBtn.disabled=true;resendBtn.textContent='Enviando…';clearNote();
  try{
    const {error}=await supabase.auth.resend({type:'signup',email});
    if(error){note(authMessage(error,'resend'),true);return false}
    sessionStorage.setItem('trackmypetVerifyEmail',email);setVerificationStep(email);startCooldown();
    note('Código enviado. Revisá también Spam o Correo no deseado.');return true;
  }catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true);return false}
  finally{resendBtn.textContent='Reenviar código';updateResend()}
}
function setRecoveryStep(email=''){
  recoverVerifyEmail.value=email;
  recoverEmailText.textContent=email;
  recoverRequestPanel.classList.toggle('hidden',Boolean(email));
  recoverVerifyForm.classList.toggle('hidden',!email);
  if(email){updateRecoveryCooldown();clearInterval(recoverResendTimer);recoverResendTimer=setInterval(updateRecoveryCooldown,1000)}
}
function startRecoveryCooldown(){
  sessionStorage.setItem('trackmypetRecoverResendAt',String(Date.now()+RESEND_DELAY));
  updateRecoveryCooldown();clearInterval(recoverResendTimer);recoverResendTimer=setInterval(updateRecoveryCooldown,1000);
}
function updateRecoveryCooldown(){
  const until=Number(sessionStorage.getItem('trackmypetRecoverResendAt')||0),remaining=Math.max(0,until-Date.now());
  if(!remaining){recoverResendBtn.disabled=false;recoverResendStatus.textContent='¿No recibiste el código?';clearInterval(recoverResendTimer);return}
  const totalSeconds=Math.ceil(remaining/1000),minutes=Math.floor(totalSeconds/60),seconds=totalSeconds%60;
  recoverResendBtn.disabled=true;recoverResendStatus.textContent='Podrás solicitar otro código en '+minutes+':'+String(seconds).padStart(2,'0');
}
async function sendRecoveryCode(email){
  clearNote();
  const {error}=await supabase.auth.resetPasswordForEmail(email);
  if(error){note(authMessage(error,'recover'),true);return false}
  sessionStorage.setItem('trackmypetRecoverEmail',email);startRecoveryCooldown();setRecoveryStep(email);
  note('Si existe una cuenta con ese email, enviamos un código de recuperación. Revisá también Spam o Correo no deseado.');
  return true;
}
async function setup(){
  pendingTag();carryTagLinks();
  const response=await fetch('/api/auth-config',{cache:'no-store'}),json=await response.json();
  if(!response.ok) throw Error(json.error||'Las cuentas todavía no están disponibles.');
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
  supabase=createClient(json.supabaseUrl,json.supabasePublishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true}});
  if(path==='/registro') return show('registerView');
  if(path==='/verificar-email'){
    const email=sessionStorage.getItem('trackmypetVerifyEmail')||'';
    setVerificationStep(email);return show('verifyView');
  }
  if(path==='/recuperar-clave'){setRecoveryStep(sessionStorage.getItem('trackmypetRecoverEmail')||'');return show('recoverView');}
  if(path==='/restablecer-clave'){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){note('El código de recuperación no es válido, venció o ya fue utilizado. Solicitá uno nuevo.',true);return show('recoverView')}
    return show('resetView');
  }
  if(path==='/mis-mascotas'){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){location.replace(destination('/iniciar-sesion'));return}
    return loadPets(session);
  }
  if(path==='/iniciar-sesion'){
    const {data:{session}}=await supabase.auth.getSession();
    if(session){location.replace(destination('/mis-mascotas'));return}
  }
  show('loginView');
}
function showClaim(open=true){
  claimForm.classList.toggle('hidden',!open);
  addTagBtn.setAttribute('aria-expanded',String(open));
  if(open) setTimeout(()=>claimPin.focus(),0);
}
function openAddTag(){
  clearNote();claimForm.reset();
  const tag=pendingTag();
  claimCodeWrap.classList.add('hidden');
  claimPin.closest('.field').classList.remove('hidden');
  claimForm.querySelector('.primary').classList.remove('hidden');
  if(tag){claimCode.value=tag;claimTitle.textContent='Activá tu TAG';claimIntro.textContent='Ingresá únicamente el PIN de tu TAG para vincularlo a tu cuenta.'}
  else {claimTitle.textContent='Agregar TAG';claimIntro.textContent='Ingresá el PIN de tu TAG para vincularlo a tu cuenta.'}
  showClaim(true);
}
function petCard(tag){
  const name=escapeHtml(tag.nombre||'TAG '+tag.codigo),code=escapeHtml(tag.codigo);
  const photo=typeof tag.foto1==='string'&&/^https:\/\//.test(tag.foto1)?'<img class="pet-photo" src="'+escapeHtml(tag.foto1)+'" alt="Foto de '+name+'" loading="lazy"/>':'<div class="pet-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 11.5c-1.4-1.1-2-2.7-1.3-3.6.7-.8 2.3-.5 3.6.7M15.5 11.5c1.4-1.1 2-2.7 1.3-3.6-.7-.8-2.3-.5-3.6.7"/><path d="M7.4 17.2c.8-2.7 2.4-4.2 4.6-4.2s3.8 1.5 4.6 4.2c.4 1.4-.7 2.8-2.2 2.8H9.6c-1.5 0-2.6-1.4-2.2-2.8Z"/></svg></div>';
  const status=tag.perdida?'<span class="badge lost">Está perdida</span>':tag.activo?'<span class="badge">Activo</span>':'<span class="badge pending">Pendiente</span>';
  const action=tag.activo?'Editar perfil':'Continuar activación';
  const viewLink=tag.activo?'<a class="view" href="/'+encodeURIComponent(tag.codigo)+'?owner-view=1">Ver ficha</a>':'';
  return '<article class="pet">'+photo+'<div><h2>'+name+'</h2><div class="pet-meta"><span>Código '+code+'</span>'+status+'</div><div class="pet-actions"><a class="edit" href="/'+encodeURIComponent(tag.codigo)+'?'+(tag.activo?'account-edit':'account-activate')+'=1">'+action+'</a>'+viewLink+'</div></div></article>';
}
async function loadPets(session){
  const user=session.user;els.accountEmail.textContent=user.email;
  if(!user.email_confirmed_at){note('Confirmá tu email antes de vincular o administrar TAGs.',true);return show('petsView')}
  const response=await fetch('/api/account',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'}),json=await response.json();
  if(!response.ok){note(json.error||'No se pudieron cargar tus mascotas.',true);return show('petsView')}
  const tags=json.data||[];
  petCount.textContent=tags.length===1?'1 TAG vinculado':tags.length+' TAGs vinculados';
  els.petList.innerHTML=tags.length?tags.map(petCard).join(''):'<button class="empty-state" id="emptyAddTag" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h16M12 4v16"/></svg><strong>Aún no tenés TAGs vinculados</strong><p>Tocá acá para agregar tu primer TAG. Tené el PIN a mano.</p></button>';
  $('emptyAddTag')?.addEventListener('click',openAddTag);
  const tag=pendingTag();
  if(tag){claimTitle.textContent='Activá tu TAG';claimIntro.textContent='Ingresá el PIN del TAG que acabás de escanear.';claimCode.value=tag;claimCodeWrap.classList.add('hidden');showClaim(true)}
  else {claimCodeWrap.classList.add('hidden');claimPin.closest('.field').classList.add('hidden');claimForm.querySelector('.primary').classList.add('hidden');showClaim(false)}
  show('petsView');
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

registerForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();const email=registerEmail.value.trim();
  if(registerPassword.value!==registerPasswordConfirm.value)return note('Las contraseñas no coinciden.',true);
  busy(registerForm,true,'Creando cuenta…');
  try{
    const {error}=await supabase.auth.signUp({email,password:registerPassword.value});
    if(error)return note(authMessage(error,'register'),true);
    sessionStorage.setItem('trackmypetVerifyEmail',email);startCooldown();location.replace(destination('/verificar-email'));
  }catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}
  finally{busy(registerForm,false,'')}
});
verifyForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();const email=verifyEmail.value.trim(),token=verifyCode.value.trim();
  if(!/^\d{8}$/.test(token))return note('Ingresá el código de 8 dígitos.',true);
  busy(verifyForm,true,'Confirmando…');
  try{
    const {error}=await supabase.auth.verifyOtp({email,token,type:'signup'});
    if(error)return note(authMessage(error,'verify'),true);
    note('Email confirmado. Estamos abriendo tus mascotas.');
    sessionStorage.removeItem('trackmypetVerifyEmail');sessionStorage.removeItem('trackmypetVerifyResendAt');
    location.replace(destination('/mis-mascotas'));
  }catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}
  finally{busy(verifyForm,false,'')}
});
resendBtn?.addEventListener('click',async()=>{await sendVerificationCode(verifyEmail.value.trim())});
loginForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();busy(loginForm,true,'Ingresando…');
  try{const {error}=await supabase.auth.signInWithPassword({email:loginEmail.value.trim(),password:loginPassword.value});
  if(error)return note(authMessage(error,'login'),true);location.replace(destination('/mis-mascotas'))}
  catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}finally{busy(loginForm,false,'')}
});
recoverRequestForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();busy(recoverRequestForm,true,'Enviando…');
  try{await sendRecoveryCode(recoverEmail.value.trim())}
  catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}finally{busy(recoverRequestForm,false,'')}
});
recoverVerifyForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();const email=recoverVerifyEmail.value.trim(),token=recoverCode.value.trim();
  if(!/^\d{8}$/.test(token))return note('Ingresá el código de 8 dígitos.',true);
  busy(recoverVerifyForm,true,'Confirmando…');
  try{
    const {error}=await supabase.auth.verifyOtp({email,token,type:'recovery'});
    if(error)return note(authMessage(error,'recover-verify'),true);
    sessionStorage.removeItem('trackmypetRecoverEmail');sessionStorage.removeItem('trackmypetRecoverResendAt');
    location.replace('/restablecer-clave');
  }catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}finally{busy(recoverVerifyForm,false,'')}
});
recoverResendBtn?.addEventListener('click',async()=>{
  recoverResendBtn.disabled=true;recoverResendBtn.textContent='Enviando…';
  try{await sendRecoveryCode(recoverVerifyEmail.value.trim())}
  catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}
  finally{recoverResendBtn.textContent='Reenviar código';updateRecoveryCooldown()}
});
resetForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();
  if(resetPassword.value!==resetPasswordConfirm.value)return note('Las contraseñas no coinciden.',true);
  busy(resetForm,true,'Guardando…');
  try{const {error}=await supabase.auth.updateUser({password:resetPassword.value});
  if(error)return note(authMessage(error,'reset'),true);await supabase.auth.signOut();note('Contraseña actualizada. Ya podés iniciar sesión.');setTimeout(()=>location.replace('/iniciar-sesion'),1200)}
  catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}finally{busy(resetForm,false,'')}
});
addTagBtn?.addEventListener('click',()=>claimForm.classList.contains('hidden')?openAddTag():showClaim(false));
cancelClaimBtn?.addEventListener('click',()=>{claimForm.reset();showClaim(false)});
logoutBtn?.addEventListener('click',async()=>{const {error}=await supabase.auth.signOut();if(error)return note('No se pudo cerrar la sesión. Intentá nuevamente.',true);sessionStorage.removeItem('trackmypetPendingTag');location.replace('/iniciar-sesion')});
claimForm?.addEventListener('submit',async e=>{
  e.preventDefault();clearNote();busy(claimForm,true,'Verificando TAG…');const {data:{session}}=await supabase.auth.getSession();
  if(!session){busy(claimForm,false,'');return location.replace(destination('/iniciar-sesion'))}
  try{const code=claimCode.value.trim(),response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'claim',code,pin:claimPin.value})}),json=await response.json();
    if(!response.ok)return note(json.error||'No se pudo vincular el TAG.',true);
    const tag=pendingTag();claimForm.reset();
    if(tag===code){sessionStorage.removeItem('trackmypetPendingTag');location.replace('/'+encodeURIComponent(code)+'?'+(json.data.active?'account-edit':'account-activate')+'=1');return}
    note(json.data.alreadyLinked?'Este TAG ya estaba vinculado a tu cuenta.':'TAG vinculado correctamente.');await loadPets(session)
  }catch{note('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',true)}finally{busy(claimForm,false,'')}
});
setup().catch(error=>note(error.message,true));
