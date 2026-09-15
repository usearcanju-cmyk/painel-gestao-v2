// GET /api/ads?de=&ate=
// Gasto, compras e receita por campanha e por dia, na Meta.
import { cors, autorizado, periodo, erro } from './_lib.js';

const VERSAO = 'v21.0';
const COMPRA = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

function somaAcao(lista) {
  if (!Array.isArray(lista)) return 0;
  const achou = lista.find((a) => COMPRA.includes(a.action_type));
  return achou ? Number(achou.value) || 0 : 0;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!autorizado(req)) return erro(res, 401, 'Chave de acesso inválida.');

  const conta = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_TOKEN;
  if (!conta || !token) return erro(res, 500, 'META_AD_ACCOUNT_ID ou META_TOKEN não configurados na Vercel.');

  const { de, ate } = periodo(req);
  const act = conta.startsWith('act_') ? conta : 'act_' + conta;

  const params = new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    fields: 'campaign_id,campaign_name,spend,actions,action_values,clicks,impressions',
    time_range: JSON.stringify({ since: de, until: ate }),
    limit: '500',
    access_token: token
  });

  try {
    let url = 'https://graph.facebook.com/' + VERSAO + '/' + act + '/insights?' + params;
    const linhas = [];

    for (let i = 0; i < 20 && url; i++) {
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) throw new Error('Meta: ' + json.error.message);
      if (Array.isArray(json.data)) linhas.push(...json.data);
      url = json.paging && json.paging.next ? json.paging.next : null;
    }

    const dados = linhas.map((l) => ({
      id: 'ads-' + l.date_start + '-' + l.campaign_id,
      data: l.date_start,
      valor: Number(l.spend) || 0,
      campanha: l.campaign_name || 'Sem nome',
      compras: somaAcao(l.actions),
      valorCompras: somaAcao(l.action_values),
      cliques: Number(l.clicks) || 0,
      impressoes: Number(l.impressions) || 0
    })).filter((d) => d.valor > 0);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.status(200).json(dados);
  } catch (e) {
    erro(res, 502, e.message);
  }
}
