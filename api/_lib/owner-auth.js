class OwnerAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authConfig(env = process.env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
    throw new OwnerAuthError(503, 'El servicio de cuentas está temporalmente no disponible.');
  }
  return { url, publishableKey };
}

function bearerToken(req) {
  const value = req.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) {
    throw new OwnerAuthError(401, 'Iniciá sesión para continuar.');
  }
  const token = value.slice(7);
  if (!token || token.length > 4096 || /\s/.test(token)) {
    throw new OwnerAuthError(401, 'La sesión no es válida. Volvé a iniciar sesión.');
  }
  return token;
}

async function verifiedOwner(req, { env = process.env, fetcher = globalThis.fetch } = {}) {
  if (env.TRACKMYPET_ACCOUNTS_ENABLED !== 'true') {
    throw new OwnerAuthError(404, 'La función de cuentas todavía no está habilitada.');
  }
  const { url, publishableKey } = authConfig(env);
  const response = await fetcher(url + '/auth/v1/user', {
    method: 'GET',
    headers: { apikey: publishableKey, Authorization: 'Bearer ' + bearerToken(req) },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new OwnerAuthError(401, 'La sesión venció. Volvé a iniciar sesión.');
  const user = await response.json();
  if (!user || typeof user.id !== 'string' || !user.email_confirmed_at) {
    throw new OwnerAuthError(403, 'Confirmá tu email antes de administrar TAGs.');
  }
  return user;
}

module.exports = { OwnerAuthError, authConfig, bearerToken, verifiedOwner };

