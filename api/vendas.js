// GET /api/vendas?de=2026-09-01&ate=2026-09-30
// Devolve um item por pedido pago da Nuvemshop.
import { cors, autorizado, periodo, erro, pedidosNuvemshop, pedidoValido, pecasDoPedido } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!autorizado(req)) return erro(res, 401, 'Chave de acesso inválida.');

  const { de, ate } = periodo(req);
  try {
    const pedidos = (await pedidosNuvemshop(de, ate)).filter(pedidoValido);

    const dados = pedidos.map((p) => {
      const freteCobrado = Number(p.shipping_cost_customer) || 0;
      // valor = só produtos. O frete cobrado vai separado: é receita, mas não é venda de camiseta.
      const produtos = Number(p.subtotal) || Math.max(0, (Number(p.total) || 0) - freteCobrado);
      const endereco = p.shipping_address || {};
      return {
        id: String(p.id),
        data: String(p.created_at || p.completed_at || '').slice(0, 10),
        valor: produtos,
        freteCobrado,
        uf: String(endereco.province || endereco.state || '').slice(0, 2).toUpperCase(),
        pedidos: 1,
        camisetas: pecasDoPedido(p),
        canal: 'Loja (Nuvemshop)',
        status: 'pago',
        referencia: String(p.number || p.id)
      };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json(dados);
  } catch (e) {
    erro(res, 502, e.message);
  }
}
