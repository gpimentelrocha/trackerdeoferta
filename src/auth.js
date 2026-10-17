import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
const digest = text => createHash('sha256').update(String(text)).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const COOKIE = 'radar_session';
const MAX_AGE = 7 * 24 * 60 * 60;

export function createAuth({ password = process.env.TRACKER_PASSWORD, sessionSecret = process.env.SESSION_SECRET, cronSecret = process.env.CRON_SECRET, required = false, secure = required } = {}) {
  if ((required || password) && (!password || password.length < 16 || !sessionSecret || sessionSecret.length < 32)) {
    throw new Error('Configure TRACKER_PASSWORD (16+ caracteres) e SESSION_SECRET (32+ caracteres).');
  }
  if (required && (!cronSecret || cronSecret.length < 32)) throw new Error('Configure CRON_SECRET (32+ caracteres).');
  const enabled = Boolean(password);
  const signature = payload => createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  function authenticated(req) {
    if (!enabled) return true;
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!cookie) return false;
    const [payload, sig, extra] = cookie.split('.');
    if (!payload || !sig || extra || !equal(sig, signature(payload))) return false;
    const expires = Number(payload);
    const now = Math.floor(Date.now() / 1000);
    return Number.isSafeInteger(expires) && expires > now && expires <= now + MAX_AGE;
  }
  return (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store');
    if (req.path === '/api/health') return next();
    if (req.path === '/api/session' && req.method === 'GET') return res.json({ required: enabled, authenticated: authenticated(req) });
    if (req.path === '/api/login' && req.method === 'POST') {
      if (!enabled || equal(req.body?.password || '', password)) {
        if (enabled) {
          const payload = String(Math.floor(Date.now() / 1000) + MAX_AGE);
          res.set('Set-Cookie', `${COOKIE}=${payload}.${signature(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`);
        }
        return res.json({ authenticated: true });
      }
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    if (req.path === '/api/cron') {
      if (!cronSecret || !equal(req.get('authorization') || '', 'Bearer ' + cronSecret)) return res.status(401).json({ error: 'Não autorizado.' });
      return next();
    }
    if (!authenticated(req)) return res.status(401).json({ error: 'Entre com sua senha para continuar.' });
    if (req.path === '/api/logout' && req.method === 'POST') {
      res.set('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
      return res.status(204).end();
    }
    next();
  };
}
