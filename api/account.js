const { createHmac, timingSafeEqual } = require('node:crypto');
const { OwnerAuthError, verifiedOwner } = require('./_lib/owner-auth');

const PUBLIC_FIELDS = 'codigo,activo,nombre,sexo,telefono,zona,info,foto1,foto2,foto3,updated_at,perdida,zona_perdida,mensaje_perdida';
const PRIVATE_FIELDS = 'especie,raza,fecha_nacimiento,info_medica';
const MAX_BODY = 16 * 1024;

class AccountError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function createHandler({ env = process.env, fetcher = globalThis.fetch } = {}) {
  function config() {
    const url = env.SUPABASE_URL?.replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
      throw new AccountError(503, 'El servicio está temporalmente no disponible.');
    }
    return { url, key };
  }
  function mac(value) {
    return createHmac('sha256', config().key).update('trackmypet-pin-v1:' + value).digest('base64url');
  }
  function equal(a, b) {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  }
  async function db(path, { method = 'GET', body, allowConflict = false } = {}) {
    const { url, key } = config();
    const response = await fetcher(url + path, {
      method,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (allowConflict && response.status === 409) return { conflict: true, data: null };
    if (!response.ok) throw new AccountError(503, 'No se pudo completar la operación. Intentá nuevamente.');
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function readBody(req) {
    let body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > MAX_BODY) throw new AccountError(413, 'Solicitud demasiado grande.');
      try { body = JSON.parse(body); } catch { throw new AccountError(400, 'Solicitud inválida.'); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) {
      throw new AccountError(400, 'Solicitud inválida.');
    }
    return body;
  }
  async function ownerRows(userId) {
    const select = 'claimed_at,tags(' + PUBLIC_FIELDS + ',' + PRIVATE_FIELDS + ')';
    return db('/rest/v1/tag_owners?user_id=eq.' + encodeURIComponent(userId) + '&select=' + encodeURIComponent(select) + '&order=claimed_at.asc');
  }
  async function ownership(tagId) {
    const rows = await db('/rest/v1/tag_owners?tag_id=eq.' + encodeURIComponent(tagId) + '&select=user_id&limit=1');
    return rows?.[0] || null;
  }
  function safeOwnerTag(row) {
    const tag = row?.tags;
    if (!tag) return null;
    const allowed = (PUBLIC_FIELDS + ',' + PRIVATE_FIELDS).split(',');
    return { claimed_at: row.claimed_at, ...Object.fromEntries(allowed.map(key => [key, tag[key] ?? null])) };
  }
  function photoPath(url, code) {
    const prefix = config().url + '/storage/v1/object/public/pet-photos/';
    if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
    let path;
    try { path = decodeURIComponent(url.slice(prefix.length)); } catch { return null; }
    if (!path.startsWith(code + '/') || /[?#\\]/.test(path) || path.includes('..') || path.split('/').length !== 2) return null;
    return path;
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => res.status(status).json(body);
    try {
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        throw new AccountError(405, 'Método no permitido.');
      }
      const user = await verifiedOwner(req, { env, fetcher });
      if (req.method === 'GET') {
        const rows = await ownerRows(user.id);
        return send(200, { data: (rows || []).map(safeOwnerTag).filter(Boolean) });
      }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new AccountError(415, 'Formato no permitido.');
      }
      const body = await readBody(req);
      const validCode = typeof body.code === 'string' && /^[0-9]{4,10}$/.test(body.code);
      const pinOnlyClaim = body.action === 'claim' && (body.code === '' || body.code == null);
      if (!['claim', 'unlink'].includes(body.action) || (!validCode && !pinOnlyClaim) ||
          typeof body.pin !== 'string' || body.pin.length < 1 || body.pin.length > 128) {
        throw new AccountError(400, 'Revisá el código y el PIN ingresados.');
      }
      const submittedPin = body.pin.trim();
      const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const allowance = await db('/rest/v1/rpc/tmp_pin_attempt', {
        method: 'POST', body: { p_code: validCode ? body.code : 'pin:' + mac('lookup:' + submittedPin), p_ip_hash: mac('ip:' + ip) }
      });
      // Límite temporalmente suspendido para pruebas; la validación real del PIN permanece activa.
      if (!allowance?.allowed) {
        throw new AccountError(429, 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.', allowance?.retry_after || 900);
      }
      const tags = validCode
        ? await db('/rest/v1/tags?codigo=eq.' + encodeURIComponent(body.code) + '&select=id,codigo,pin,activo&limit=1')
        : await db('/rest/v1/rpc/tmp_tag_by_pin', { method: 'POST', body: { p_pin: submittedPin } });
      if (!validCode && tags?.length > 1) {
        throw new AccountError(409, 'Ese PIN corresponde a más de un TAG. Contactanos para vincularlo de forma segura.');
      }
      const tag = tags?.[0];
      if (!tag || (validCode && !equal(mac('compare:' + submittedPin), mac('compare:' + tag.pin)))) {
        throw new AccountError(401, 'PIN incorrecto. Revisalo e intentá nuevamente.');
      }
      const current = await ownership(tag.id);
      if (body.action === 'unlink') {
        if (!current) throw new AccountError(409, 'Este TAG ya no está vinculado a ninguna cuenta.');
        if (current.user_id !== user.id) throw new AccountError(403, 'No tenés permiso para desvincular este TAG.');
        const reset = await db('/rest/v1/rpc/tmp_reset_tag', {
          method: 'POST', body: { p_tag_id: tag.id, p_user_id: user.id }
        });
        const resetRow = reset?.[0];
        if (!resetRow) throw new AccountError(409, 'El vínculo cambió. Actualizá la página e intentá nuevamente.');
        for (const photo of [resetRow.foto1, resetRow.foto2, resetRow.foto3]) {
          const path = photoPath(photo, tag.codigo);
          if (path) await db('/storage/v1/object/pet-photos/' + path, { method: 'DELETE' });
        }
        return send(200, { data: { code: tag.codigo, reset: true } });
      }
      if (current?.user_id === user.id) return send(200, { data: { code: tag.codigo, active: tag.activo === true, alreadyLinked: true } });
      if (current) throw new AccountError(409, 'Este TAG ya está vinculado a otra cuenta.');
      const inserted = await db('/rest/v1/tag_owners', {
        method: 'POST', body: { tag_id: tag.id, user_id: user.id }, allowConflict: true
      });
      if (inserted?.conflict) throw new AccountError(409, 'Este TAG ya está vinculado a otra cuenta.');
      return send(201, { data: { code: tag.codigo, active: tag.activo === true, alreadyLinked: false } });
    } catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      const known = error instanceof AccountError || error instanceof OwnerAuthError;
      return send(error.status || 503, { error: known ? error.message : 'No se pudo conectar. Intentá nuevamente.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

