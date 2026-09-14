const FIELDS = 'codigo,nombre,zona,foto1,zona_perdida,mensaje_perdida,updated_at';

function config(env = process.env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
    throw new Error('configuration');
  }
  return { url, key };
}

function safeLimit(value) {
  const limit = Number(value || 30);
  return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 60) : 30;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  if (process.env.TRACKMYPET_LOST_STATUS_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Esta página todavía no está disponible.' });
  }

  try {
    const { url, key } = config();
    const endpoint = new URL('/rest/v1/tags', url);
    endpoint.searchParams.set('activo', 'eq.true');
    endpoint.searchParams.set('perdida', 'eq.true');
    endpoint.searchParams.set('select', FIELDS);
    endpoint.searchParams.set('order', 'updated_at.desc');
    endpoint.searchParams.set('limit', String(safeLimit(new URL(req.url, 'https://trackmypet.uy').searchParams.get('limit'))));

    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('database');

    const rows = await response.json();
    const data = rows.map(tag => ({
      codigo: tag.codigo,
      nombre: tag.nombre || 'Mascota sin nombre',
      zona: tag.zona_perdida || tag.zona || null,
      mensaje: tag.mensaje_perdida || null,
      foto: tag.foto1 || null,
      updated_at: tag.updated_at || null,
    }));
    return res.status(200).json({ data });
  } catch {
    return res.status(503).json({ error: 'No se pudo cargar las mascotas perdidas. Intentá nuevamente.' });
  }
};
