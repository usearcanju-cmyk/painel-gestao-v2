// Funções compartilhadas pelo conector do Painel do Gestor.
// Nada aqui vai para o navegador: tokens ficam só nas variáveis de ambiente da Vercel.

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-arcanju-key, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

// Chave simples só para dificultar chamadas de terceiros.
// A proteção real de acesso é o middleware.js (senha no servidor).
export function autorizado(req) {
  const esperada = process.env.APP_KEY;
  if (!esperada) return true;
  return req.headers['x-arcanju-key'] === esperada;
}

export function periodo(req) {
  const hoje = new Date().toISOString().slice(0, 10);
  const de = (req.query.de || hoje.slice(0, 8) + '01').slice(0, 10);
  const ate = (req.query.ate || hoje).slice(0, 10);
  return { de, ate };
}

export function erro(res, status, mensagem) {
  res.status(status).json({ erro: mensagem });
}

// Busca todas as páginas de pedidos pagos da Nuvemshop no período.
export async function pedidosNuvemshop(de, ate) {
  const loja = process.env.NUVEMSHOP_STORE_ID;
  const token = process.env.NUVEMSHOP_TOKEN;
  if (!loja || !token) throw new Error('NUVEMSHOP_STORE_ID ou NUVEMSHOP_TOKEN não configurados na Vercel.');

  const headers = {
    Authentication: 'bearer ' + token,
    'User-Agent': 'Painel do Gestor Use Arcanju (contato@usearcanju.com.br)',
    'Content-Type': 'application/json'
  };

  const todos = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
    const url = 'https://api.tiendanube.com/v1/' + loja + '/orders'
      + '?created_at_min=' + de + 'T00:00:00-03:00'
      + '&created_at_max=' + ate + 'T23:59:59-03:00'
      + '&per_page=200&page=' + pagina;

    const r = await fetch(url, { headers });
    if (r.status === 404) break;
    if (!r.ok) throw new Error('Nuvemshop respondeu ' + r.status + ': ' + (await r.text()).slice(0, 200));

    const lote = await r.json();
    if (!Array.isArray(lote) || lote.length === 0) break;
    todos.push(...lote);
    if (lote.length < 200) break;
  }
  return todos;
}

export function pedidoValido(p) {
  const cancelado = p.status === 'cancelled' || p.cancelled_at;
  const pago = p.payment_status === 'paid' || p.payment_status === 'authorized';
  return pago && !cancelado;
}

export function pecasDoPedido(p) {
  if (!Array.isArray(p.products)) return 0;
  return p.products.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
}
