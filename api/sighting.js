const { createHmac } = require('node:crypto');

class SightingError extends Error { constructor(status, message, retryAfter) { super(message); this.status=status; this.retryAfter=retryAfter; } }

function createHandler({ env=process.env, fetcher=globalThis.fetch }={}) {
  function config() {
    const url=env.SUPABASE_URL?.replace(/\/$/,''), key=env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) throw new SightingError(503,'El servicio está temporalmente no disponible.');
    return {url,key};
  }
  function mac(value) { return createHmac('sha256',config().key).update('trackmypet-sighting-v1:'+value).digest('base64url'); }
  async function db(path,{method='GET',body}={}) {
    const {url,key}=config(); const response=await fetcher(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new SightingError(503,'No pudimos guardar la ubicación. Intentá nuevamente.');
    if (response.status===204) return null; const text=await response.text(); return text?JSON.parse(text):null;
  }
  async function notifyOwner(tagId, code, latitude, longitude, reportedAt) {
    const brevoKey=env.BREVO_API_KEY, sender=env.BREVO_SENDER_EMAIL;
    if (!brevoKey || !sender) return false;
    const owners=await db('/rest/v1/tag_owners?tag_id=eq.'+encodeURIComponent(tagId)+'&select=user_id&limit=1');
    const userId=owners?.[0]?.user_id; if (!userId) return false;
    const {url,key}=config();
    const userResponse=await fetcher(url+'/auth/v1/admin/users/'+encodeURIComponent(userId),{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000)});
    if (!userResponse.ok) return false;
    const user=await userResponse.json(); const recipient=user?.email;
    if (typeof recipient!=='string' || !recipient.includes('@')) return false;
    const maps='https://www.google.com/maps?q='+encodeURIComponent(latitude+','+longitude);
    const emailResponse=await fetcher('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':brevoKey,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:sender,name:'TrackMyPet'},to:[{email:recipient}],subject:'Nuevo avistamiento de tu mascota',htmlContent:'<p>Alguien abrió la ficha de tu mascota marcada como perdida y compartió su ubicación.</p><p><strong>Fecha y hora:</strong> '+new Date(reportedAt).toLocaleString('es-UY',{timeZone:'America/Montevideo'})+'</p><p><a href="'+maps+'">Ver ubicación en Google Maps</a></p>'}),signal:AbortSignal.timeout(12000)});
    return emailResponse.ok;
  }
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store, max-age=0'); res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,body)=>res.status(status).json(body);
    try {
      if (req.method!=='POST') { res.setHeader('Allow','POST'); throw new SightingError(405,'Método no permitido.'); }
      if (env.TRACKMYPET_SIGHTINGS_ENABLED!=='true') throw new SightingError(404,'Esta función todavía no está disponible.');
      if (!String(req.headers['content-type']||'').startsWith('application/json')) throw new SightingError(415,'Formato no permitido.');
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      const code=body?.code, latitude=Number(body?.latitude), longitude=Number(body?.longitude), accuracy=Number(body?.accuracy);
      if (!/^[0-9]{4,10}$/.test(code||'') || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || latitude<-90 || latitude>90 || longitude<-180 || longitude>180 || accuracy<0 || accuracy>100000) throw new SightingError(400,'Ubicación inválida.');
      const ip=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
      const allowance=await db('/rest/v1/rpc/tmp_sighting_attempt',{method:'POST',body:{p_code:code,p_ip_hash:mac('ip:'+ip)}});
      if (!allowance?.allowed) throw new SightingError(429,'Ya recibimos una ubicación recientemente. Gracias por ayudar.',allowance?.retry_after||900);
      const tags=await db('/rest/v1/tags?codigo=eq.'+encodeURIComponent(code)+'&select=id,activo,perdida&limit=1'); const tag=tags?.[0];
      if (!tag || tag.activo!==true || tag.perdida!==true) throw new SightingError(409,'Esta mascota ya no está reportada como perdida.');
      const reportedAt=new Date().toISOString();
      await db('/rest/v1/tag_sightings',{method:'POST',body:{tag_id:tag.id,reported_at:reportedAt,latitude,longitude,accuracy_meters:accuracy}});
      let ownerNotified=false;
      try { ownerNotified=await notifyOwner(tag.id,code,latitude,longitude,reportedAt); } catch (_) { /* el avistamiento ya quedó guardado */ }
      return send(201,{data:{saved:true,ownerNotified}});
    } catch (error) { if (error.retryAfter) res.setHeader('Retry-After',String(error.retryAfter)); return send(error.status||503,{error:error instanceof SightingError?error.message:'No pudimos guardar la ubicación. Intentá nuevamente.'}); }
  };
}
module.exports=createHandler(); module.exports.createHandler=createHandler;
