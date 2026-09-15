// Proteção de verdade: a senha é conferida no servidor, antes de qualquer arquivo sair da Vercel.
// Sem ela, ninguém vê nem o painel nem o conector.
export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };

export default function middleware(req) {
  const usuario = process.env.PAINEL_USUARIO || 'arcanju';
  const senha = process.env.PAINEL_SENHA;
  if (!senha) return; // sem senha configurada, não bloqueia (útil em preview)

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    const [u, s] = atob(auth.slice(6)).split(':');
    if (u === usuario && s === senha) return;
  }

  return new Response('Acesso restrito.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Painel do Gestor", charset="UTF-8"' }
  });
}
