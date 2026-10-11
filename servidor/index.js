/*! Proctoria 0.4.0 | servidor: Cloudflare Worker, banco em Durable Object (SQLite) e arquivos em R2 */
import { DurableObject } from "cloudflare:workers";

const VERSAO = "0.4.0";
const DIA = 86400000;
const CABECALHO_JSON = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (dados, status = 200, extra) => new Response(JSON.stringify(dados), { status, headers: { ...CABECALHO_JSON, ...(extra || {}) } });
const falha = (status, mensagem) => json({ erro: mensagem }, status);
const codificador = new TextEncoder();

/* ------------------------------------------------------------------ */
/* Assinatura de credenciais                                           */
/* ------------------------------------------------------------------ */

function b64u(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64u(texto) {
  const s = atob(texto.replace(/-/g, "+").replace(/_/g, "/"));
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function aleatorio(bytes) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return Array.from(b, (x) => ("0" + x.toString(16)).slice(-2)).join("");
}
function codigoConvite() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789", b = new Uint8Array(22); crypto.getRandomValues(b);
  return Array.from(b, (x) => alfabeto[x % alfabeto.length]).join("");
}
async function hmac(chave, texto) {
  const k = await crypto.subtle.importKey("raw", codificador.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, codificador.encode(texto)));
}
async function sha256Hex(texto) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", codificador.encode(texto)));
  return Array.from(b, (x) => ("0" + x.toString(16)).slice(-2)).join("");
}
async function assinar(chave, dados) {
  const corpo = b64u(codificador.encode(JSON.stringify(dados)));
  return corpo + "." + b64u(await hmac(chave, corpo));
}
async function conferir(chave, credencial) {
  if (!credencial || credencial.indexOf(".") < 0) return null;
  const [corpo, assinatura] = credencial.split(".");
  const esperada = b64u(await hmac(chave, corpo));
  if (esperada.length !== assinatura.length) return null;
  let dif = 0;
  for (let i = 0; i < esperada.length; i++) dif |= esperada.charCodeAt(i) ^ assinatura.charCodeAt(i);
  if (dif) return null;
  try {
    const dados = JSON.parse(new TextDecoder().decode(deB64u(corpo)));
    return dados.e && dados.e > Date.now() ? dados : null;
  } catch (e) { return null; }
}
const portador = (req) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
const cookieDe = (req, nome) => {
  const m = new RegExp("(?:^|;\\s*)" + nome + "=([^;]+)").exec(req.headers.get("cookie") || "");
  return m ? m[1] : "";
};
const preencher = (n, casas) => String(n).padStart(casas, "0");

/* ------------------------------------------------------------------ */
/* Worker: arquivos estáticos, leitura e escrita direta no R2          */
/* ------------------------------------------------------------------ */

let CHAVE = null;
const banco = (env) => env.BANCO.get(env.BANCO.idFromName("principal"));
async function chaveDe(env) { if (!CHAVE) CHAVE = await banco(env).chave(); return CHAVE; }
async function administrador(req, env) {
  const p = await conferir(await chaveDe(env), cookieDe(req, "pct_admin"));
  return !!(p && p.a);
}

