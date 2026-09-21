// GET /api/criativos?de=&ate=
// Desempenho de cada anúncio (criativo) na Meta no período, com miniatura.
import { cors, autorizado, periodo, erro } from './_lib.js';

const VERSAO = 'v21.0';
const COMPRA = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const CARRINHO = ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'];

function acha(lista, tipos) {
  if (!Array.isArray(lista)) return 0;
  for (const t of tipos) {
    const a = lista.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

async function tudo(url) {
  const linhas = [];
  for (let i = 0; i < 20 && url; i++) {
    const r = await fetch(url);
    const json = await r.json();
    if (json.error) throw new Error('Meta: ' + json.error.message);
    if (Array.isArray(json.data)) linhas.push(...json.data);
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return linhas;
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

  try {
    const params = new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,cpm,actions,action_values,video_thruplay_watched_actions',
      time_range: JSON.stringify({ since: de, until: ate }),
      limit: '500',
      access_token: token
    });
    const linhas = await tudo('https://graph.facebook.com/' + VERSAO + '/' + act + '/insights?' + params);

    // miniatura, status e data de criação, em lotes de 50
    const ids = [...new Set(linhas.map((l) => l.ad_id))];
    const extra = {};
    for (let i = 0; i < ids.length; i += 50) {
      const q = new URLSearchParams({
        ids: ids.slice(i, i + 50).join(','),
        fields: 'effective_status,created_time,creative{thumbnail_url,image_url}',
        access_token: token
      });
      const r = await fetch('https://graph.facebook.com/' + VERSAO + '/?' + q);
      const json = await r.json();
      if (json && !json.error) Object.assign(extra, json);
    }

    const dados = linhas.map((l) => {
      const ex = extra[l.ad_id] || {};
      const cr = ex.creative || {};
      const imp = Number(l.impressions) || 0;
      return {
        id: l.ad_id,
        nome: l.ad_name || 'Sem nome',
        conjunto: l.adset_name || '',
        campanha: l.campaign_name || '',
        gasto: Number(l.spend) || 0,
        impressoes: imp,
        alcance: Number(l.reach) || 0,
        frequencia: Number(l.frequency) || 0,
        cliques: Number(l.inline_link_clicks) || 0,
        cpm: Number(l.cpm) || 0,
        views3s: acha(l.actions, ['video_view']),
        thruplay: acha(l.video_thruplay_watched_actions, ['video_view']),
        carrinho: acha(l.actions, CARRINHO),
        compras: acha(l.actions, COMPRA),
        receita: acha(l.action_values, COMPRA),
        status: ex.effective_status || '',
        criado: (ex.created_time || '').slice(0, 10),
        miniatura: cr.thumbnail_url || cr.image_url || ''
      };
    }).filter((d) => d.gasto > 0);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.status(200).json({ de, ate, conta: act.replace('act_', ''), dados });
  } catch (e) {
    erro(res, 502, e.message);
  }
}
