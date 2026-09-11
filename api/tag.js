const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');

const BASE_FIELDS = 'codigo,activo,nombre,sexo,telefono,zona,info,foto1,foto2,foto3,updated_at';
const LOST_FIELDS = 'perdida,zona_perdida,mensaje_perdida';
const PUBLIC_FIELDS = BASE_FIELDS + ',' + LOST_FIELDS;
const OWNER_PROFILE_FIELDS = 'especie,raza,fecha_nacimiento,info_medica';
const BUCKET = 'pet-photos';
const MAX_IMAGE = 512 * 1024;
const MAX_BODY = 750 * 1024;
const SESSION_SECONDS = 30 * 60;

class ApiError extends Error {
  constructor(status, message, retryAfter) {
    super(message); this.status = status; this.retryAfter = retryAfter;
  }
}

function createHandler({ env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  function lostStatusEnabled() { return env.TRACKMYPET_LOST_STATUS_ENABLED === 'true'; }
  function ownerProfileEnabled() { return env.TRACKMYPET_PROFILE_FIELDS_ENABLED === 'true'; }
  function accountsEnabled() { return env.TRACKMYPET_ACCOUNTS_ENABLED === 'true'; }
  function config() {
    const url = env.SUPABASE_URL?.replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
      throw new ApiError(503, 'El servicio está temporalmente no disponible. Intentá nuevamente.');
    }
    return { url, key };
  }
  function mac(value) {
    return createHmac('sha256', config().key).update('trackmypet-pin-v1:' + value).digest('base64url');
  }
  function equal(a, b) {
    const aa = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  }
  async function db(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const { url, key } = config();
    const response = await fetcher(url + path, {
      method,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new ApiError(503, 'No se pudo completar la operación. Intentá nuevamente.');
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function getTag(code, privateFields = false) {
    const selected = BASE_FIELDS + (lostStatusEnabled() ? ',' + LOST_FIELDS : '') +
      (privateFields && ownerProfileEnabled() ? ',' + OWNER_PROFILE_FIELDS : '');
    const rows = await db('/rest/v1/tags?codigo=eq.' + encodeURIComponent(code) + '&select=' +
      (privateFields ? selected + ',id,pin' : selected) + '&limit=1');
    return rows?.[0] || null;
  }
  async function tagIsLinked(tagId) {
    if (!accountsEnabled()) return false;
    const rows = await db('/rest/v1/tag_owners?tag_id=eq.' + encodeURIComponent(tagId) + '&select=tag_id&limit=1');
    return Boolean(rows?.length);
  }
  function publicTag(tag) {
    if (!tag) return null;
    if (!tag.activo) return { codigo: tag.codigo, activo: false };
    return Object.fromEntries(PUBLIC_FIELDS.split(',').map(key =>
      [key, key === 'perdida' ? tag[key] === true : (tag[key] ?? null)]));
  }
  function ownerTag(tag) {
    const data = publicTag(tag);
    if (!data || !tag.activo || !ownerProfileEnabled()) return data;
    for (const key of OWNER_PROFILE_FIELDS.split(',')) data[key] = tag[key] ?? null;
    return data;
  }
  function fingerprint(tag) { return mac('pin:' + tag.id + ':' + tag.pin); }
  function issueSession(tag, purpose) {
    const payload = Buffer.from(JSON.stringify({ code: tag.codigo, id: tag.id, purpose,
      exp: Math.floor(now() / 1000) + SESSION_SECONDS, fp: fingerprint(tag) })).toString('base64url');
    return payload + '.' + mac('session:' + payload);
  }
  async function authorized(req, code) {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || auth.length > 2048) {
      throw new ApiError(401, 'Ingresá nuevamente el PIN para continuar.');
    }
    const parts = auth.slice(7).split('.');
    if (parts.length !== 2 || !equal(parts[1], mac('session:' + parts[0]))) {
      throw new ApiError(401, 'Ingresá nuevamente el PIN para continuar.');
    }
    let session;
    try { session = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw new ApiError(401, 'Sesión inválida.'); }
    if (session.code !== code || !Number.isFinite(session.exp) || session.exp <= now() / 1000 ||
        !['activate', 'edit'].includes(session.purpose)) throw new ApiError(401, 'Ingresá nuevamente el PIN para continuar.');
    const tag = await getTag(code, true);
    if (!tag || session.id !== tag.id || !equal(session.fp, fingerprint(tag))) {
      throw new ApiError(401, 'Ingresá nuevamente el PIN para continuar.');
    }
    if (await tagIsLinked(tag.id)) {
      throw new ApiError(409, 'Este TAG se administra desde la cuenta de su propietario.');
    }
    if ((session.purpose === 'activate') === Boolean(tag.activo)) {
      throw new ApiError(409, 'El estado del TAG cambió. Volvé a abrir la ficha.');
    }
    return { tag, session };
  }
  function checkPreview(code) {
    if (env.VERCEL_ENV === 'preview' && code !== env.TRACKMYPET_PREVIEW_TEST_CODE) {
      throw new ApiError(403, 'Esta versión de prueba permite consultar fichas, pero no modificar TAGs reales.');
    }
  }
  function photoPath(url, code) {
    if (typeof url !== 'string') return null;
    const prefix = config().url + '/storage/v1/object/public/' + BUCKET + '/';
    if (!url.startsWith(prefix)) return null;
    let path;
    try { path = decodeURIComponent(url.slice(prefix.length)); } catch { return null; }
    if (!path.startsWith(code + '/') || /[?#\\]/.test(path) || path.includes('..') || path.split('/').length !== 2) return null;
    return path;
  }
  function validateData(input, tag) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Datos inválidos.');
    const values = {};
    for (const [key, limit, required] of [['nombre',120,true],['telefono',40,true],['zona',250,false],['info',4000,false]]) {
      if (typeof input[key] !== 'string' || input[key].trim().length > limit || (required && !input[key].trim())) {
        throw new ApiError(400, 'Revisá los datos ingresados.');
      }
      values[key] = input[key].trim();
    }
    if (!['macho','hembra',''].includes(input.sexo)) throw new ApiError(400, 'Sexo inválido.');
    if (typeof input.perdida !== 'boolean') throw new ApiError(400, 'Estado de la mascota inválido.');
    if (!lostStatusEnabled()) throw new ApiError(503, 'El estado de mascota perdida todavía no está habilitado.');
    if (!ownerProfileEnabled()) throw new ApiError(503, 'Los nuevos campos del perfil todavía no están habilitados.');
    for (const [key, limit] of [['especie',80],['raza',120],['info_medica',2000]]) {
      if (typeof input[key] !== 'string' || input[key].trim().length > limit) {
        throw new ApiError(400, 'Revisá los datos del perfil.');
      }
      values[key] = input[key].trim();
    }
    if (typeof input.fecha_nacimiento !== 'string' ||
        (input.fecha_nacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(input.fecha_nacimiento))) {
      throw new ApiError(400, 'Fecha de nacimiento inválida.');
    }
    values.fecha_nacimiento = input.fecha_nacimiento || null;
    for (const [key, limit] of [['zona_perdida',250],['mensaje_perdida',1000]]) {
      if (typeof input[key] !== 'string' || input[key].trim().length > limit) {
        throw new ApiError(400, 'Revisá los datos de mascota perdida.');
      }
      values[key] = input[key].trim();
    }
    if (!Array.isArray(input.photos) || input.photos.length > 3) throw new ApiError(400, 'Fotos inválidas.');
    const old = [tag.foto1, tag.foto2, tag.foto3].filter(Boolean);
    for (const photo of input.photos) {
      // Preserve existing URLs, but new URLs must belong to this TAG's bucket folder.
      if (photo !== null && photo !== '' && !(typeof photo === 'string' &&
          photo.length <= 2048 && (old.includes(photo) || photoPath(photo, tag.codigo)))) {
        throw new ApiError(400, 'La foto no pertenece a este TAG.');
      }
    }
    if (input.updated_at !== (tag.updated_at ?? null)) throw new ApiError(409, 'Los datos cambiaron. Volvé a abrir la edición antes de guardar.');
    return { ...values, sexo: input.sexo, perdida: input.perdida, activo: true,
      foto1: input.photos[0] || null, foto2: input.photos[1] || null, foto3: input.photos[2] || null,
      updated_at: new Date(now()).toISOString() };
  }
  async function readBody(req) {
    let body = req.body;
    if (body === undefined) {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > MAX_BODY) throw new ApiError(413, 'El archivo es demasiado grande.');
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > MAX_BODY) throw new ApiError(413, 'El archivo es demasiado grande.');
      try { body = JSON.parse(body); } catch { throw new ApiError(400, 'Solicitud inválida.'); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) {
      throw new ApiError(400, 'Solicitud inválida.');
    }
    return body;
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => res.status(status).json(body);
    try {
      if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); throw new ApiError(405, 'Método no permitido.'); }
      const url = new URL(req.url, 'https://trackmypet.invalid');
      if (req.method === 'GET') {
        const code = url.searchParams.get('code');
        if (!/^[0-9]{4,10}$/.test(code || '')) throw new ApiError(400, 'Código inválido.');
        const tag = await getTag(code);
        if (!tag) throw new ApiError(404, 'Este TAG no existe o todavía no fue creado.');
        return send(200, { data: publicTag(tag) });
      }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'Formato no permitido.');
      const body = await readBody(req);
      const { code, action } = body;
      if (typeof code !== 'string' || !/^[0-9]{4,10}$/.test(code)) throw new ApiError(400, 'Código inválido.');
      if (!['verify','save','upload'].includes(action)) throw new ApiError(400, 'Acción inválida.');
      checkPreview(code);
      if (action === 'verify') {
        if (typeof body.pin !== 'string' || body.pin.length < 1 || body.pin.length > 128 || !['activate','edit'].includes(body.purpose)) {
          throw new ApiError(400, 'Revisá el PIN ingresado.');
        }
        // Vercel supplies/overwrites this header at the trusted edge. Never trust a client IP in the request body.
        const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const allowance = await db('/rest/v1/rpc/tmp_pin_attempt', { method: 'POST',
          body: { p_code: code, p_ip_hash: mac('ip:' + ip) } });
        if (!allowance?.allowed) throw new ApiError(429, 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.', allowance?.retry_after || 900);
        const tag = await getTag(code, true);
        if (!tag || !equal(mac('compare:' + body.pin.trim()), mac('compare:' + tag.pin))) throw new ApiError(401, 'PIN incorrecto o TAG inexistente.');
        if (await tagIsLinked(tag.id)) throw new ApiError(409, 'Este TAG se administra desde la cuenta de su propietario.');
        if ((body.purpose === 'activate') === Boolean(tag.activo)) throw new ApiError(409, 'El estado del TAG cambió. Volvé a abrir la ficha.');
        return send(200, { token: issueSession(tag, body.purpose), expires_in: SESSION_SECONDS,
          data: { ...ownerTag(tag), updated_at: tag.updated_at ?? null } });
      }
      const { tag } = await authorized(req, code);
      if (action === 'upload') {
        if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw new ApiError(400, 'Imagen inválida.');
        const bytes = Buffer.from(body.image, 'base64');
        if (bytes.length > MAX_IMAGE) throw new ApiError(413, 'La imagen es demasiado grande.');
        if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
          throw new ApiError(400, 'La imagen debe ser JPEG.');
        }
        const path = code + '/' + randomUUID() + '.jpeg';
        await db('/storage/v1/object/' + BUCKET + '/' + path, { method: 'POST', body: bytes, raw: true,
          headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' } });
        return send(200, { url: config().url + '/storage/v1/object/public/' + BUCKET + '/' + path });
      }
      const update = validateData(body.data, tag);
      const filter = tag.updated_at == null ? '&updated_at=is.null' : '&updated_at=eq.' + encodeURIComponent(tag.updated_at);
      const activeFilter = tag.activo ? '&activo=eq.true' : '&or=(activo.eq.false,activo.is.null)';
      const saved = await db('/rest/v1/tags?id=eq.' + encodeURIComponent(tag.id) + filter + activeFilter + '&select=' + PUBLIC_FIELDS,
        { method: 'PATCH', body: update, headers: { Prefer: 'return=representation' } });
      if (!saved?.length) throw new ApiError(409, 'Los datos cambiaron. Volvé a abrir la edición antes de guardar.');
      // Do not delete superseded images here: a concurrent editor may still refer to them.
      // Cleanup can be a separate server job after checking references and a grace period.
      return send(200, { data: publicTag(saved[0]) });
    } catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      // Never log requests, PINs, tokens, upstream errors or secret configuration.
      return send(error.status || 503, { error: error instanceof ApiError ? error.message : 'No se pudo conectar. Intentá nuevamente.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

