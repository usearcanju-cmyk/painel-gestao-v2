// GET /api/frete?de=&ate=
// Custo real de envio por pedido, direto da Nuvemshop (o que a loja paga, não o que o cliente paga).
// Se um dia você quiser puxar da transportadora, troque só o corpo deste arquivo.
import { cors, autorizado, periodo, erro, pedidosNuvemshop, pedidoValido } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!autorizado(req)) return erro(res, 401, 'Chave de acesso inválida.');

  const { de, ate } = periodo(req);
  try {
    const pedidos = (await pedidosNuvemshop(de, ate)).filter(pedidoValido);

    const dados = pedidos
      .map((p) => {
        const custo = Number(p.shipping_cost_owner);
        if (!custo) return null;
        return {
          id: 'frete-' + p.id,
          data: String(p.created_at || '').slice(0, 10),
          valor: custo,
          pedido: String(p.number || p.id),
          categoria: 'Frete de envio',
          descricao: 'Frete pedido ' + (p.number || p.id)
        };
      })
      .filter(Boolean);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json(dados);
  } catch (e) {
    erro(res, 502, e.message);
  }
}