async function listar(env, prefixo) {
  const itens = []; let cursor;
  do {
    const r = await env.ARQUIVOS.list({ prefix: prefixo, cursor, limit: 1000 });
    r.objects.forEach((o) => itens.push({ chave: o.key, bytes: o.size }));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return itens.sort((a, b) => (a.chave < b.chave ? -1 : 1));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), caminho = url.pathname;
    if (!caminho.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      let m;
      // trecho de gravação enviado pelo participante: direto ao armazenamento
      if (req.method === "PUT" && (m = /^\/api\/sessao\/gravacao\/(tela|camera)\/(\d{1,3})\/(\d{1,6})$/.exec(caminho))) {
        const p = await conferir(await chaveDe(env), portador(req));
        if (!p || !p.s) return falha(401, "Credencial da sessão inválida ou expirada.");
        const bytes = Number(req.headers.get("content-length") || 0);
        if (!bytes || bytes > 40 * 1024 * 1024) return falha(413, "Trecho de gravação fora do tamanho aceito.");
        await env.ARQUIVOS.put(`sessoes/${p.s}/gravacao/${m[1]}/${preencher(m[2], 3)}/${preencher(m[3], 6)}.webm`, req.body, { httpMetadata: { contentType: "video/webm" } });
        return json({ ok: true });
      }
      // material de consulta da prova, para o participante
      if (req.method === "GET" && caminho === "/api/sessao/material") {
        const p = await conferir(await chaveDe(env), portador(req));
        if (!p || !p.s || !p.p) return falha(401, "Credencial da sessão inválida ou expirada.");
        const o = await env.ARQUIVOS.get(`provas/${p.p}/material.pdf`);
        return o ? new Response(o.body, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } }) : falha(404, "Esta prova não tem material de consulta.");
      }
      // leitura de arquivos pelo administrador
      if (req.method === "GET" && caminho === "/api/admin/arquivo") {
        if (!(await administrador(req, env))) return falha(401, "Acesso restrito ao administrador.");
        const k = url.searchParams.get("k") || "";
        if (!/^(sessoes|provas)\//.test(k) || k.includes("..")) return falha(400, "Arquivo inválido.");
        const o = await env.ARQUIVOS.get(k);
        if (!o) return falha(404, "Arquivo não encontrado.");
        return new Response(o.body, { headers: { "content-type": (o.httpMetadata && o.httpMetadata.contentType) || "application/octet-stream", "cache-control": "private, max-age=3600" } });
      }
      if (req.method === "GET" && (m = /^\/api\/admin\/sessoes\/([a-f0-9]{8,40})\/gravacao\/(tela|camera)\/(\d{1,3})$/.exec(caminho))) {
        if (!(await administrador(req, env))) return falha(401, "Acesso restrito ao administrador.");
        const partes = await listar(env, `sessoes/${m[1]}/gravacao/${m[2]}/${preencher(m[3], 3)}/`);
        if (!partes.length) return falha(404, "Gravação não encontrada.");
        const total = partes.reduce((s, x) => s + x.bytes, 0);
        const { readable, writable } = new FixedLengthStream(total);
        ctx.waitUntil((async () => {
          for (const x of partes) { const o = await env.ARQUIVOS.get(x.chave); if (o) await o.body.pipeTo(writable, { preventClose: true }); }
          await writable.close();
        })().catch(() => {}));
        return new Response(readable, { headers: { "content-type": "video/webm", "content-length": String(total), "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="proctoria_${m[1]}_${m[2]}_${m[3]}.webm"` } });
      }
      if (req.method === "PUT" && (m = /^\/api\/admin\/provas\/([a-f0-9]{8,40})\/material$/.exec(caminho))) {
        if (!(await administrador(req, env))) return falha(401, "Acesso restrito ao administrador.");
        const bytes = Number(req.headers.get("content-length") || 0);
        if (!bytes || bytes > 30 * 1024 * 1024) return falha(413, "O material precisa ter até 30 MB.");
        await env.ARQUIVOS.put(`provas/${m[1]}/material.pdf`, req.body, { httpMetadata: { contentType: "application/pdf" } });
        return json({ ok: true, bytes });
      }
      return await banco(env).fetch(req);
    } catch (e) {
      return falha(500, "Falha interna do servidor: " + String((e && e.message) || e));
    }
  }
};

/* ------------------------------------------------------------------ */
/* Banco: um Durable Object com SQLite guarda todo o estado            */
/* ------------------------------------------------------------------ */

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS provas (id TEXT PRIMARY KEY, titulo TEXT, dados TEXT, criada INTEGER, atualizada INTEGER, arquivada INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS questoes (prova TEXT, n INTEGER, dados TEXT, PRIMARY KEY (prova, n));
CREATE TABLE IF NOT EXISTS convites (codigo TEXT PRIMARY KEY, prova TEXT, aluno_id TEXT, nome TEXT, email TEXT, origem TEXT, criado INTEGER, sessao TEXT);
CREATE INDEX IF NOT EXISTS convites_prova ON convites (prova, aluno_id);
CREATE TABLE IF NOT EXISTS sessoes (id TEXT PRIMARY KEY, convite TEXT, prova TEXT, aluno TEXT, estado TEXT, criada INTEGER, inicio INTEGER, fim_previsto INTEGER,
  encerrada INTEGER, situacao TEXT, ultimo_sinal INTEGER, cliente TEXT, ordem TEXT, rascunho TEXT, questao_atual INTEGER, nota REAL, total REAL,
  resumo TEXT, ambiente TEXT, gravacoes TEXT, revisao TEXT, situacao_final TEXT, pionira TEXT, quedas INTEGER DEFAULT 0, segmento INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS sessoes_prova ON sessoes (prova, criada);
CREATE TABLE IF NOT EXISTS respostas (sessao TEXT, n INTEGER, alternativa INTEGER, quando INTEGER, PRIMARY KEY (sessao, n));
CREATE TABLE IF NOT EXISTS eventos (sessao TEXT, n INTEGER, t INTEGER, hora TEXT, fase TEXT, classe TEXT, tipo TEXT, titulo TEXT, detalhe TEXT, duracao INTEGER, dados TEXT, evidencias TEXT, PRIMARY KEY (sessao, n));
CREATE TABLE IF NOT EXISTS telemetria (sessao TEXT, lote INTEGER, linhas TEXT, PRIMARY KEY (sessao, lote));
CREATE TABLE IF NOT EXISTS conversa (id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT, de TEXT, texto TEXT, quando INTEGER, lida INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comandos (id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT, tipo TEXT, dados TEXT, criado INTEGER, entregue INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ao_vivo (sessao TEXT PRIMARY KEY, camera TEXT, tela TEXT, quando INTEGER);
CREATE TABLE IF NOT EXISTS tentativas (ip TEXT, quando INTEGER);
`;

const REGRAS_PROVA = {
  limiteSuspensoes: 3, identidade: true, provaDeVida: "registrar", varreduraAmbiente: false, semPausasSeg: 0,
  gravarTela: true, gravarCamera: true, exigirTelaInteiraCompartilhada: true,
  avisoSeg: 2, suspensaoSeg: 4, calculadora: true, rascunho: true, quedaMaximaMin: 10
};
const PROVA_PADRAO = { duracaoMin: 60, instrucoes: "", consulta: "nenhuma", textoConsulta: "", ordemAleatoria: true, embaralharAlternativas: true, inicioEm: null, fimEm: null, regras: REGRAS_PROVA };
const LETRAS = "ABCDEFGHIJ";
const ler = (texto, padrao) => { try { return texto ? JSON.parse(texto) : padrao; } catch (e) { return padrao; } };
const limpar = (t, max) => String(t === undefined || t === null ? "" : t).slice(0, max);
function embaralhar(n) {
  const v = Array.from({ length: n }, (_, i) => i), r = new Uint32Array(n); crypto.getRandomValues(r);
  for (let i = n - 1; i > 0; i--) { const j = r[i] % (i + 1); [v[i], v[j]] = [v[j], v[i]]; }
  return v;
}

export class Banco extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(ESQUEMA);
    if (!this.cfg("chave")) this.definir("chave", aleatorio(32));
    if (!this.cfg("integracao")) this.definir("integracao", "pct_" + aleatorio(24));
  }
  q(sql, ...args) { return this.sql.exec(sql, ...args).toArray(); }
  um(sql, ...args) { return this.q(sql, ...args)[0] || null; }
  cfg(chave) { const r = this.um("SELECT valor FROM config WHERE chave = ?", chave); return r ? r.valor : null; }
  definir(chave, valor) { this.sql.exec("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", chave, valor); }
  async chave() { return this.cfg("chave"); }

  prova(id) {
    const p = this.um("SELECT * FROM provas WHERE id = ?", id);
    if (!p) return null;
    const d = ler(p.dados, {});
    return { id: p.id, titulo: p.titulo, criada: p.criada, atualizada: p.atualizada, arquivada: !!p.arquivada, ...PROVA_PADRAO, ...d, regras: { ...REGRAS_PROVA, ...(d.regras || {}) } };
  }
  questoes(prova) { return this.q("SELECT n, dados FROM questoes WHERE prova = ? ORDER BY n", prova).map((r) => ({ n: r.n, ...ler(r.dados, {}) })); }
  regrasCliente(p) {   // regras da prova no formato da engine
    const r = p.regras;
    return {
      limiteSuspensoes: r.limiteSuspensoes, identidade: !!r.identidade, provaDeVida: r.provaDeVida, varreduraAmbiente: !!r.varreduraAmbiente,
      semPausasSeg: r.semPausasSeg || 0, gravarTela: !!r.gravarTela, gravarCamera: !!r.gravarCamera, exigirTelaInteiraCompartilhada: !!r.exigirTelaInteiraCompartilhada,
      trechoGravacaoMs: 10000, mostrarSinais: false,
      sinais: { olhar_fora: { avisoSeg: r.avisoSeg, suspensaoSeg: r.suspensaoSeg }, cabeca_fora: { avisoSeg: r.avisoSeg, suspensaoSeg: r.suspensaoSeg }, rosto_ausente: { avisoSeg: r.avisoSeg } }
    };
  }

  async fetch(req) {
    const url = new URL(req.url), partes = url.pathname.split("/").filter(Boolean).slice(1), metodo = req.method;
    const corpo = async () => { try { return await req.json(); } catch (e) { return {}; } };
    try {
      if (partes[0] === "convite") return await this.rotaConvite(req, partes, metodo);
      if (partes[0] === "sessao") return await this.rotaSessao(req, partes, metodo, corpo, url);
      if (partes[0] === "admin") return await this.rotaAdmin(req, partes, metodo, corpo, url);
      if (partes[0] === "integracao") return await this.rotaIntegracao(req, partes, metodo, corpo, url);
      if (partes[0] === "versao") return json({ versao: VERSAO });
      return falha(404, "Rota inexistente.");
    } catch (e) {
      return falha(500, "Falha interna do servidor: " + String((e && e.message) || e));
    }
  }

  /* ----------------------------- convite --------------------------- */

  async rotaConvite(req, partes, metodo) {
    const c = this.um("SELECT * FROM convites WHERE codigo = ?", partes[1] || "");
    if (!c) return falha(404, "Convite não encontrado. Confira o endereço recebido.");
    const p = this.prova(c.prova);
    if (!p || p.arquivada) return falha(410, "Esta prova não está mais disponível.");
    const agora = Date.now();
    let s = c.sessao ? this.um("SELECT * FROM sessoes WHERE id = ?", c.sessao) : null;
    const total = this.um("SELECT COUNT(*) AS n FROM questoes WHERE prova = ?", p.id).n;
    const publico = {
      prova: { id: p.id, titulo: p.titulo, duracaoMin: p.duracaoMin, instrucoes: p.instrucoes, consulta: p.consulta, total,
        ferramentas: { calculadora: !!p.regras.calculadora, rascunho: !!p.regras.rascunho }, regras: this.regrasCliente(p),
        resumoRegras: { limiteSuspensoes: p.regras.limiteSuspensoes, semPausasSeg: p.regras.semPausasSeg || 0, identidade: !!p.regras.identidade, varreduraAmbiente: !!p.regras.varreduraAmbiente } },
      aluno: { id: c.aluno_id, nome: c.nome },
      situacao: s ? (s.estado === "encerrada" ? "encerrada" : s.inicio ? "em_andamento" : "aberta") : "nova",
      janela: { inicioEm: p.inicioEm, fimEm: p.fimEm, agora }
    };
    if (metodo === "GET" && partes.length === 2) return json(publico);
    if (metodo === "POST" && partes[2] === "abrir") {
      if (p.inicioEm && agora < Date.parse(p.inicioEm)) return falha(403, "A prova ainda não está aberta.");
      if (p.fimEm && agora > Date.parse(p.fimEm) && !(s && s.inicio)) return falha(403, "O período de aplicação desta prova está encerrado.");
      if (!total) return falha(409, "Esta prova ainda não tem questões cadastradas.");
      if (s && s.estado === "encerrada") return json({ ...publico, encerrada: true });
      let retomada = null;
      if (!s) {
        const id = aleatorio(12);
        this.sql.exec("INSERT INTO sessoes (id, convite, prova, aluno, estado, criada, ultimo_sinal) VALUES (?, ?, ?, ?, 'aberta', ?, ?)",
          id, c.codigo, p.id, JSON.stringify({ id: c.aluno_id, nome: c.nome, email: c.email }), agora, agora);
        this.sql.exec("UPDATE convites SET sessao = ? WHERE codigo = ?", id, c.codigo);
        s = this.um("SELECT * FROM sessoes WHERE id = ?", id);
      } else {
        const cli = ler(s.cliente, {}), seq = this.um("SELECT COALESCE(MAX(n), 0) AS n FROM eventos WHERE sessao = ?", s.id).n;
        const semSinal = agora - (s.ultimo_sinal || s.criada);
        retomada = {
          criadaEm: new Date(s.criada).toISOString(), seq, suspensoes: cli.suspensoes || 0, ciclo: cli.ciclo || 0, advertencias: cli.advertencias || 0,
          bloqueios: cli.bloqueios || 0, liberacoes: cli.liberacoes || 0, tempoSuspensoMs: cli.tempoSuspensoMs || 0,
          inicioProvaT: s.inicio ? (cli.inicioProvaT !== undefined && cli.inicioProvaT !== null ? cli.inicioProvaT : s.inicio - s.criada) : null,
          queda: s.inicio ? { duracaoMs: semSinal, excedeu: semSinal > (p.regras.quedaMaximaMin || 10) * 60000 } : null
        };
        const segmento = (s.segmento || 0) + 10;   // novos trechos de gravação não se misturam aos anteriores
        this.sql.exec("UPDATE sessoes SET quedas = quedas + ?, segmento = ?, ultimo_sinal = ? WHERE id = ?", s.inicio ? 1 : 0, segmento, agora, s.id);
        s.segmento = segmento;
      }
      const credencial = await assinar(this.cfg("chave"), { s: s.id, p: p.id, e: agora + 12 * 3600000 });
      return json({ ...publico, credencial, retomada, segmentoInicial: s.segmento || 0,
        sessao: { id: s.id, criadaEm: new Date(s.criada).toISOString(), inicio: s.inicio, fimPrevisto: s.fim_previsto, agora } });
    }
    return falha(405, "Método não aceito.");
  }

  /* ----------------------------- sessão do participante ------------ */

  async sessaoDe(req) {
    const p = await conferir(this.cfg("chave"), portador(req));
    return p && p.s ? this.um("SELECT * FROM sessoes WHERE id = ?", p.s) : null;
  }

  async guardarEvidencias(sessao, n, evidencias, existentes) {
    const chaves = { ...(existentes || {}) };
    for (const campo of Object.keys(evidencias || {})) {
      const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(evidencias[campo]));
      if (!m || !/^[a-zA-Z]{1,12}$/.test(campo)) continue;
      const ext = m[1].indexOf("jpeg") >= 0 ? "jpg" : m[1].indexOf("webm") >= 0 ? "webm" : m[1].indexOf("png") >= 0 ? "png" : "bin";
      const chave = `sessoes/${sessao}/evidencias/${preencher(n, 5)}-${campo}.${ext}`;
      await this.env.ARQUIVOS.put(chave, deB64u(m[2]), { httpMetadata: { contentType: m[1] } });
      chaves[campo] = chave;
    }
    return chaves;
  }

  questaoDaSessao(s, posicao) {
    const ordem = ler(s.ordem, null);
    if (!ordem || posicao < 1 || posicao > ordem.q.length) return null;
    const original = ordem.q[posicao - 1];
    const linha = this.um("SELECT dados FROM questoes WHERE prova = ? AND n = ?", s.prova, original);
    if (!linha) return null;
    const d = ler(linha.dados, {}), perm = ordem.a[original] || d.alternativas.map((_, i) => i);
    return { original, dados: d, perm };
  }

  apurar(s) {
    const qs = this.questoes(s.prova), resp = {};
    this.q("SELECT n, alternativa FROM respostas WHERE sessao = ?", s.id).forEach((r) => { resp[r.n] = r.alternativa; });
    let nota = 0, total = 0;
    qs.forEach((qd) => { const pts = Number(qd.pontos) || 1; total += pts; if (resp[qd.n] !== undefined && resp[qd.n] !== null && resp[qd.n] === qd.correta) nota += pts; });
    return { nota, total };
  }

  encerrarSessao(s, situacao, extras) {
    if (s.estado === "encerrada") return;
    const { nota, total } = this.apurar(s), x = extras || {};
    this.sql.exec("UPDATE sessoes SET estado = 'encerrada', encerrada = ?, situacao = ?, nota = ?, total = ?, resumo = COALESCE(?, resumo), ambiente = COALESCE(?, ambiente), rascunho = COALESCE(?, rascunho) WHERE id = ?",
      Date.now(), situacao, nota, total, x.resumo ? JSON.stringify(x.resumo) : null, x.ambiente ? JSON.stringify(x.ambiente) : null, x.rascunho === undefined ? null : limpar(x.rascunho, 20000), s.id);
  }

  async rotaSessao(req, partes, metodo, corpo) {
    const s = await this.sessaoDe(req);
    if (!s) return falha(401, "Credencial da sessão inválida ou expirada.");
    const agora = Date.now(), acao = partes[1];
    const p = this.prova(s.prova);

    if (acao === "iniciar" && metodo === "POST") {
      if (s.estado === "encerrada") return falha(409, "Esta sessão está encerrada.");
      if (!s.inicio) {
        const qs = this.questoes(s.prova), ordem = { q: p.ordemAleatoria ? embaralhar(qs.length).map((i) => qs[i].n) : qs.map((x) => x.n), a: {} };
        qs.forEach((x) => { ordem.a[x.n] = p.embaralharAlternativas ? embaralhar((x.alternativas || []).length) : (x.alternativas || []).map((_, i) => i); });
        const fim = agora + p.duracaoMin * 60000;
        this.sql.exec("UPDATE sessoes SET estado = 'em_prova', inicio = ?, fim_previsto = ?, ordem = ?, ultimo_sinal = ? WHERE id = ?", agora, fim, JSON.stringify(ordem), agora, s.id);
        s.inicio = agora; s.fim_previsto = fim; s.ordem = JSON.stringify(ordem);
      }
      const ordem = ler(s.ordem, { q: [], a: {} }), respondidas = {};
      this.q("SELECT n, alternativa FROM respostas WHERE sessao = ?", s.id).forEach((r) => { respondidas[r.n] = r.alternativa; });
      const marcadas = ordem.q.map((orig) => respondidas[orig] !== undefined && respondidas[orig] !== null);
      return json({ inicio: s.inicio, fimPrevisto: s.fim_previsto, agora, total: ordem.q.length, marcadas, rascunho: s.rascunho || "", questaoAtual: s.questao_atual || 1,
        material: p.consulta === "texto" ? p.textoConsulta : null });
    }

    if (acao === "questao" && metodo === "GET") {
      if (s.estado !== "em_prova") return falha(409, "As questões ficam disponíveis depois da verificação e do início da prova.");
      if (agora > s.fim_previsto + 30000) return falha(410, "O tempo de prova está esgotado.");
      const posicao = parseInt(partes[2], 10), qd = this.questaoDaSessao(s, posicao);
      if (!qd) return falha(404, "Questão inexistente.");
      const r = this.um("SELECT alternativa FROM respostas WHERE sessao = ? AND n = ?", s.id, qd.original);
      this.sql.exec("UPDATE sessoes SET questao_atual = ? WHERE id = ?", posicao, s.id);
      return json({ n: posicao, total: ler(s.ordem, { q: [] }).q.length, caso: qd.dados.caso || "", enunciado: qd.dados.enunciado || "",
        alternativas: qd.perm.map((i) => qd.dados.alternativas[i]), resposta: r && r.alternativa !== null ? qd.perm.indexOf(r.alternativa) : null });
    }

    if (acao === "resposta" && metodo === "POST") {
      if (s.estado !== "em_prova") return falha(409, "Esta sessão não está em prova.");
      if (agora > s.fim_previsto + 30000) return falha(410, "O tempo de prova está esgotado.");
      const b = await corpo(), qd = this.questaoDaSessao(s, parseInt(b.n, 10));
      if (!qd) return falha(404, "Questão inexistente.");
      const k = b.k === null || b.k === undefined ? null : qd.perm[parseInt(b.k, 10)];
      if (k === undefined) return falha(400, "Alternativa inexistente.");
      this.sql.exec("INSERT INTO respostas (sessao, n, alternativa, quando) VALUES (?, ?, ?, ?) ON CONFLICT (sessao, n) DO UPDATE SET alternativa = excluded.alternativa, quando = excluded.quando", s.id, qd.original, k, agora);
      return json({ ok: true });
    }

    if (acao === "sinc" && metodo === "POST") {
      const b = await corpo();
      for (const ev of (b.eventos || []).slice(0, 200)) {
        const n = parseInt(ev.n, 10);
        if (!n) continue;
        const atual = this.um("SELECT evidencias FROM eventos WHERE sessao = ? AND n = ?", s.id, n);
        const evid = await this.guardarEvidencias(s.id, n, ev.evidencias, atual ? ler(atual.evidencias, {}) : {});
        this.sql.exec(`INSERT INTO eventos (sessao, n, t, hora, fase, classe, tipo, titulo, detalhe, duracao, dados, evidencias) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (sessao, n) DO UPDATE SET t = excluded.t, detalhe = excluded.detalhe, duracao = excluded.duracao, dados = excluded.dados, evidencias = excluded.evidencias`,
          s.id, n, parseInt(ev.t, 10) || 0, limpar(ev.hora, 40), limpar(ev.fase, 20), limpar(ev.classe, 20), limpar(ev.tipo, 40), limpar(ev.titulo, 200), limpar(ev.detalhe, 1000),
          ev.duracaoMs === undefined || ev.duracaoMs === null ? null : parseInt(ev.duracaoMs, 10), ev.dados ? limpar(JSON.stringify(ev.dados), 2000) : null, JSON.stringify(evid));
      }
      if (Array.isArray(b.telemetria) && b.telemetria.length) {
        const lote = (this.um("SELECT COALESCE(MAX(lote), 0) AS n FROM telemetria WHERE sessao = ?", s.id).n || 0) + 1;
        this.sql.exec("INSERT INTO telemetria (sessao, lote, linhas) VALUES (?, ?, ?)", s.id, lote, limpar(JSON.stringify(b.telemetria.slice(0, 600)), 200000));
      }
      if (b.aoVivo && (b.aoVivo.camera || b.aoVivo.tela)) {
        this.sql.exec("INSERT INTO ao_vivo (sessao, camera, tela, quando) VALUES (?, ?, ?, ?) ON CONFLICT (sessao) DO UPDATE SET camera = COALESCE(excluded.camera, camera), tela = COALESCE(excluded.tela, tela), quando = excluded.quando",
          s.id, b.aoVivo.camera ? limpar(b.aoVivo.camera, 400000) : null, b.aoVivo.tela ? limpar(b.aoVivo.tela, 800000) : null, agora);
      }
      (b.confirmados || []).slice(0, 50).forEach((id) => this.sql.exec("UPDATE comandos SET entregue = 1 WHERE id = ? AND sessao = ?", parseInt(id, 10) || 0, s.id));
      this.sql.exec("UPDATE sessoes SET ultimo_sinal = ?, cliente = COALESCE(?, cliente), rascunho = COALESCE(?, rascunho), gravacoes = COALESCE(?, gravacoes) WHERE id = ?",
        agora, b.estado ? limpar(JSON.stringify(b.estado), 4000) : null, b.rascunho === undefined ? null : limpar(b.rascunho, 20000), b.gravacoes ? limpar(JSON.stringify(b.gravacoes), 8000) : null, s.id);
      const comandos = this.q("SELECT id, tipo, dados FROM comandos WHERE sessao = ? AND entregue = 0 ORDER BY id", s.id).map((c) => ({ id: c.id, tipo: c.tipo, dados: ler(c.dados, {}) }));
      const mensagens = this.q("SELECT id, de, texto, quando FROM conversa WHERE sessao = ? AND id > ? ORDER BY id", s.id, parseInt(b.conversaDesde, 10) || 0);
      return json({ agora, fimPrevisto: s.fim_previsto, encerrada: s.estado === "encerrada", situacao: s.situacao, comandos, conversa: mensagens });
    }

    if (acao === "conversa" && metodo === "POST") {
      const b = await corpo(), texto = limpar(b.texto, 1000).trim();
      if (!texto) return falha(400, "Mensagem vazia.");
      this.sql.exec("INSERT INTO conversa (sessao, de, texto, quando) VALUES (?, 'aluno', ?, ?)", s.id, texto, agora);
      return json({ ok: true });
    }

    if (acao === "entregar" && metodo === "POST") {
      const b = await corpo();
      const aceitas = ["entregue", "encerrada_durante_bloqueio", "invalidada", "tempo_esgotado", "encerrada_pelo_administrador"];
      if (b.gravacoes) this.sql.exec("UPDATE sessoes SET gravacoes = ? WHERE id = ?", limpar(JSON.stringify(b.gravacoes), 8000), s.id);
      if (b.estado) this.sql.exec("UPDATE sessoes SET cliente = ? WHERE id = ?", limpar(JSON.stringify(b.estado), 4000), s.id);
      this.encerrarSessao(s, aceitas.indexOf(b.situacao) >= 0 ? b.situacao : "entregue", { resumo: b.resumo, ambiente: b.ambiente, rascunho: b.rascunho });
      return json({ ok: true, encerrada: true });
    }
    return falha(404, "Rota inexistente.");
  }

  /* ----------------------------- administração --------------------- */

  async rotaAdmin(req, partes, metodo, corpo, url) {
    const acao = partes[1], agora = Date.now();
    if (acao === "entrar" && metodo === "POST") {
      const ip = req.headers.get("cf-connecting-ip") || "local";
      this.sql.exec("DELETE FROM tentativas WHERE quando < ?", agora - 15 * 60000);
      if (this.um("SELECT COUNT(*) AS n FROM tentativas WHERE ip = ?", ip).n >= 8) return falha(429, "Muitas tentativas. Aguarde quinze minutos.");
      if (!this.env.ADMIN_SENHA) return falha(503, "A senha do administrador ainda não foi definida no servidor (segredo ADMIN_SENHA).");
      const b = await corpo();
      const [a, c] = await Promise.all([sha256Hex("pct:" + String(b.senha || "")), sha256Hex("pct:" + this.env.ADMIN_SENHA)]);
      let dif = 0; for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ c.charCodeAt(i);
      if (dif) { this.sql.exec("INSERT INTO tentativas (ip, quando) VALUES (?, ?)", ip, agora); return falha(401, "Senha incorreta."); }
      const cred = await assinar(this.cfg("chave"), { a: 1, e: agora + 12 * 3600000 });
      return json({ ok: true }, 200, { "set-cookie": `pct_admin=${cred}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
    }
    if (acao === "sair" && metodo === "POST") return json({ ok: true }, 200, { "set-cookie": "pct_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
    const p = await conferir(this.cfg("chave"), cookieDe(req, "pct_admin"));
    if (!p || !p.a) return falha(401, "Acesso restrito ao administrador.");
    if (acao === "eu") return json({ ok: true, versao: VERSAO });

    if (acao === "config") {
      if (metodo === "PUT") {
        const b = await corpo();
        if (b.pioniraWebhook !== undefined) this.definir("pioniraWebhook", limpar(b.pioniraWebhook, 500).trim());
        if (b.retencaoDias !== undefined) this.definir("retencaoDias", String(Math.max(0, parseInt(b.retencaoDias, 10) || 0)));
        if (b.novaChaveIntegracao) this.definir("integracao", "pct_" + aleatorio(24));
        await this.agendarLimpeza();
      }
      return json({ pioniraWebhook: this.cfg("pioniraWebhook") || "", retencaoDias: parseInt(this.cfg("retencaoDias") || "0", 10), chaveIntegracao: this.cfg("integracao"), versao: VERSAO, armazenamento: !!this.env.ARQUIVOS });
    }

    if (acao === "provas") {
      const id = partes[2];
      if (!id && metodo === "GET") {
        return json(this.q("SELECT id FROM provas WHERE arquivada = 0 ORDER BY criada DESC").map((r) => {
          const pr = this.prova(r.id);
          return { id: pr.id, titulo: pr.titulo, duracaoMin: pr.duracaoMin, consulta: pr.consulta, atualizada: pr.atualizada,
            questoes: this.um("SELECT COUNT(*) AS n FROM questoes WHERE prova = ?", pr.id).n,
            convites: this.um("SELECT COUNT(*) AS n FROM convites WHERE prova = ?", pr.id).n,
            emAndamento: this.um("SELECT COUNT(*) AS n FROM sessoes WHERE prova = ? AND estado != 'encerrada'", pr.id).n,
            encerradas: this.um("SELECT COUNT(*) AS n FROM sessoes WHERE prova = ? AND estado = 'encerrada'", pr.id).n };
        }));
      }
      if (!id && metodo === "POST") {
        const b = await corpo(), novo = aleatorio(8);
        this.sql.exec("INSERT INTO provas (id, titulo, dados, criada, atualizada) VALUES (?, ?, ?, ?, ?)", novo, limpar(b.titulo, 200) || "Prova sem título", JSON.stringify(this.dadosProva(b)), agora, agora);
        return json(this.prova(novo), 201);
      }
      const pr = this.prova(id);
      if (!pr) return falha(404, "Prova não encontrada.");
      if (partes.length === 3) {
        if (metodo === "GET") return json({ ...pr, questoes: this.questoes(id) });
        if (metodo === "PUT") {
          const b = await corpo();
          this.sql.exec("UPDATE provas SET titulo = ?, dados = ?, atualizada = ? WHERE id = ?", limpar(b.titulo, 200) || pr.titulo, JSON.stringify(this.dadosProva(b)), agora, id);
          return json(this.prova(id));
        }
        if (metodo === "DELETE") { this.sql.exec("UPDATE provas SET arquivada = 1 WHERE id = ?", id); return json({ ok: true }); }
      }
      if (partes[3] === "questoes" && metodo === "PUT") {
        const b = await corpo(), lista = Array.isArray(b.questoes) ? b.questoes : [];
        const erros = [];
        lista.forEach((qd, i) => {
          if (!String(qd.enunciado || "").trim()) erros.push("Questão " + (i + 1) + ": enunciado ausente.");
          if (!Array.isArray(qd.alternativas) || qd.alternativas.length < 2 || qd.alternativas.length > 10) erros.push("Questão " + (i + 1) + ": informe de 2 a 10 alternativas.");
          else if (!(Number.isInteger(qd.correta) && qd.correta >= 0 && qd.correta < qd.alternativas.length)) erros.push("Questão " + (i + 1) + ": alternativa correta não indicada.");
        });
        if (erros.length) return json({ erro: "Há questões incompletas.", detalhes: erros.slice(0, 20) }, 400);
        this.sql.exec("DELETE FROM questoes WHERE prova = ?", id);
        lista.forEach((qd, i) => this.sql.exec("INSERT INTO questoes (prova, n, dados) VALUES (?, ?, ?)", id, i + 1,
          JSON.stringify({ caso: limpar(qd.caso, 6000), enunciado: limpar(qd.enunciado, 4000), alternativas: qd.alternativas.map((a) => limpar(a, 1000)), correta: qd.correta, pontos: Number(qd.pontos) > 0 ? Number(qd.pontos) : 1 })));
        this.sql.exec("UPDATE provas SET atualizada = ? WHERE id = ?", agora, id);
        return json({ ok: true, total: lista.length });
      }
      if (partes[3] === "convites") {
        if (metodo === "GET") return json(this.convitesDe(id, url.origin));
        if (metodo === "POST") {
          const b = await corpo(), alunos = Array.isArray(b.alunos) ? b.alunos : [b];
          alunos.slice(0, 500).forEach((a) => this.criarConvite(id, a, "administrador"));
          return json(this.convitesDe(id, url.origin), 201);
        }
        if (metodo === "DELETE" && partes[4]) {
          const c = this.um("SELECT sessao FROM convites WHERE codigo = ? AND prova = ?", partes[4], id);
          if (c && c.sessao) return falha(409, "Este convite já foi utilizado e não pode ser excluído.");
          this.sql.exec("DELETE FROM convites WHERE codigo = ? AND prova = ?", partes[4], id);
          return json(this.convitesDe(id, url.origin));
        }
      }
      return falha(404, "Rota inexistente.");
    }

    if (acao === "ao-vivo" && metodo === "GET") {
      const prova = url.searchParams.get("prova");
      const linhas = prova
        ? this.q("SELECT * FROM sessoes WHERE prova = ? AND (estado != 'encerrada' OR encerrada > ?) ORDER BY criada", prova, agora - 15 * 60000)
        : this.q("SELECT * FROM sessoes WHERE estado != 'encerrada' OR encerrada > ? ORDER BY criada", agora - 15 * 60000);
      return json({ agora, sessoes: linhas.map((s) => this.resumoSessao(s, agora, true)) });
    }

    if (acao === "sessoes") {
      const id = partes[2];
      if (!id && metodo === "GET") {
        const prova = url.searchParams.get("prova");
        const linhas = prova ? this.q("SELECT * FROM sessoes WHERE prova = ? ORDER BY criada DESC LIMIT 500", prova) : this.q("SELECT * FROM sessoes ORDER BY criada DESC LIMIT 200");
        return json(linhas.map((s) => this.resumoSessao(s, agora, false)));
      }
      const s = this.um("SELECT * FROM sessoes WHERE id = ?", id);
      if (!s) return falha(404, "Sessão não encontrada.");
      if (partes.length === 3 && metodo === "GET") return json(await this.registroCompleto(s));
      if (partes.length === 3 && metodo === "DELETE") { await this.excluirSessao(s.id); return json({ ok: true }); }
      if (partes[3] === "quadro" && metodo === "GET") {
        const v = this.um("SELECT camera, tela FROM ao_vivo WHERE sessao = ?", s.id), campo = partes[4] === "tela" ? "tela" : "camera";
        const m = v && v[campo] ? /^data:([\w/+.-]+);base64,(.+)$/.exec(v[campo]) : null;
        if (!m) return falha(404, "Sem imagem recente.");
        return new Response(deB64u(m[2]), { headers: { "content-type": m[1], "cache-control": "no-store" } });
      }
      if (partes[3] === "conversa") {
        if (metodo === "POST") {
          const b = await corpo(), texto = limpar(b.texto, 1000).trim();
          if (!texto) return falha(400, "Mensagem vazia.");
          this.sql.exec("INSERT INTO conversa (sessao, de, texto, quando) VALUES (?, 'admin', ?, ?)", s.id, texto, agora);
        }
        this.sql.exec("UPDATE conversa SET lida = 1 WHERE sessao = ? AND de = 'aluno'", s.id);
        return json(this.q("SELECT id, de, texto, quando FROM conversa WHERE sessao = ? ORDER BY id", s.id));
      }
      if (partes[3] === "comando" && metodo === "POST") {
        const b = await corpo(), tipos = ["liberar", "encerrar", "suspender", "invalidar"];
        if (tipos.indexOf(b.tipo) < 0) return falha(400, "Comando desconhecido.");
        if (s.estado === "encerrada") return falha(409, "Esta sessão já está encerrada.");
        this.sql.exec("INSERT INTO comandos (sessao, tipo, dados, criado) VALUES (?, ?, ?, ?)", s.id, b.tipo, JSON.stringify({ texto: limpar(b.texto, 500) }), agora);
        // sem sinal do participante há mais de 20 s: o encerramento é aplicado no próprio servidor
        if ((b.tipo === "encerrar" || b.tipo === "invalidar") && agora - (s.ultimo_sinal || 0) > 20000) {
          this.encerrarSessao(s, b.tipo === "invalidar" ? "invalidada" : "encerrada_pelo_administrador");
          return json({ ok: true, aplicado: "servidor" });
        }
        return json({ ok: true, aplicado: "participante" });
      }
      if (partes[3] === "revisao" && metodo === "PUT") {
        const b = await corpo();
        this.sql.exec("UPDATE sessoes SET revisao = ?, situacao_final = ? WHERE id = ?", limpar(JSON.stringify({ decisoes: b.decisoes || {}, parecer: limpar(b.parecer, 8000) }), 60000),
          ["valida", "invalidada", ""].indexOf(b.situacaoFinal) >= 0 ? b.situacaoFinal : (s.situacao_final || ""), s.id);
        return json({ ok: true });
      }
      if (partes[3] === "pionira" && metodo === "POST") return await this.enviarPionira(s);
      return falha(404, "Rota inexistente.");
    }
    return falha(404, "Rota inexistente.");
  }

  dadosProva(b) {
    const r = { ...REGRAS_PROVA, ...((b && b.regras) || {}) };
    const num = (v, min, max, padrao) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
    return {
      duracaoMin: num(b.duracaoMin, 1, 600, 60), instrucoes: limpar(b.instrucoes, 6000),
      consulta: ["nenhuma", "texto", "pdf"].indexOf(b.consulta) >= 0 ? b.consulta : "nenhuma", textoConsulta: limpar(b.textoConsulta, 60000),
      ordemAleatoria: b.ordemAleatoria !== false, embaralharAlternativas: b.embaralharAlternativas !== false,
      inicioEm: b.inicioEm || null, fimEm: b.fimEm || null,
      regras: {
        limiteSuspensoes: num(r.limiteSuspensoes, 0, 20, 3), identidade: !!r.identidade,
        provaDeVida: ["obrigatoria", "registrar", "nao"].indexOf(r.provaDeVida) >= 0 ? r.provaDeVida : "registrar",
        varreduraAmbiente: !!r.varreduraAmbiente, semPausasSeg: num(r.semPausasSeg, 0, 300, 0), gravarTela: !!r.gravarTela, gravarCamera: !!r.gravarCamera,
        exigirTelaInteiraCompartilhada: r.exigirTelaInteiraCompartilhada !== false, avisoSeg: num(r.avisoSeg, 0.5, 30, 2), suspensaoSeg: num(r.suspensaoSeg, 1, 60, 4),
        calculadora: !!r.calculadora, rascunho: !!r.rascunho, quedaMaximaMin: num(r.quedaMaximaMin, 1, 120, 10)
      }
    };
  }

  criarConvite(prova, a, origem) {
    const idAluno = limpar(a.id || a.email || a.nome, 120).trim(), nome = limpar(a.nome, 200).trim();
    if (!nome) return null;
    const existente = idAluno ? this.um("SELECT codigo FROM convites WHERE prova = ? AND aluno_id = ?", prova, idAluno) : null;
    if (existente) return existente.codigo;
    const codigo = codigoConvite();
    this.sql.exec("INSERT INTO convites (codigo, prova, aluno_id, nome, email, origem, criado) VALUES (?, ?, ?, ?, ?, ?, ?)", codigo, prova, idAluno || codigo, nome, limpar(a.email, 200).trim(), origem, Date.now());
    return codigo;
  }
  convitesDe(prova, origem) {
    return this.q("SELECT c.codigo, c.aluno_id, c.nome, c.email, c.origem, c.criado, c.sessao, s.estado, s.situacao, s.inicio FROM convites c LEFT JOIN sessoes s ON s.id = c.sessao WHERE c.prova = ? ORDER BY c.nome", prova)
      .map((c) => ({ codigo: c.codigo, alunoId: c.aluno_id, nome: c.nome, email: c.email, origem: c.origem, sessao: c.sessao, endereco: origem + "/prova#" + c.codigo,
        situacao: !c.sessao ? "Não iniciada" : c.estado === "encerrada" ? "Encerrada" : c.inicio ? "Em prova" : "Em verificação" }));
  }

  resumoSessao(s, agora, aoVivo) {
    const cli = ler(s.cliente, {}), aluno = ler(s.aluno, {});
    const semSinalMs = agora - (s.ultimo_sinal || s.criada);
    const r = {
      id: s.id, prova: s.prova, aluno, estado: s.estado, situacao: s.situacao, situacaoFinal: s.situacao_final || "", criada: s.criada, inicio: s.inicio, fimPrevisto: s.fim_previsto, encerrada: s.encerrada,
      nota: s.nota, total: s.total, quedas: s.quedas || 0, suspensoes: cli.suspensoes || 0, advertencias: cli.advertencias || 0, bloqueios: cli.bloqueios || 0,
      suspensa: !!cli.suspensa, bloqueada: !!cli.bloqueada, motivos: cli.motivos || [], pionira: ler(s.pionira, null)
    };
    if (aoVivo) {
      r.semSinalMs = s.estado === "encerrada" ? 0 : semSinalMs;
      r.questaoAtual = s.questao_atual || null;
      r.respondidas = this.um("SELECT COUNT(*) AS n FROM respostas WHERE sessao = ? AND alternativa IS NOT NULL", s.id).n;
      r.totalQuestoes = ler(s.ordem, { q: [] }).q.length;
      r.rostos = cli.rostos; r.voz = !!cli.voz; r.fase = cli.fase || "";
      r.alertas = this.q("SELECT n, t, classe, titulo FROM eventos WHERE sessao = ? AND classe IN ('suspensao', 'revisao', 'bloqueio') ORDER BY n DESC LIMIT 6", s.id);
      r.naoLidas = this.um("SELECT COUNT(*) AS n FROM conversa WHERE sessao = ? AND de = 'aluno' AND lida = 0", s.id).n;
      const v = this.um("SELECT quando FROM ao_vivo WHERE sessao = ?", s.id);
      r.quadroEm = v ? v.quando : null;
      r.inicioProvaT = cli.inicioProvaT;
    }
    return r;
  }

  async registroCompleto(s) {
    const p = this.prova(s.prova), cli = ler(s.cliente, {}), ordem = ler(s.ordem, { q: [], a: {} });
    const eventos = this.q("SELECT * FROM eventos WHERE sessao = ? ORDER BY t, n", s.id).map((e) => {
      const ev = { n: e.n, t: e.t, hora: e.hora, fase: e.fase, classe: e.classe, tipo: e.tipo, titulo: e.titulo };
      if (e.detalhe) ev.detalhe = e.detalhe;
      if (e.duracao !== null) ev.duracaoMs = e.duracao;
      if (e.dados) ev.dados = ler(e.dados, {});
      const chaves = ler(e.evidencias, {});
      if (Object.keys(chaves).length) { ev.evidencias = {}; Object.keys(chaves).forEach((k) => { ev.evidencias[k] = "/api/admin/arquivo?k=" + encodeURIComponent(chaves[k]); }); }
      return ev;
    });
    const linhas = [];
    this.q("SELECT linhas FROM telemetria WHERE sessao = ? ORDER BY lote", s.id).forEach((t) => ler(t.linhas, []).forEach((l) => linhas.push(l)));
    const meta = ler(s.gravacoes, {}), gravacoes = { tela: [], camera: [] }, fimT = (s.encerrada || Date.now()) - s.criada;
    for (const tipo of ["tela", "camera"]) {
      const partes = await listar(this.env, `sessoes/${s.id}/gravacao/${tipo}/`), porSeg = {};
      partes.forEach((x) => { const seg = parseInt(x.chave.split("/")[4], 10); (porSeg[seg] = porSeg[seg] || { bytes: 0, partes: 0 }); porSeg[seg].bytes += x.bytes; porSeg[seg].partes++; });
      Object.keys(porSeg).map(Number).sort((a, b) => a - b).forEach((seg) => {
        const m = ((meta[tipo] || []).filter((g) => g.segmento === seg)[0]) || {};
        const inicioT = m.inicioT === undefined ? null : m.inicioT;
        gravacoes[tipo].push({ arquivo: `proctoria_${s.id}_${tipo}_${seg}.webm`, segmento: seg, inicioT: inicioT === null ? (cli.inicioProvaT || 0) : inicioT,
          fimT: m.fimT === undefined || m.fimT === null ? Math.min(fimT, (inicioT === null ? (cli.inicioProvaT || 0) : inicioT) + porSeg[seg].partes * 10000) : m.fimT, bytes: porSeg[seg].bytes });
      });
    }
    const dadosQ = {}; this.questoes(s.prova).forEach((x) => { dadosQ[x.n] = x; });
    const resp = {}; this.q("SELECT n, alternativa FROM respostas WHERE sessao = ?", s.id).forEach((r) => { resp[r.n] = r.alternativa; });
    const respostas = ordem.q.map((orig, i) => {
      const qd = dadosQ[orig] || {}, perm = ordem.a[orig] || [], k = resp[orig];
      return { "questão": i + 1, alternativa: k === undefined || k === null ? null : LETRAS[perm.indexOf(k)] || "?", correta: k !== undefined && k !== null && k === qd.correta, enunciado: limpar(qd.enunciado, 160) };
    });
    const conta = (classe) => eventos.filter((e) => e.classe === classe).length;
    const resumoCliente = ler(s.resumo, null);
    return {
      formato: "proctoria-registro", versao: VERSAO, sessao: s.id, aluno: ler(s.aluno, {}), prova: { id: p ? p.id : s.prova, titulo: p ? p.titulo : "" }, regras: p ? p.regras : {},
      situacao: s.estado === "encerrada" ? s.situacao : "em_andamento", situacaoFinal: s.situacao_final || "", criadaEm: new Date(s.criada).toISOString(),
      inicioProvaT: s.inicio ? (cli.inicioProvaT !== undefined && cli.inicioProvaT !== null ? cli.inicioProvaT : s.inicio - s.criada) : null, fimT,
      ambiente: ler(s.ambiente, {}),
      resumo: { ...(resumoCliente || {}), duracaoProvaMs: s.inicio ? (s.encerrada || Date.now()) - s.inicio : 0, suspensoes: cli.suspensoes || 0, tempoSuspensoMs: cli.tempoSuspensoMs || 0,
        advertencias: cli.advertencias || 0, bloqueios: cli.bloqueios || 0, liberacoes: cli.liberacoes || 0, sinaisParaRevisao: conta("revisao"), acoesBloqueadas: conta("bloqueio"), quedas: s.quedas || 0 },
      eventos, capturas: [], telemetria: { colunas: ["t", "rostos", "desvioYaw", "desvioPitch", "olharX", "olharY", "vozDb", "vozAtiva", "foco", "suspensa"], linhas },
      gravacoes, respostas, rascunho: s.rascunho || "", nota: s.nota, total: s.total,
      revisao: ler(s.revisao, { decisoes: {}, parecer: "" }), conversa: this.q("SELECT id, de, texto, quando FROM conversa WHERE sessao = ? ORDER BY id", s.id).map((m) => ({ ...m, quando: new Date(m.quando).toISOString() })),
      pionira: ler(s.pionira, null)
    };
  }

  async excluirSessao(id) {
    const itens = await listar(this.env, `sessoes/${id}/`);
    for (let i = 0; i < itens.length; i += 500) await this.env.ARQUIVOS.delete(itens.slice(i, i + 500).map((x) => x.chave));
    ["respostas", "eventos", "telemetria", "conversa", "comandos", "ao_vivo"].forEach((t) => this.sql.exec(`DELETE FROM ${t} WHERE sessao = ?`, id));
    this.sql.exec("UPDATE convites SET sessao = NULL WHERE sessao = ?", id);
    this.sql.exec("DELETE FROM sessoes WHERE id = ?", id);
  }

  /* Retenção: sessões encerradas há mais dias do que o prazo configurado são excluídas todo dia. */
  async agendarLimpeza() {
    const dias = parseInt(this.cfg("retencaoDias") || "0", 10);
    if (dias > 0 && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + DIA);
  }
  async alarm() {
    const dias = parseInt(this.cfg("retencaoDias") || "0", 10);
    if (dias > 0) {
      const vencidas = this.q("SELECT id FROM sessoes WHERE estado = 'encerrada' AND encerrada < ? LIMIT 50", Date.now() - dias * DIA);
      for (const s of vencidas) await this.excluirSessao(s.id);
      await this.ctx.storage.setAlarm(Date.now() + DIA);
    }
  }

  /* ----------------------------- integração com a Pionira ---------- */

  resultado(s) {
    const cli = ler(s.cliente, {}), p = this.prova(s.prova);
    return {
      sessao: s.id, prova: { id: s.prova, titulo: p ? p.titulo : "" }, aluno: ler(s.aluno, {}),
      situacao: s.situacao, situacaoFinal: s.situacao_final || "", nota: s.nota, total: s.total,
      iniciadaEm: s.inicio ? new Date(s.inicio).toISOString() : null, encerradaEm: s.encerrada ? new Date(s.encerrada).toISOString() : null,
      suspensoes: cli.suspensoes || 0, advertencias: cli.advertencias || 0, bloqueios: cli.bloqueios || 0, quedas: s.quedas || 0,
      parecer: ler(s.revisao, {}).parecer || ""
    };
  }

  async enviarPionira(s) {
    if (s.estado !== "encerrada") return falha(409, "O resultado só pode ser liberado depois do encerramento da sessão.");
    const destino = this.cfg("pioniraWebhook");
    const corpo = JSON.stringify({ evento: "resultado_liberado", enviadoEm: new Date().toISOString(), resultado: this.resultado(s) });
    const registro = { liberadoEm: new Date().toISOString(), destino: destino || null, status: null };
    if (destino) {
      try {
        const assinatura = Array.from(await hmac(this.cfg("integracao"), corpo), (x) => ("0" + x.toString(16)).slice(-2)).join("");
        const r = await fetch(destino, { method: "POST", headers: { "content-type": "application/json", "x-proctoria-assinatura": "sha256=" + assinatura }, body: corpo });
        registro.status = r.status;
      } catch (e) { registro.status = 0; registro.erro = String((e && e.message) || e); }
    }
    this.sql.exec("UPDATE sessoes SET pionira = ? WHERE id = ?", JSON.stringify(registro), s.id);
    return json({ ok: true, ...registro });
  }

  async rotaIntegracao(req, partes, metodo, corpo, url) {
    const chave = portador(req), esperada = this.cfg("integracao");
    if (!chave || chave.length !== esperada.length || chave !== esperada) return falha(401, "Chave de integração inválida.");
    if (partes[1] === "provas" && metodo === "GET") {
      return json(this.q("SELECT id, titulo FROM provas WHERE arquivada = 0 ORDER BY criada DESC").map((r) => ({ id: r.id, titulo: r.titulo })));
    }
    if (partes[1] === "convites" && metodo === "POST") {
      const b = await corpo(), p = this.prova(b.prova);
      if (!p || p.arquivada) return falha(404, "Prova não encontrada.");
      if (!b.aluno || !b.aluno.id || !b.aluno.nome) return falha(400, "Informe aluno.id e aluno.nome.");
      const codigo = this.criarConvite(p.id, b.aluno, "pionira");
      const c = this.um("SELECT sessao FROM convites WHERE codigo = ?", codigo);
      return json({ codigo, endereco: url.origin + "/prova#" + codigo, prova: { id: p.id, titulo: p.titulo, duracaoMin: p.duracaoMin }, jaIniciada: !!c.sessao });
    }
    if (partes[1] === "resultados" && metodo === "GET") {
      const prova = url.searchParams.get("prova"), aluno = url.searchParams.get("aluno");
      let linhas = prova ? this.q("SELECT * FROM sessoes WHERE prova = ? AND estado = 'encerrada' AND pionira IS NOT NULL", prova) : this.q("SELECT * FROM sessoes WHERE estado = 'encerrada' AND pionira IS NOT NULL ORDER BY encerrada DESC LIMIT 500");
      if (aluno) linhas = linhas.filter((s) => ler(s.aluno, {}).id === aluno);
      return json(linhas.map((s) => this.resultado(s)));
    }
    return falha(404, "Rota inexistente.");
  }
}
