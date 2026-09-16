// GET /api/expedicao?de=2026-09-01&ate=2026-09-30
// Pedidos pagos com os itens de cada um, para a Logística separar, estampar e postar.
// Não altera nada na Nuvemshop: só leitura.
import { cors, autorizado, periodo, erro, pedidosNuvemshop, pedidoValido } from './_lib.js';

const ENVIADO = ['fulfilled', 'shipped', 'delivered'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!autorizado(req)) return erro(res, 401, 'Chave de acesso inválida.');

  const { de, ate } = periodo(req);
  try {
    const pedidos = (await pedidosNuvemshop(de, ate)).filter(pedidoValido);

    const dados = pedidos.map((p) => {
      const endereco = p.shipping_address || {};
      const cliente = p.customer || {};
      const envio = String(p.shipping_status || '').toLowerCase();
      const enviadoEm = String(p.shipped_at || '').slice(0, 10);
      return {
        id: String(p.id),
        numero: String(p.number || p.id),
        data: String(p.created_at || p.completed_at || '').slice(0, 10),
        cliente: String(cliente.name || endereco.name || '').split(' ')[0],
        uf: String(endereco.province || endereco.state || '').slice(0, 2).toUpperCase(),
        enviado: ENVIADO.includes(envio) || Boolean(enviadoEm),
        enviadoEm,
        itens: (Array.isArray(p.products) ? p.products : []).map((i) => ({
          nome: String(i.name || i.product_name || ''),
          variantes: Array.isArray(i.variant_values) ? i.variant_values.map(String) : [],
          quantidade: Number(i.quantity) || 0,
          sku: String(i.sku || '')
        }))
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(dados);
  } catch (e) {
    erro(res, 502, e.message);
  }
}
