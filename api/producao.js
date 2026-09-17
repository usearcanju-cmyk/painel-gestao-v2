// /api/producao — portal da produção.
// Guarda ordens de serviço, equipe, guia do dia e avisos no Upstash Redis.
// Duas portas:
//   · funcionário: entra com PIN e só vê e marca as tarefas da produção;
//   · painel (e Lazarus): usa a APP_KEY para enviar ordens, equipe e guia.
// Nada de financeiro passa por aqui.
import crypto from 'node:crypto';
import { pedidosNuvemshop, pedidoValido } from './_lib.js';

const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ETAPAS = ['separar', 'prensar', 'conferir', 'embalar', 'etiqueta', 'expedir'];
const MODOS = ['arcanju', 'lazarus'];

const TAMS = ['PP', 'P', 'M', 'G', 'GG', 'XG'];
const UFS = {'são paulo':'SP','minas gerais':'MG','rio de janeiro':'RJ','bahia':'BA','paraná':'PR','rio grande do sul':'RS','pernambuco':'PE','ceará':'CE','pará':'PA','santa catarina':'SC','goiás':'GO','maranhão':'MA','paraíba':'PB','amazonas':'AM','espírito santo':'ES','mato grosso':'MT','rio grande do norte':'RN','piauí':'PI','alagoas':'AL','distrito federal':'DF','mato grosso do sul':'MS','sergipe':'SE','rondônia':'RO','tocantins':'TO','acre':'AC','amapá':'AP','roraima':'RR'};
const NOMES_COR = { OFF: 'Off-white', PRETO: 'Preto', BRANCA: 'Branca', AZUL: 'Azul' };
function sigla(uf) {
  const t = String(uf || '').trim();
  if (t.length === 2) return t.toUpperCase();
  return UFS[t.toLowerCase()] || t.slice(0, 20);
}
function lerProduto(nome, variantes) {
  nome = String(nome || '');
  const up = nome.toUpperCase();
  if (!/CAMISETA|BLUSA|BABY|T-SHIRT/.test(up)) return null;
  const m = nome.match(/\(([^()]*)\)\s*$/);
  const partes = (m ? m[1].split(',') : []).concat(variantes || []).map((x) => String(x).trim()).filter(Boolean);
  const tam = partes.find((x) => TAMS.includes(x.toUpperCase()));
  if (!tam) return null;
  const low = partes.map((x) => x.toLowerCase());
  const baby = /BABY|FEMININ/.test(up) || low.some((x) => ['acólita', 'acolita', 'feminina', 'baby look'].includes(x));
  const cv = low.join(' ');
  let cor = '?';
  if (/bege|off/.test(cv)) cor = 'OFF'; else if (/pret/.test(cv)) cor = 'PRETO'; else if (/branc/.test(cv)) cor = 'BRANCA'; else if (/azul/.test(cv)) cor = 'AZUL';
  else if (/OFF-WHITE|OFF WHITE/.test(up)) cor = 'OFF'; else if (/PRETA|PRETO/.test(up)) cor = 'PRETO'; else if (/AZUL/.test(up)) cor = 'AZUL'; else if (/BRANCA/.test(up)) cor = 'BRANCA';
  const base = m ? nome.slice(0, m.index).trim() : nome;
  let estampa = base.includes(' - ') ? base.slice(base.indexOf(' - ') + 3) : base;
  estampa = estampa.replace(/["“”]/g, '').replace(/\s+FT\..*$/i, '').trim().toUpperCase();
  return { estampa, cor, corNome: NOMES_COR[cor] || cor, mod: baby ? 'Baby look' : 'Tradicional', tam: tam.toUpperCase() };
}
function somaUteis(iso, k, feriados) {
  const d = new Date(iso + 'T12:00:00Z');
  const util = (x) => { const w = x.getUTCDay(); return w !== 0 && w !== 6 && !feriados.has(x.toISOString().slice(0, 10)); };
  while (!util(d)) d.setUTCDate(d.getUTCDate() + 1);
  let c = 0;
  while (c < k) { d.setUTCDate(d.getUTCDate() + 1); if (util(d)) c++; }
  return d.toISOString().slice(0, 10);
}
function dataBR(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
}
function osDaNuvemshop(p, cfg) {
  const e = p.shipping_address || {};
  const c = p.customer || {};
  const envio = String(p.shipping_status || '').toLowerCase();
  const itens = [], outros = [];
  (Array.isArray(p.products) ? p.products : []).forEach((i) => {
    const q = Number(i.quantity) || 0;
    const v = Array.isArray(i.variant_values) ? i.variant_values.map(String) : [];
    const pr = lerProduto(i.name, v);
    if (pr) itens.push({ ...pr, qty: q });
    else outros.push({ nome: String(i.name || '').slice(0, 120), qty: q });
  });
  const data = dataBR(p.created_at);
  const loja = process.env.NUVEMSHOP_ADMIN_URL || cfg.linkNuvemshop || '';
  return {
    id: String(p.id), pedidoId: String(p.id), numero: String(p.number || p.id), data,
    cliente: String(e.name || c.name || p.contact_name || '').split(' ')[0],
    uf: sigla(e.province),
    prazo: data ? somaUteis(data, Number(cfg.prazoEnvio) || 2, new Set(String(cfg.feriados || '').match(/\d{4}-\d{2}-\d{2}/g) || [])) : '',
    itens, outros, origem: 'nuvemshop',
    link: loja ? loja.replace('{id}', String(p.id)) : '',
    destino: {
      nome: String(e.name || c.name || p.contact_name || ''),
      telefone: String(e.phone || p.contact_phone || c.phone || ''),
      endereco: String(e.address || ''), numero: String(e.number || ''), complemento: String(e.floor || ''),
      bairro: String(e.locality || ''), cidade: String(e.city || ''), uf: sigla(e.province), cep: String(e.zipcode || ''),
      envio: String(p.shipping_option || (p.shipping_option_reference || '') || p.shipping || ''),
      rastreio: String(p.shipping_tracking_number || ''), nota: String(p.note || '')
    },
    enviado: ['fulfilled', 'shipped', 'delivered'].includes(envio) || Boolean(p.shipped_at)
  };
}

function headers(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-arcanju-key, x-prod-token, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}
function falha(res, status, msg) { res.status(status).json({ erro: msg }); }

async function redis(...cmd) {
  const r = await fetch(RURL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RTOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error('Banco de dados: ' + j.error);
  return j.result;
}
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(RURL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RTOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map((x) => x.result);
}
const ler = (v, padrao) => { try { return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
function hashObj(arr) { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; }

function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function agoraBR() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date());
}
function hashPin(pin) {
  const sal = process.env.APP_KEY || 'arcanju';
  return crypto.createHash('sha256').update(sal + ':' + String(pin)).digest('hex');
}
function chaveOk(req) {
  const esperada = process.env.APP_KEY;
  return Boolean(esperada) && req.headers['x-arcanju-key'] === esperada;
}
function ip(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sem-ip';
}
async function sessao(req) {
  const t = String(req.headers['x-prod-token'] || '');
  if (!/^[a-f0-9]{40}$/.test(t)) return null;
  return ler(await redis('GET', 'prod:sessao:' + t), null);
}
function limparOS(o, modo) {
  const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
  const d = o.destino && typeof o.destino === 'object' ? o.destino : null;
  return {
    pedidoId: txt(o.pedidoId, 60), data: txt(o.data, 10), link: txt(o.link, 300), origem: txt(o.origem, 20),
    destino: d ? {
      nome: txt(d.nome, 120), telefone: txt(d.telefone, 40), endereco: txt(d.endereco, 160), numero: txt(d.numero, 20),
      complemento: txt(d.complemento, 120), bairro: txt(d.bairro, 80), cidade: txt(d.cidade, 80), uf: txt(d.uf, 20),
      cep: txt(d.cep, 12), envio: txt(d.envio, 160), rastreio: txt(d.rastreio, 60), nota: txt(d.nota, 500)
    } : null,
    outros: (Array.isArray(o.outros) ? o.outros : []).slice(0, 20).map((x) => ({ nome: txt(x.nome, 120), qty: Math.max(0, Math.min(99, Number(x.qty) || 0)) })),
    id: txt(o.id, 60), modo, numero: txt(o.numero, 30), cliente: txt(o.cliente, 40), uf: txt(o.uf, 2),
    prazo: txt(o.prazo, 10), liberadoEm: txt(o.liberadoEm, 10), lote: txt(o.lote, 60), loteId: txt(o.loteId, 60),
    obs: txt(o.obs, 200),
    itens: (Array.isArray(o.itens) ? o.itens : []).slice(0, 40).map((i) => ({
      estampa: txt(i.estampa, 80), cor: txt(i.cor, 20), corNome: txt(i.corNome, 30), mod: txt(i.mod, 20), tam: txt(i.tam, 4),
      qty: Math.max(0, Math.min(99, Number(i.qty) || 0))
    })),
    brindes: o.brindes !== false
  };
}

export default async function handler(req, res) {
  headers(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!RURL || !RTOKEN) return falha(res, 500, 'Banco de dados não configurado na Vercel (UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN).');
  const acao = String(req.query.acao || '');
  const corpo = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    /* ---------------- funcionário ---------------- */
    if (acao === 'entrar' && req.method === 'POST') {
      const chaveTent = 'prod:tent:' + ip(req);
      const tent = Number(await redis('GET', chaveTent)) || 0;
      if (tent >= 10) return falha(res, 429, 'Muitas tentativas. Espere 15 minutos.');
      const equipe = ler(await redis('GET', 'prod:equipe'), []);
      const h = hashPin(corpo.pin);
      const f = equipe.find((x) => x.ativo !== false && x.pinHash === h);
      if (!f) {
        await pipeline([['INCR', chaveTent], ['EXPIRE', chaveTent, 900]]);
        return falha(res, 401, 'PIN não encontrado.');
      }
      const token = crypto.randomBytes(20).toString('hex');
      await redis('SET', 'prod:sessao:' + token, JSON.stringify({ id: f.id, nome: f.nome }), 'EX', 60 * 60 * 16);
      return res.status(200).json({ token, nome: f.nome });
    }

    if (acao === 'sair' && req.method === 'POST') {
      const t = String(req.headers['x-prod-token'] || '');
      if (/^[a-f0-9]{40}$/.test(t)) await redis('DEL', 'prod:sessao:' + t);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'dia' && req.method === 'GET') {
      const s = await sessao(req);
      if (!s) return falha(res, 401, 'Sessão expirada. Entre de novo com o PIN.');
      const hoje = hojeBR();
      const r = await pipeline([
        ['GET', 'prod:config'], ['GET', 'prod:equipe'],
        ['HGETALL', 'prod:os:arcanju'], ['HGETALL', 'prod:os:lazarus'],
        ['HGETALL', 'prod:feito:' + hoje], ['HGETALL', 'prod:lotes:lazarus']
      ]);
      const equipe = ler(r[1], []).filter((x) => x.ativo !== false).map((x) => ({ id: x.id, nome: x.nome, dias: x.dias, inicio: x.inicio, fim: x.fim, capacidade: x.capacidade }));
      const ordens = {};
      MODOS.forEach((m, i) => { ordens[m] = Object.values(hashObj(r[2 + i])).map((v) => ler(v, null)).filter(Boolean); });
      const feitos = {};
      Object.entries(hashObj(r[4])).forEach(([k, v]) => { feitos[k] = ler(v, null); });
      const lotes = Object.values(hashObj(r[5])).map((v) => ler(v, null)).filter(Boolean);
      return res.status(200).json({ hoje, agora: agoraBR(), eu: s, config: ler(r[0], {}), equipe, ordens, feitos, lotes });
    }

    if (acao === 'etapa' && req.method === 'POST') {
      const s = await sessao(req);
      if (!s) return falha(res, 401, 'Sessão expirada. Entre de novo com o PIN.');
      const modo = MODOS.includes(corpo.modo) ? corpo.modo : null;
      const etapa = ETAPAS.includes(corpo.etapa) ? corpo.etapa : null;
      const ids = (Array.isArray(corpo.ids) ? corpo.ids : [corpo.id]).map(String).slice(0, 80);
      if (!modo || !etapa || !ids.length) return falha(res, 400, 'Pedido de atualização incompleto.');
      const atuais = await redis('HMGET', 'prod:os:' + modo, ...ids);
      const quando = new Date().toISOString();
      const cmds = [];
      const saida = [];
      ids.forEach((id, i) => {
        const o = ler(atuais[i], null);
        if (!o) return;
        o.etapas = o.etapas || {};
        const pos = ETAPAS.indexOf(etapa);
        if (corpo.feito === false) {
          ETAPAS.slice(pos).forEach((e) => { delete o.etapas[e]; });
        } else {
          ETAPAS.slice(0, pos + 1).forEach((e) => { if (!o.etapas[e]) o.etapas[e] = { em: quando, por: s.nome }; });
        }
        o.atualizado = quando;
        cmds.push(['HSET', 'prod:os:' + modo, id, JSON.stringify(o)]);
        saida.push(o);
      });
      await pipeline(cmds);
      return res.status(200).json({ ordens: saida });
    }

    if (acao === 'tarefa' && req.method === 'POST') {
      const s = await sessao(req);
      if (!s) return falha(res, 401, 'Sessão expirada. Entre de novo com o PIN.');
      const chave = String(corpo.chave || '').slice(0, 120);
      if (!chave) return falha(res, 400, 'Tarefa sem nome.');
      const k = 'prod:feito:' + hojeBR();
      if (corpo.feito === false) await redis('HDEL', k, chave);
      else await pipeline([['HSET', k, chave, JSON.stringify({ em: new Date().toISOString(), por: s.nome })], ['EXPIRE', k, 60 * 60 * 24 * 8]]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'problema' && req.method === 'POST') {
      const s = await sessao(req);
      if (!s) return falha(res, 401, 'Sessão expirada. Entre de novo com o PIN.');
      const id = crypto.randomBytes(6).toString('hex');
      const aviso = {
        id, em: new Date().toISOString(), por: s.nome,
        modo: MODOS.includes(corpo.modo) ? corpo.modo : '', os: String(corpo.os || '').slice(0, 30),
        tipo: String(corpo.tipo || 'Outro').slice(0, 60), texto: String(corpo.texto || '').slice(0, 500), resolvido: false
      };
      await redis('HSET', 'prod:avisos', id, JSON.stringify(aviso));
      return res.status(200).json({ ok: true });
    }

    if (acao === 'impressa' && req.method === 'POST') {
      const s = await sessao(req);
      if (!s && !chaveOk(req)) return falha(res, 401, 'Sessão expirada. Entre de novo com o PIN.');
      const modo = MODOS.includes(corpo.modo) ? corpo.modo : null;
      const ids = (Array.isArray(corpo.ids) ? corpo.ids : []).map(String).slice(0, 200);
      if (!modo || !ids.length) return falha(res, 400, 'Nada para marcar.');
      const atuais = await redis('HMGET', 'prod:os:' + modo, ...ids);
      const quando = new Date().toISOString();
      const cmds = [];
      ids.forEach((id, i) => { const o = ler(atuais[i], null); if (o) { o.impressaEm = quando; cmds.push(['HSET', 'prod:os:' + modo, id, JSON.stringify(o)]); } });
      await pipeline(cmds);
      return res.status(200).json({ ok: true, marcadas: cmds.length });
    }

    if (acao === 'nuvemshop') {
      /* traz os pedidos pagos da loja direto para o portal */
      const cron = process.env.CRON_SECRET
        ? req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET
        : /vercel-cron/i.test(String(req.headers['user-agent'] || ''));
      const s = cron ? null : await sessao(req);
      if (!cron && !s && !chaveOk(req)) return falha(res, 401, 'Sem permissão.');
      const forcar = chaveOk(req) && String(req.query.forcar || '') === '1';
      const ultima = Number(await redis('GET', 'prod:nuvem:ultima')) || 0;
      if (!forcar && Date.now() - ultima < 3 * 60 * 1000) return res.status(200).json({ ok: true, pulado: true });
      await redis('SET', 'prod:nuvem:ultima', String(Date.now()));
      const cfg = ler(await redis('GET', 'prod:config'), {});
      const modoImp = cfg.importar || 'auto';
      if (modoImp === 'nunca') return res.status(200).json({ ok: true, desligado: true });
      if (modoImp === 'auto') {
        const lotes = Object.values(hashObj(await redis('HGETALL', 'prod:lotes:lazarus'))).map((v) => ler(v, null)).filter(Boolean);
        const lim = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
        if (lotes.some((l) => (l.postarEm || l.recebeEm || '') >= lim)) return res.status(200).json({ ok: true, lazarusAtivo: true });
      }
      const hoje = hojeBR();
      const de = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
      const pedidos = (await pedidosNuvemshop(de, hoje)).filter(pedidoValido);
      const r = await pipeline([['HGETALL', 'prod:os:arcanju'], ['HGETALL', 'prod:os:lazarus']]);
      const atuais = hashObj(r[0]);
      const doLazarus = new Set(Object.values(hashObj(r[1])).map((v) => (ler(v, {}) || {}).pedidoId).filter(Boolean));
      const cmds = [];
      let novas = 0, atualizadas = 0, enviadas = 0;
      const quando = new Date().toISOString();
      pedidos.forEach((p) => {
        const n = osDaNuvemshop(p, cfg);
        if (doLazarus.has(n.pedidoId)) return;
        const antes = ler(atuais[n.id], null);
        if (antes) {
          let mudou = false;
          if (!antes.destino || !antes.destino.endereco) { antes.destino = n.destino; mudou = true; }
          if (!antes.link && n.link) { antes.link = n.link; mudou = true; }
          if (n.destino.rastreio && antes.destino && antes.destino.rastreio !== n.destino.rastreio) { antes.destino.rastreio = n.destino.rastreio; mudou = true; }
          if (n.enviado && !(antes.etapas && antes.etapas.expedir)) {
            antes.etapas = antes.etapas || {};
            ETAPAS.forEach((e) => { if (!antes.etapas[e]) antes.etapas[e] = { em: quando, por: 'Nuvemshop' }; });
            mudou = true; enviadas++;
          }
          if (mudou) { cmds.push(['HSET', 'prod:os:arcanju', n.id, JSON.stringify(antes)]); atualizadas++; }
          return;
        }
        if (n.enviado) return;
        const o = limparOS(n, 'arcanju');
        o.etapas = {}; o.criado = quando;
        cmds.push(['HSET', 'prod:os:arcanju', o.id, JSON.stringify(o)]);
        novas++;
      });
      await pipeline(cmds);
      return res.status(200).json({ ok: true, novas, atualizadas, enviadas, lidos: pedidos.length });
    }

    /* ---------------- painel e Lazarus (APP_KEY) ---------------- */
    if (!process.env.APP_KEY) return falha(res, 403, 'Configure a APP_KEY na Vercel para usar a produção.');
    if (!chaveOk(req)) return falha(res, 401, 'Chave de acesso inválida.');

    if (acao === 'painel' && req.method === 'GET') {
      const modos = MODOS.includes(req.query.modo) ? [req.query.modo] : MODOS;
      const cmds = modos.map((m) => ['HGETALL', 'prod:os:' + m]);
      const soArcanju = modos.length > 1;
      if (!soArcanju) cmds.push(['HGETALL', 'prod:avisos']);
      if (soArcanju) cmds.push(['GET', 'prod:equipe'], ['GET', 'prod:config'], ['HGETALL', 'prod:avisos'], ['HGETALL', 'prod:feito:' + hojeBR()]);
      const r = await pipeline(cmds);
      const ordens = {};
      modos.forEach((m, i) => { ordens[m] = Object.values(hashObj(r[i])).map((v) => ler(v, null)).filter(Boolean); });
      const out = { hoje: hojeBR(), ordens };
      if (!soArcanju) {
        out.avisos = Object.values(hashObj(r[modos.length])).map((v) => ler(v, null)).filter(Boolean)
          .filter((a) => a.modo === 'lazarus').sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 50);
      }
      if (soArcanju) {
        const n = modos.length;
        out.equipe = ler(r[n], []).map((x) => ({ ...x, pinHash: undefined, temPin: Boolean(x.pinHash) }));
        out.config = ler(r[n + 1], {});
        out.avisos = Object.values(hashObj(r[n + 2])).map((v) => ler(v, null)).filter(Boolean)
          .filter((a) => a.modo !== 'lazarus').sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 100);
        const feitos = {};
        Object.entries(hashObj(r[n + 3])).forEach(([k, v]) => { feitos[k] = ler(v, null); });
        out.feitos = feitos;
      }
      return res.status(200).json(out);
    }

    if (acao === 'publicar' && req.method === 'POST') {
      const modo = MODOS.includes(corpo.modo) ? corpo.modo : null;
      if (!modo) return falha(res, 400, 'Modo inválido.');
      const chave = 'prod:os:' + modo;
      const novas = (Array.isArray(corpo.ordens) ? corpo.ordens : []).slice(0, 600).map((o) => limparOS(o, modo)).filter((o) => o.id);
      const atuais = hashObj(await redis('HGETALL', chave));
      const cmds = [];
      novas.forEach((o) => {
        const antes = ler(atuais[o.id], null);
        o.etapas = (antes && antes.etapas) || {};
        o.criado = (antes && antes.criado) || new Date().toISOString();
        if (antes) {
          if (!o.destino && antes.destino) o.destino = antes.destino;
          if (!o.outros.length && antes.outros) o.outros = antes.outros;
          ['link', 'origem', 'pedidoId', 'data'].forEach((k) => { if (!o[k] && antes[k]) o[k] = antes[k]; });
          if (antes.impressaEm) o.impressaEm = antes.impressaEm;
        }
        if (corpo.etapas && corpo.etapas[o.id]) {
          /* o painel já sabe que este pedido avançou (por exemplo, marcado como enviado lá) */
          const ate = ETAPAS.indexOf(corpo.etapas[o.id]);
          ETAPAS.slice(0, ate + 1).forEach((e) => { if (!o.etapas[e]) o.etapas[e] = { em: new Date().toISOString(), por: 'Painel' }; });
        }
        cmds.push(['HSET', chave, o.id, JSON.stringify(o)]);
      });
      const remover = (Array.isArray(corpo.remover) ? corpo.remover : []).map(String).filter((id) => atuais[id]);
      if (remover.length) cmds.push(['HDEL', chave, ...remover]);
      /* expedidas há mais de 7 dias saem sozinhas */
      const lim = new Date(Date.now() - 7 * 864e5).toISOString();
      Object.entries(atuais).forEach(([id, v]) => {
        const o = ler(v, null);
        if (o && o.etapas && o.etapas.expedir && o.etapas.expedir.em < lim && !remover.includes(id)) cmds.push(['HDEL', chave, id]);
      });
      if (modo === 'lazarus') {
        const ids = new Set(novas.map((o) => o.pedidoId).filter(Boolean));
        if (ids.size) {
          const arc = hashObj(await redis('HGETALL', 'prod:os:arcanju'));
          const tirar = Object.entries(arc).filter(([, v]) => { const o = ler(v, null); return o && ids.has(o.pedidoId || o.id) && !(o.etapas && o.etapas.separar); }).map(([k]) => k);
          if (tirar.length) cmds.push(['HDEL', 'prod:os:arcanju', ...tirar]);
        }
      }
      if (modo === 'lazarus' && Array.isArray(corpo.lotes)) {
        corpo.lotes.slice(0, 50).forEach((l) => {
          const id = String(l.id || '').slice(0, 60);
          if (id) cmds.push(['HSET', 'prod:lotes:lazarus', id, JSON.stringify({
            id, nome: String(l.nome || '').slice(0, 60), pecas: Number(l.pecas) || 0, pedidos: Number(l.pedidos) || 0,
            recebeEm: String(l.recebeEm || '').slice(0, 10), estamparEm: String(l.estamparEm || '').slice(0, 10), postarEm: String(l.postarEm || '').slice(0, 10)
          })]);
        });
        (Array.isArray(corpo.lotesRemover) ? corpo.lotesRemover : []).forEach((id) => cmds.push(['HDEL', 'prod:lotes:lazarus', String(id)]));
      }
      await pipeline(cmds);
      return res.status(200).json({ ok: true, enviadas: novas.length, removidas: remover.length });
    }

    if (acao === 'equipe' && req.method === 'POST') {
      const antes = ler(await redis('GET', 'prod:equipe'), []);
      const lista = (Array.isArray(corpo.equipe) ? corpo.equipe : []).slice(0, 20).map((f) => {
        const velho = antes.find((x) => x.id === f.id);
        const pin = String(f.pin || '').trim();
        if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('O PIN precisa ter de 4 a 8 números.');
        return {
          id: String(f.id).slice(0, 40), nome: String(f.nome || '').slice(0, 40),
          dias: (Array.isArray(f.dias) ? f.dias : []).map(Number).filter((d) => d >= 0 && d <= 6),
          inicio: String(f.inicio || '08:00').slice(0, 5), fim: String(f.fim || '18:00').slice(0, 5),
          capacidade: Math.max(1, Math.min(200, Number(f.capacidade) || 20)), ativo: f.ativo !== false,
          pinHash: pin ? hashPin(pin) : (velho ? velho.pinHash : '')
        };
      });
      const hashes = lista.map((f) => f.pinHash).filter(Boolean);
      if (new Set(hashes).size !== hashes.length) return falha(res, 400, 'Duas pessoas estão com o mesmo PIN.');
      await redis('SET', 'prod:equipe', JSON.stringify(lista));
      return res.status(200).json({ ok: true, equipe: lista.map((x) => ({ ...x, pinHash: undefined, temPin: Boolean(x.pinHash) })) });
    }

    if (acao === 'config' && req.method === 'POST') {
      const c = corpo.config && typeof corpo.config === 'object' ? corpo.config : {};
      const txt = JSON.stringify(c);
      if (txt.length > 60000) return falha(res, 400, 'Guia grande demais.');
      await redis('SET', 'prod:config', txt);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'aviso' && req.method === 'POST') {
      const id = String(corpo.id || '');
      const a = ler(await redis('HGET', 'prod:avisos', id), null);
      if (!a) return falha(res, 404, 'Aviso não encontrado.');
      if (corpo.excluir) await redis('HDEL', 'prod:avisos', id);
      else { a.resolvido = corpo.resolvido !== false; await redis('HSET', 'prod:avisos', id, JSON.stringify(a)); }
      return res.status(200).json({ ok: true });
    }

    return falha(res, 404, 'Ação desconhecida.');
  } catch (e) {
    return falha(res, 500, e.message || 'Erro no servidor.');
  }
}
