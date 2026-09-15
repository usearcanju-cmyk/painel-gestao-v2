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
      // valor = o que o cliente realmente pagou pelos produtos, JÁ com desconto e promoção,
      // menos o frete. Nunca usar `subtotal`: na Nuvemshop ele vem antes do desconto,
      // e uma promoção faria o painel registrar mais receita do que entrou.
      const total = Number(p.total) || 0;
      const produtos = Math.max(0, total - freteCobrado);
      // guardado só para o painel mostrar a conta; não entra em nenhum cálculo
      const bruto = Number(p.subtotal) || 0;
      const desconto = Number(p.discount) || Number(p.promotional_discount) ||
        Math.max(0, bruto + freteCobrado - total);
      const endereco = p.shipping_address || {};
      return {
        id: String(p.id),
        data: String(p.created_at || p.completed_at || '').slice(0, 10),
        valor: produtos,
        valorBruto: bruto,
        desconto,
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
