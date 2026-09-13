const { OwnerAuthError, authConfig } = require('./_lib/owner-auth');

function createHandler({ env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => res.status(status).json(body);
    try {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        throw new OwnerAuthError(405, 'Método no permitido.');
      }
      if (env.TRACKMYPET_ACCOUNTS_ENABLED !== 'true') {
        throw new OwnerAuthError(404, 'La función de cuentas todavía no está habilitada.');
      }
      const { url, publishableKey } = authConfig(env);
      return send(200, { supabaseUrl: url, supabasePublishableKey: publishableKey });
    } catch (error) {
      return send(error.status || 503, {
        error: error instanceof OwnerAuthError ? error.message : 'No se pudo conectar. Intentá nuevamente.'
      });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

