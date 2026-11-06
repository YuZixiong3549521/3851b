export function productionConfig(env = process.env) {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET'];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const origin = env.WEB_ORIGIN || (env.WEBSITE_HOSTNAME ? `https://${env.WEBSITE_HOSTNAME}` : '');
  let url;
  try { url = new URL(origin); } catch { throw new Error('Set WEB_ORIGIN to the public HTTPS website origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('WEB_ORIGIN must be an HTTPS origin without a path, credentials or query.');
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid TCP port.`);
    return value;
  };
  const ports = { port: port('PORT', 8080), apiPort: port('API_PORT', 3001), webPort: port('WEB_PORT', 3000) };
  if (new Set(Object.values(ports)).size !== 3) throw new Error('PORT, API_PORT and WEB_PORT must be different.');
  return { ...ports, origin: url.origin };
}
