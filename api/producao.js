// /api/producao — portal da produção.
// Guarda ordens de serviço, equipe, guia do dia e avisos no Upstash Redis.
// Duas portas:
//   · funcionário: entra com PIN e só vê e marca as tarefas da produção;
//   · painel (e Lazarus): usa a APP_KEY para enviar ordens, equipe e guia.
// Nada de financeiro passa por aqui.
import crypto from 'node:crypto';

const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ETAPAS = ['separar', 'prensar', 'conferir', 'embalar', 'etiqueta', 'expedir'];
const MODOS = ['arcanju', 'lazarus'];

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
  return {
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
