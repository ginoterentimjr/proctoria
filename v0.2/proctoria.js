/*! Proctoria 0.2.0 | engine de fiscalização de prova on-line para navegador */
(function (global) {
  "use strict";

  var VERSAO = "0.2.0";

  var RECURSOS_PADRAO = {
    visao: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21",
    modelo: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
  };

  var REGRAS_PADRAO = {
    exigirTelaCheia: true,
    exigirTelaInteiraCompartilhada: true,
    exigirMonitorUnico: true,
    limiteSuspensoes: 3,          // na suspensão deste número a prova fica bloqueada até a liberação do administrador; 0 = sem bloqueio
    liberacaoHash: null,          // SHA-256 do código de liberação (Proctoria.resumoSHA256); nulo = liberação apenas por sessao.liberar()
    /* Cada sinal: advertência depois de avisoSeg contínuos; suspensão se persistir por mais suspensaoSeg;
       suspensão também na advertência de número "reincidencia" dentro de reincidenciaJanelaMin. */
    sinais: {
      olhar_fora:       { avisoSeg: 2,   suspensaoSeg: 4, reincidencia: 4 },
      cabeca_fora:      { avisoSeg: 2,   suspensaoSeg: 4, reincidencia: 4 },
      rosto_ausente:    { avisoSeg: 2,   suspensaoSeg: 3, reincidencia: 3 },
      mais_de_um_rosto: { avisoSeg: 1.5, suspensaoSeg: 3, reincidencia: 2 },
      voz:              { avisoSeg: 1,   suspensaoSeg: 4, reincidencia: 3 }
    },
    reincidenciaJanelaMin: 5,
    cabecaYawGraus: 28,
    cabecaPitchGraus: 22,
    olharMargem: 0.3,             // fração da tela além da borda
    calibragemDesvioMax: 0.3,     // desvio médio aceito, em fração da tela
    vozLimiarDb: 12,              // acima do ruído de fundo
    vozDominanciaDb: 4,           // graves acima dos agudos, para separar voz de teclado
    vozJanelaSeg: 1.2,
    microfoneSemSinalSeg: 10,
    capturaPeriodicaSeg: 60,
    telemetriaSeg: 1,
    gravarTela: true,
    gravarCamera: true,
    bloquearAcoes: true,
    mostrarSinais: false
  };

  var ROTULOS = {
    foco: "Saída da janela da prova",
    tela_cheia: "Saída da tela cheia",
    compartilhamento: "Compartilhamento de tela interrompido",
    camera: "Câmera interrompida",
    microfone: "Microfone interrompido",
    monitor: "Monitor adicional conectado",
    olhar_fora: "Olhar mantido fora da tela",
    cabeca_fora: "Cabeça mantida fora da tela",
    rosto_ausente: "Rosto mantido fora da imagem",
    mais_de_um_rosto: "Mais de um rosto mantido na imagem",
    voz: "Som de voz mantido no ambiente",
    reincidencia: "Reincidência de advertências"
  };

  /* Advertências exibidas ao participante: título e orientação. */
  var MENSAGENS = {
    olhar_fora: ["Olhar fora da tela", "Volte o olhar para a prova."],
    cabeca_fora: ["Cabeça voltada para fora da tela", "Volte-se para a prova."],
    rosto_ausente: ["Rosto ausente da imagem", "Posicione-se diante da câmera."],
    mais_de_um_rosto: ["Mais de uma pessoa na imagem", "Apenas o participante permanece diante da câmera."],
    voz: ["Som de voz detectado", "A prova é individual e realizada em silêncio."]
  };

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === "string" ? document.createTextNode(f) : f); });
    return n;
  }

  function mediana(v) {
    if (!v.length) return 0;
    var s = v.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function limitar(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function arred(x, casas) { var p = Math.pow(10, casas || 0); return Math.round(x * p) / p; }
  function segundos(ms) { return (ms / 1000).toFixed(1).replace(".", ",") + " segundos"; }
  function relogioCurto(ms) { var t = Math.max(0, Math.round(ms / 1000)), m = Math.floor(t / 60), r = t % 60; return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r; }
  function resumoSHA256(texto) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(texto))).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }

  /* Condição sustentada em dois estágios: adverte depois de avisoMs contínuos; se o sinal persistir por mais
     escalaMs, escala; fecha depois de soltaMs sem o sinal. Falhas de leitura de até 300 ms não reiniciam a contagem. */
  function Condicao(avisoMs, escalaMs, soltaMs, aoAbrir, aoEscalar, aoFechar) {
    this.avisoMs = avisoMs; this.escalaMs = escalaMs; this.soltaMs = soltaMs;
    this.aoAbrir = aoAbrir; this.aoEscalar = aoEscalar; this.aoFechar = aoFechar;
    this.desde = null; this.soltaDesde = null; this.falhaDesde = null; this.aberta = null;
  }
  Condicao.prototype.atualizar = function (ativo, agora, contexto) {
    if (ativo) {
      this.soltaDesde = null; this.falhaDesde = null;
      if (this.desde === null) this.desde = agora;
      if (!this.aberta) {
        if (agora - this.desde >= this.avisoMs) {
          this.aberta = { inicio: this.desde, avisoEm: agora, escalou: false, ref: null };
          this.aberta.ref = this.aoAbrir(contexto, this.desde);
        }
      } else if (!this.aberta.escalou && this.escalaMs > 0 && agora - this.aberta.avisoEm >= this.escalaMs) {
        this.aberta.escalou = true;
        this.aoEscalar(this.aberta.ref, contexto, agora - this.aberta.inicio);
      }
    } else if (this.aberta) {
      if (this.soltaDesde === null) this.soltaDesde = agora;
      if (agora - this.soltaDesde >= this.soltaMs) this.fechar(this.soltaDesde);
    } else if (this.desde !== null) {
      if (this.falhaDesde === null) this.falhaDesde = agora;
      if (agora - this.falhaDesde > 300) { this.desde = null; this.falhaDesde = null; }
    }
  };
  Condicao.prototype.fechar = function (agora) {
    var a = this.aberta;
    this.aberta = null; this.desde = null; this.soltaDesde = null; this.falhaDesde = null;
    if (a) this.aoFechar(a.ref, agora - a.inicio);
  };

  /* ------------------------------------------------------------------ */
  /* Calibragem do olhar: regressão linear regularizada                  */
  /* ------------------------------------------------------------------ */

  function resolver(A, b) {
    var n = b.length, M = A.map(function (l, i) { return l.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      var d = M[c][c];
      if (Math.abs(d) < 1e-12) continue;
      for (var j = c; j <= n; j++) M[c][j] /= d;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c];
        if (f) for (var j2 = c; j2 <= n; j2++) M[r2][j2] -= f * M[c][j2];
      }
    }
    return M.map(function (l) { return l[n]; });
  }

  /* amostras: [{ f: [características], x, y }] com x e y em fração da tela */
  function ajustar(amostras) {
    var n = amostras.length, d = amostras[0].f.length, j, i;
    var media = new Array(d).fill(0), desvio = new Array(d).fill(0);
    amostras.forEach(function (a) { for (j = 0; j < d; j++) media[j] += a.f[j] / n; });
    amostras.forEach(function (a) { for (j = 0; j < d; j++) desvio[j] += Math.pow(a.f[j] - media[j], 2) / n; });
    for (j = 0; j < d; j++) { desvio[j] = Math.sqrt(desvio[j]); if (desvio[j] < 1e-6) desvio[j] = 1; }
    var k = d + 1, A = [], bx = new Array(k).fill(0), by = new Array(k).fill(0);
    for (i = 0; i < k; i++) A.push(new Array(k).fill(0));
    amostras.forEach(function (a) {
      var z = [1];
      for (j = 0; j < d; j++) z.push((a.f[j] - media[j]) / desvio[j]);
      for (i = 0; i < k; i++) {
        bx[i] += z[i] * a.x; by[i] += z[i] * a.y;
        for (j = 0; j < k; j++) A[i][j] += z[i] * z[j];
      }
    });
    var lambda = 0.05 * n;
    for (i = 1; i < k; i++) A[i][i] += lambda;
    return { media: media, desvio: desvio, wx: resolver(A, bx), wy: resolver(A, by) };
  }

  function prever(m, f) {
    var x = m.wx[0], y = m.wy[0];
    for (var j = 0; j < f.length; j++) {
      var z = (f[j] - m.media[j]) / m.desvio[j];
      x += m.wx[j + 1] * z; y += m.wy[j + 1] * z;
    }
    return [x, y];
  }

  function medianaVetor(lista) {
    var d = lista[0].length, r = [];
    for (var j = 0; j < d; j++) r.push(mediana(lista.map(function (v) { return v[j]; })));
    return r;
  }

  /* pontos: [{ x, y, amostras: [f] }]. Mede o desvio deixando um ponto fora do ajuste por vez. */
  function desvioCalibragem(pontos) {
    var soma = 0, n = 0;
    pontos.forEach(function (p, i) {
      if (!p.amostras.length) return;
      var treino = [];
      pontos.forEach(function (q, k) {
        if (k !== i) q.amostras.forEach(function (f) { treino.push({ f: f, x: q.x, y: q.y }); });
      });
      if (treino.length < 8) return;
      var r = prever(ajustar(treino), medianaVetor(p.amostras));
      soma += Math.pow(r[0] - p.x, 2) + Math.pow(r[1] - p.y, 2); n++;
    });
    return n ? Math.sqrt(soma / n) : 1;
  }

  /* ------------------------------------------------------------------ */
  /* Estilos das camadas da engine                                       */
  /* ------------------------------------------------------------------ */

  var CSS = [
    ".pct-camada{position:fixed;inset:0;z-index:2147483000;background:#1B1512;color:#FAF5EC;font:400 18px/1.55 Lora,Georgia,'Times New Roman',serif;display:flex;align-items:center;justify-content:center;padding:28px 20px;overflow:auto;box-sizing:border-box}",
    ".pct-camada *{box-sizing:border-box}",
    ".pct-quadro{width:100%;max-width:1040px;display:grid;gap:28px}",
    ".pct-quadro.pct-estreito{max-width:680px}",
    ".pct-sobre{font:600 13px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#C99A57;margin:0 0 10px}",
    ".pct-camada h2{font:600 34px/1.15 Poppins,'Segoe UI',system-ui,sans-serif;margin:0 0 10px;text-wrap:balance}",
    ".pct-camada p{margin:0;max-width:62ch}",
    ".pct-colunas{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:32px;align-items:start}",
    "@media (max-width:820px){.pct-colunas{grid-template-columns:minmax(0,1fr)}}",
    ".pct-video{position:relative;border:1px solid rgba(201,154,87,.45);border-radius:6px;overflow:hidden;background:#0d0a08;aspect-ratio:4/3}",
    ".pct-video video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:block}",
    ".pct-legenda{font:500 15px/1.35 Poppins,'Segoe UI',system-ui,sans-serif;margin-top:10px;color:#e9dcc6}",
    ".pct-medidor{height:10px;border-radius:5px;background:rgba(250,245,236,.14);overflow:hidden;margin-top:12px}",
    ".pct-medidor i{display:block;height:100%;width:0;background:#C99A57;transition:width .08s linear}",
    ".pct-medidor i.pct-voz{background:#E5662C}",
    ".pct-lista{list-style:none;margin:0;padding:0;display:grid;gap:2px}",
    ".pct-lista li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:13px 0;border-bottom:1px solid rgba(250,245,236,.14)}",
    ".pct-lista b{font:500 18px/1.3 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".pct-lista small{grid-column:2/4;font-size:16px;line-height:1.4;color:#e9dcc6}",
    ".pct-lista small:empty{display:none}",
    ".pct-estado{font:600 12px/1 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#b7a892;white-space:nowrap}",
    ".pct-ponto-estado{width:14px;height:14px;border-radius:50%;border:2px solid #8d7f6c}",
    "li[data-estado=verificando] .pct-ponto-estado{border-color:#C99A57;border-top-color:transparent;animation:pct-gira 1s linear infinite}",
    "li[data-estado=conforme] .pct-ponto-estado{background:#8FBF7A;border-color:#8FBF7A}",
    "li[data-estado=conforme] .pct-estado{color:#8FBF7A}",
    "li[data-estado=nao] .pct-ponto-estado{background:#EE7C68;border-color:#EE7C68}",
    "li[data-estado=nao] .pct-estado{color:#EE7C68}",
    "@keyframes pct-gira{to{transform:rotate(360deg)}}",
    ".pct-acoes{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:22px}",
    ".pct-botao{font:600 17px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;color:#1B1512;background:#E5662C;border:0;border-radius:6px;padding:15px 24px;cursor:pointer}",
    ".pct-botao:hover{background:#f07a43}",
    ".pct-botao:focus-visible{outline:3px solid #FAF5EC;outline-offset:3px}",
    ".pct-botao[disabled]{background:#5b4f44;color:#b7a892;cursor:not-allowed}",
    ".pct-botao.pct-sec{background:transparent;color:#FAF5EC;border:1px solid rgba(250,245,236,.45)}",
    ".pct-botao.pct-sec:hover{background:rgba(250,245,236,.08)}",
    ".pct-aviso{font-size:16px;color:#e9dcc6;margin-top:14px}",
    ".pct-alvo{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #C99A57;z-index:2147483600}",
    ".pct-alvo::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#E5662C}",
    ".pct-alvo.pct-coleta{animation:pct-fecha 1.3s linear forwards}",
    "@keyframes pct-fecha{from{transform:scale(1)}to{transform:scale(.45)}}",
    ".pct-motivos{margin:4px 0 0;padding:0 0 0 22px;display:grid;gap:4px}",
    ".pct-sinais{position:fixed;right:14px;top:14px;z-index:2147483300;width:272px;max-height:calc(100vh - 28px);overflow:hidden;background:rgba(27,21,18,.96);color:#FAF5EC;border:1px solid rgba(201,154,87,.5);border-radius:6px;padding:12px;font:500 14px/1.45 Poppins,'Segoe UI',system-ui,sans-serif;pointer-events:none}",
    ".pct-sinais h3{font:600 12px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#C99A57;margin:0 0 8px}",
    ".pct-sinais h3+dl,.pct-sinais dl+h3{margin-top:10px}",
    ".pct-feed{list-style:none;margin:0;padding:0;display:grid;gap:6px}",
    ".pct-feed li{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;line-height:1.3;padding-left:8px;border-left:3px solid #8d7f6c}",
    ".pct-feed i{font-style:normal;font-variant-numeric:tabular-nums;color:#b7a892}",
    ".pct-feed .pct-f-suspensao{border-left-color:#EE7C68}.pct-feed .pct-f-revisao{border-left-color:#E8B44C}.pct-feed .pct-f-bloqueio{border-left-color:#8FA7BF}",
    ".pct-feed:empty::after{content:'Nenhum alerta até o momento.';color:#b7a892}",
    ".pct-advertencias{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147482900;display:grid;gap:8px;width:min(640px,calc(100vw - 32px));pointer-events:none}",
    ".pct-adv{background:#1B1512;color:#FAF5EC;border-left:8px solid #E8B44C;border-radius:6px;padding:14px 18px;box-shadow:0 8px 28px rgba(27,21,18,.35);font:400 18px/1.4 Lora,Georgia,serif}",
    ".pct-adv b{display:block;font:600 13px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#E8B44C;margin-bottom:4px}",
    ".pct-adv strong{font:600 20px/1.3 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".pct-adv small{display:block;font:500 16px/1.35 Poppins,'Segoe UI',system-ui,sans-serif;color:#e9dcc6;margin-top:6px}",
    ".pct-adv.pct-fim{border-left-color:#8d7f6c}.pct-adv.pct-fim b{color:#b7a892}",
    ".pct-rotulo{display:block;font:500 16px/1.3 Poppins,'Segoe UI',system-ui,sans-serif;margin:18px 0 6px}",
    ".pct-campo{font:500 22px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;color:#1B1512;background:#FAF5EC;border:0;border-radius:6px;padding:13px 14px;width:min(320px,100%)}",
    ".pct-campo:focus-visible{outline:3px solid #E5662C;outline-offset:3px}",
    ".pct-sinais video{width:100%;aspect-ratio:4/3;object-fit:cover;transform:scaleX(-1);border-radius:3px;display:block;margin-bottom:8px;background:#0d0a08}",
    ".pct-sinais dl{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin:0}",
    ".pct-sinais dt{color:#C99A57}.pct-sinais dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}",
    ".pct-mira{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(229,102,44,.35);border:2px solid #E5662C;z-index:2147482500;pointer-events:none;transition:left .12s linear,top .12s linear}",
    "html.pct-em-prova .pct-area,html.pct-em-prova .pct-area *{-webkit-user-select:none;user-select:none;-webkit-user-drag:none}",
    "@media print{html.pct-em-prova body{display:none!important}}",
    "@media (prefers-reduced-motion:reduce){.pct-medidor i,.pct-mira{transition:none}}"
  ].join("\n");

  function injetarEstilos() {
    if (document.getElementById("pct-estilos")) return;
    var s = el("style", { id: "pct-estilos" });
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* Sessão                                                              */
  /* ------------------------------------------------------------------ */

  function Sessao(cfg) {
    cfg = cfg || {};
    this.cfg = cfg;
    var eu = this, sinaisCfg = (cfg.regras || {}).sinais || {};
    this.regras = Object.assign({}, REGRAS_PADRAO, cfg.regras || {});
    this.regras.sinais = {};
    Object.keys(REGRAS_PADRAO.sinais).forEach(function (k) {
      eu.regras.sinais[k] = Object.assign({}, REGRAS_PADRAO.sinais[k], sinaisCfg[k] || {});
    });
    this.recursos = Object.assign({}, RECURSOS_PADRAO, cfg.recursos || {});
    this.aluno = cfg.aluno || { id: "sem-id", nome: "" };
    this.prova = cfg.prova || { id: "sem-id", titulo: "" };
    this.area = cfg.areaDaProva || null;
    this._t0 = performance.now();
    this._criadaEm = new Date().toISOString();
    this._fase = "criada";
    this._seq = 0;
    this._eventos = [];
    this._capturas = [];
    this._telemetria = [];
    this._gravacoes = { tela: [], camera: [] };
    this._nEvidencias = 0;
    this._ocorrencias = 0;        // suspensões na sessão
    this._ciclo = 0;              // suspensões desde a última liberação do administrador
    this._nAdvertencias = 0;
    this._nBloqueios = 0;
    this._nLiberacoes = 0;
    this._avisos = {};            // instantes das advertências recentes, por sinal
    this._advAtivas = {};
    this._tempoSuspensoMs = 0;
    this._suspensao = null;
    this._sinais = { rostos: 0 };
    this._calib = { modo: "nao_realizada", desvio: null, tentativas: 0, modelo: null, yaw0: 0, pitch0: 0 };
    this._olhar = null;
    this._ouvintes = [];
    this._temporizadores = [];
    this._bloqueiosRecentes = {};
    this._tecladoRetido = false;
    this._canvas = document.createElement("canvas");
    injetarEstilos();
    this._evento("sistema", "sessao_criada", "Sessão criada", null, {
      dados: { versao: VERSAO, navegador: navigator.userAgent }
    });
  }

  Sessao.prototype._agora = function () { return Math.round(performance.now() - this._t0); };

  Sessao.prototype._ouvir = function (alvo, tipo, fn, op) {
    alvo.addEventListener(tipo, fn, op);
    this._ouvintes.push([alvo, tipo, fn, op]);
  };

  Sessao.prototype._quadro = function (video, largura, q) {
    try {
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      var esc = Math.min(1, largura / video.videoWidth), c = this._canvas;
      c.width = Math.round(video.videoWidth * esc);
      c.height = Math.round(video.videoHeight * esc);
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", q);
    } catch (e) { return null; }
  };

  Sessao.prototype._evidencias = function () {
    var ev = {};
    if (this._nEvidencias >= 300) return ev;
    this._nEvidencias++;
    var cam = this._quadro(this._camVideo, 320, 0.6);
    var tela = this._quadro(this._telaVideo, 960, 0.5);
    if (cam) ev.camera = cam;
    if (tela) ev.tela = tela;
    return ev;
  };

  Sessao.prototype._evento = function (classe, tipo, titulo, detalhe, op) {
    op = op || {};
    var ev = { n: ++this._seq, t: this._agora(), hora: new Date().toISOString(), fase: this._fase, classe: classe, tipo: tipo, titulo: titulo };
    if (detalhe) ev.detalhe = detalhe;
    if (op.dados) ev.dados = op.dados;
    if (op.evidencia) ev.evidencias = this._evidencias();
    this._eventos.push(ev);
    if (this._feed && classe !== "atividade") this._alimentar(ev);
    if (this.cfg.aoEvento) { try { this.cfg.aoEvento(ev); } catch (e) {} }
    return ev;
  };

  /* Registro de atividade pela página da prova (respostas, navegação entre questões). */
  Sessao.prototype.registrar = function (titulo, dados) {
    return this._evento("atividade", "pagina", titulo, null, { dados: dados });
  };

  /* --------------------------- preparo ------------------------------ */

  Sessao.prototype.preparar = function () {
    var eu = this;
    if (this._fase !== "criada") return Promise.reject(new Error("A sessão já foi preparada."));
    this._fase = "preparo";
    return new Promise(function (resolver, rejeitar) {
      eu._resolverPreparo = resolver; eu._rejeitarPreparo = rejeitar;
      eu._montarVerificacao();
    });
  };

  Sessao.prototype._item = function (id, estado, dica) {
    var li = this._itens[id];
    if (!li) return;
    li.setAttribute("data-estado", estado);
    li.querySelector(".pct-estado").textContent =
      { pendente: "Pendente", verificando: "Em verificação", conforme: "Conforme", nao: "Não conforme" }[estado];
    if (dica !== undefined) li.querySelector("small").textContent = dica || "";
  };

  Sessao.prototype._montarVerificacao = function () {
    var eu = this;
    this._itens = {};
    var definicoes = [
      ["navegador", "Navegador compatível"],
      ["monitor", "Um único monitor conectado"],
      ["camera", "Câmera ativa"],
      ["rosto", "Um rosto identificado na imagem"],
      ["microfone", "Microfone ativo e captando voz"],
      ["tela", "Tela inteira compartilhada"],
      ["ambiente", "Área de trabalho declarada e registrada"]
    ];
    var lista = el("ol", { class: "pct-lista" });
    definicoes.forEach(function (d) {
      var li = el("li", { "data-estado": "pendente" }, [
        el("span", { class: "pct-ponto-estado" }), el("b", { text: d[1] }),
        el("span", { class: "pct-estado", text: "Pendente" }), el("small")
      ]);
      eu._itens[d[0]] = li; lista.appendChild(li);
    });

    this._previa = el("video", { autoplay: "", playsinline: "" });
    this._previa.muted = true;
    this._camVideo = document.createElement("video");   // fora do documento: usado na detecção e nas capturas
    this._camVideo.muted = true; this._camVideo.playsInline = true;
    this._legendaVideo = el("div", { class: "pct-legenda", text: "A imagem da câmera aparece aqui depois da autorização." });
    this._barraVoz = el("i");
    this._botao = el("button", { class: "pct-botao", type: "button", text: "Ativar câmera e microfone" });
    this._aviso = el("p", { class: "pct-aviso" });
    var cancelar = el("button", { class: "pct-botao pct-sec", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", function () { eu._cancelarPreparo(); });
    this._etapa = "midia";
    this._botao.addEventListener("click", function () { eu._acaoVerificacao(); });

    this._camada = el("div", { class: "pct-camada", role: "dialog", "aria-modal": "true", "aria-label": "Verificação do ambiente" }, [
      el("div", { class: "pct-quadro" }, [
        el("div", null, [
          el("p", { class: "pct-sobre", text: "Etapa 1 de 2" }),
          el("h2", { text: "Verificação do ambiente" }),
          el("p", { text: "A prova é liberada quando todos os itens estiverem conformes." })
        ]),
        el("div", { class: "pct-colunas" }, [
          el("div", null, [
            el("div", { class: "pct-video" }, [this._previa]),
            this._legendaVideo,
            el("div", { class: "pct-medidor", "aria-hidden": "true" }, [this._barraVoz])
          ]),
          el("div", null, [lista, el("div", { class: "pct-acoes" }, [this._botao, cancelar]), this._aviso])
        ])
      ])
    ]);
    document.body.appendChild(this._camada);

    var compativel = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && navigator.mediaDevices.getDisplayMedia &&
      document.documentElement.requestFullscreen && global.MediaRecorder && ("isExtended" in global.screen));
    this._compativel = compativel;
    this._item("navegador", compativel ? "conforme" : "nao",
      compativel ? "" : "Utilize o Google Chrome ou o Microsoft Edge em um computador.");
    if (!compativel) this._botao.disabled = true;

    this._vozAcumuladaMs = 0; this._rostoDesde = null;
    this._tickVerif = setInterval(function () { eu._atualizarVerificacao(); }, 200);
    this._atualizarVerificacao();
  };

  Sessao.prototype._monitorUnico = function () {
    return !(this.regras.exigirMonitorUnico && global.screen.isExtended === true);
  };

  Sessao.prototype._trilhaViva = function (stream, tipo, ignorarMudo) {
    if (!stream) return false;
    var t = (tipo === "audio" ? stream.getAudioTracks() : stream.getVideoTracks())[0];
    return !!t && t.readyState === "live" && (ignorarMudo || !t.muted);
  };

  Sessao.prototype._atualizarVerificacao = function () {
    if (!this._itens) return;
    var s = this._sinais, agora = performance.now(), b = this._botao;
    this._item("monitor", this._monitorUnico() ? "conforme" : "nao",
      this._monitorUnico() ? "" : "Desconecte o monitor adicional e mantenha apenas a tela principal.");

    if (this._camStream) {
      this._item("camera", this._trilhaViva(this._camStream, "video") ? "conforme" : "nao");
      if (!this._detector) {
        this._item("rosto", this._erroDetector ? "nao" : "verificando",
          this._erroDetector ? "O detector facial não foi carregado. Verifique a conexão com a internet e recarregue a página." : "Carregando o detector facial.");
      } else {
        if (s.rostos === 1) { if (this._rostoDesde === null) this._rostoDesde = agora; } else this._rostoDesde = null;
        var firme = this._rostoDesde !== null && agora - this._rostoDesde > 800;
        this._rostoOk = firme;
        this._item("rosto", firme ? "conforme" : "verificando",
          firme ? "" : (s.rostos > 1 ? "Há mais de uma pessoa na imagem." : "Posicione o rosto no centro da imagem, com iluminação frontal."));
        this._legendaVideo.textContent = s.rostos === 1 ? "Um rosto identificado." : (s.rostos > 1 ? "Mais de um rosto identificado." : "Nenhum rosto identificado.");
      }
      var v = this._voz;
      if (v) {
        var pct = v.piso === null ? 0 : limitar((v.nivel - v.piso) / 40, 0, 1) * 100;
        this._barraVoz.style.width = pct + "%";
        this._barraVoz.className = v.ativa ? "pct-voz" : "";
        if (this._micOk) this._item("microfone", "conforme", "");
        else if (v.piso === null) this._item("microfone", "verificando", "Permaneça em silêncio por alguns segundos.");
        else this._item("microfone", "verificando", "Diga em voz alta: confirmo que realizo esta prova sem auxílio.");
      }
    }
    if (this._telaStream) {
      this._telaOk = this._trilhaViva(this._telaStream, "video", true);
      this._item("tela", this._telaOk ? "conforme" : "nao", this._telaOk ? "" : "O compartilhamento foi interrompido. Compartilhe a tela inteira novamente.");
      if (!this._telaOk && (this._etapa === "calibrar" || this._etapa === "ambiente")) {
        this._etapa = "tela"; this._ambienteOk = false; this._item("ambiente", "pendente", "");
      }
    }
    if (this._etapa === "midia") { b.textContent = "Ativar câmera e microfone"; b.disabled = !this._compativel || !!this._ocupado; }
    else if (this._etapa === "tela") { b.textContent = "Compartilhar a tela inteira"; b.disabled = !!this._ocupado; this._aviso.textContent = ""; }
    else if (this._etapa === "ambiente") {
      b.textContent = "Declarar e registrar a área de trabalho"; b.disabled = !!this._ocupado;
      this._aviso.textContent = "Feche as demais abas, os outros navegadores e os aplicativos alheios à prova. Ao confirmar, a imagem da tela neste instante fica registrada para a auditoria.";
    }
    else if (this._etapa === "calibrar") {
      b.textContent = "Entrar em tela cheia e calibrar o olhar";
      var tudo = this._monitorUnico() && this._rostoOk && this._micOk && this._telaOk && this._ambienteOk && this._trilhaViva(this._camStream, "video");
      b.disabled = !tudo || !!this._ocupado;
      this._aviso.textContent = tudo ? "Se a barra de compartilhamento do navegador estiver visível, selecione Ocultar antes de prosseguir." : "Os itens em verificação precisam estar conformes para prosseguir.";
    }
  };

  Sessao.prototype._acaoVerificacao = function () {
    var eu = this;
    if (this._ocupado) return;
    this._ocupado = true;
    var fim = function () { eu._ocupado = false; eu._atualizarVerificacao(); };
    if (this._etapa === "midia") this._abrirMidia().then(function (ok) { if (ok) eu._etapa = "tela"; }).then(fim, fim);
    else if (this._etapa === "tela") this._abrirTela().then(function (ok) { if (ok) eu._etapa = "ambiente"; }).then(fim, fim);
    else if (this._etapa === "ambiente") {
      var imagem = this._quadro(this._telaVideo, 1600, 0.6);
      if (imagem) {
        var ev = this._evento("sistema", "ambiente", "Área de trabalho registrada antes da prova",
          "O participante declarou ter fechado as demais abas, os outros navegadores e os aplicativos alheios à prova.");
        ev.evidencias = { tela: imagem };
        this._ambienteOk = true; this._item("ambiente", "conforme", ""); this._etapa = "calibrar";
      }
      fim();
    }
    else if (this._etapa === "calibrar") {
      this._entrarTelaCheia().then(function () {
        clearInterval(eu._tickVerif); eu._itens = null;
        eu._camada.remove(); eu._camada = null;
        eu._ocupado = false;
        eu._montarCalibragem();
      }, function () {
        eu._aviso.textContent = "O navegador não autorizou a tela cheia. Repita a ação.";
        fim();
      });
    }
  };

  Sessao.prototype._abrirMidia = function () {
    var eu = this;
    this._item("camera", "verificando", "Autorize a câmera e o microfone na janela do navegador.");
    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: "user" },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      eu._camStream = stream;
      eu._camVideo.srcObject = stream;
      eu._camVideo.play().catch(function () {});
      eu._previa.srcObject = stream;
      eu._previa.play().catch(function () {});
      eu._item("camera", "conforme", "");
      eu._evento("sistema", "midia_ativa", "Câmera e microfone ativados", null, {
        dados: { camera: (stream.getVideoTracks()[0] || {}).label, microfone: (stream.getAudioTracks()[0] || {}).label }
      });
      eu._vigiarTrilhas();
      eu._iniciarAudio();
      eu._carregarDetector().then(function () { eu._iniciarLaco(); }, function (e) {
        eu._erroDetector = true;
        eu._evento("sistema", "detector_falhou", "Detector facial não carregado", String(e && e.message || e));
      });
      return true;
    }, function (e) {
      var nome = e && e.name;
      var msg = nome === "NotAllowedError" ? "Permissão negada. Autorize a câmera e o microfone nas configurações do navegador e repita."
        : nome === "NotFoundError" ? "Câmera ou microfone não encontrados neste computador."
        : nome === "NotReadableError" ? "A câmera ou o microfone estão em uso por outro aplicativo."
        : "Não foi possível acessar a câmera e o microfone.";
      eu._item("camera", "nao", msg);
      eu._evento("sistema", "midia_negada", "Acesso à câmera e ao microfone não obtido", nome || "");
      return false;
    });
  };

  Sessao.prototype._abrirTela = function () {
    var eu = this;
    return navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor", frameRate: { ideal: 5, max: 8 } },
      audio: false, monitorTypeSurfaces: "include", selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude", systemAudio: "exclude"
    }).then(function (stream) {
      var trilha = stream.getVideoTracks()[0];
      var superficie = (trilha.getSettings() || {}).displaySurface;
      if (eu.regras.exigirTelaInteiraCompartilhada && superficie !== "monitor") {
        trilha.stop();
        if (eu._itens) eu._item("tela", "nao", "Foi compartilhada uma janela ou uma aba. Na janela do navegador, selecione a opção Tela inteira.");
        eu._evento("sistema", "tela_recusada", "Compartilhamento recusado pela engine", "Superfície compartilhada: " + (superficie || "não informada"));
        return false;
      }
      eu._telaStream = stream;
      eu._superficie = superficie || "não informada";
      eu._telaVideo = document.createElement("video");
      eu._telaVideo.muted = true; eu._telaVideo.srcObject = stream;
      eu._telaVideo.play().catch(function () {});
      trilha.addEventListener("ended", function () {
        eu._pararGravacao("tela");
        eu._suspender("compartilhamento", "O compartilhamento da tela foi encerrado.");
      });
      eu._evento("sistema", "tela_compartilhada", "Tela compartilhada", "Superfície: " + eu._superficie);
      if (eu._fase === "prova" && eu.regras.gravarTela) eu._iniciarGravacao("tela");
      return true;
    }, function (e) {
      if (eu._itens) eu._item("tela", "nao", "O compartilhamento não foi autorizado. Repita a ação e selecione a opção Tela inteira.");
      eu._evento("sistema", "tela_negada", "Compartilhamento de tela não autorizado", (e && e.name) || "");
      return false;
    });
  };

  Sessao.prototype._entrarTelaCheia = function () {
    var eu = this;
    if (document.fullscreenElement) return Promise.resolve();
    return document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(function () {
      if (navigator.keyboard && navigator.keyboard.lock) {
        navigator.keyboard.lock().then(function () { eu._tecladoRetido = true; }, function () { eu._tecladoRetido = false; });
      }
    });
  };

  Sessao.prototype._cancelarPreparo = function () {
    this._evento("sistema", "preparo_cancelado", "Verificação cancelada pelo participante");
    this._desligar();
    this._fase = "encerrada";
    if (this._rejeitarPreparo) this._rejeitarPreparo(new Error("Verificação cancelada."));
  };

  /* --------------------------- detector facial ---------------------- */

  Sessao.prototype._carregarDetector = function () {
    var eu = this, base = this.recursos.visao;
    return import(base + "/vision_bundle.mjs").then(function (visao) {
      return visao.FilesetResolver.forVisionTasks(base + "/wasm").then(function (arquivos) {
        eu._criarDetector = function (delegado) {
          return visao.FaceLandmarker.createFromOptions(arquivos, {
            baseOptions: { modelAssetPath: eu.recursos.modelo, delegate: delegado },
            runningMode: "VIDEO", numFaces: 2,
            outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
          }).then(function (d) { eu._detector = d; eu._delegado = delegado; });
        };
        return eu._criarDetector("GPU").catch(function () { return eu._criarDetector("CPU"); });
      });
    }).then(function () {
      eu._evento("sistema", "detector_ativo", "Detector facial carregado", "Processamento: " + eu._delegado);
    });
  };

  Sessao.prototype._iniciarLaco = function () {
    var eu = this, ultimo = -1, falhas = 0;
    var passo = function () {
      if (eu._fase === "encerrada") return;
      var v = eu._camVideo;
      if (eu._detector && v && v.readyState >= 2 && v.currentTime !== ultimo) {
        ultimo = v.currentTime;
        try { eu._processarRosto(eu._detector.detectForVideo(v, performance.now())); falhas = 0; }
        catch (e) {
          falhas++;
          if (falhas === 5 && eu._delegado === "GPU" && eu._criarDetector) {
            eu._detector = null;
            eu._criarDetector("CPU").catch(function () { eu._erroDetector = true; });
          }
        }
      }
      eu._lacoId = setTimeout(passo, 90);
    };
    passo();
  };

  function caracteristicas(res) {
    var n = res.faceLandmarks ? res.faceLandmarks.length : 0;
    if (!n) return { rostos: 0 };
    var lm = res.faceLandmarks[0], s = { rostos: n };
    var olho = function (a, b, iris) {
      var A = lm[a], B = lm[b], I = lm[iris];
      if (!A || !B || !I) return null;
      var dx = B.x - A.x, dy = B.y - A.y, c2 = dx * dx + dy * dy || 1e-9;
      var px = I.x - A.x, py = I.y - A.y;
      return [(px * dx + py * dy) / c2, (px * -dy + py * dx) / c2];
    };
    var e1 = olho(33, 133, 468), e2 = olho(362, 263, 473);
    if (e1 && e2) { s.ix = (e1[0] + e2[0]) / 2; s.iy = (e1[1] + e2[1]) / 2; }
    var bs = {};
    if (res.faceBlendshapes && res.faceBlendshapes[0]) {
      res.faceBlendshapes[0].categories.forEach(function (c) { bs[c.categoryName] = c.score; });
    }
    var g = function (k) { return bs[k] || 0; };
    s.bh = (g("eyeLookOutLeft") - g("eyeLookInLeft") + g("eyeLookInRight") - g("eyeLookOutRight")) / 2;
    s.bv = (g("eyeLookUpLeft") + g("eyeLookUpRight") - g("eyeLookDownLeft") - g("eyeLookDownRight")) / 2;
    s.pisca = (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2;
    var mt = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
    if (mt && mt.data) {
      var m = mt.data;
      s.yaw = Math.atan2(m[8], m[10]) * 180 / Math.PI;
      s.pitch = Math.asin(limitar(-m[9], -1, 1)) * 180 / Math.PI;
    } else { s.yaw = 0; s.pitch = 0; }
    if (s.ix !== undefined) s.f = [s.ix, s.iy, s.yaw / 30, s.pitch / 30, s.bh, s.bv];
    return s;
  }

  Sessao.prototype._processarRosto = function (res) {
    var s = caracteristicas(res), agora = performance.now(), c = this._calib;
    this._sinais = s;
    if (this._coleta && s.rostos >= 1 && s.f && s.pisca < 0.5) this._coleta.push(s.f);
    if (s.rostos >= 1) {
      s.dYaw = s.yaw - c.yaw0; s.dPitch = s.pitch - c.pitch0;
      s.cabecaFora = Math.abs(s.dYaw) > this.regras.cabecaYawGraus || Math.abs(s.dPitch) > this.regras.cabecaPitchGraus;
      if (c.modelo && s.f && s.pisca < 0.5) {
        var p = prever(c.modelo, s.f);
        this._olhar = this._olhar ? [this._olhar[0] * 0.65 + p[0] * 0.35, this._olhar[1] * 0.65 + p[1] * 0.35] : p;
      }
      if (this._olhar) {
        s.gx = this._olhar[0]; s.gy = this._olhar[1];
        var m = this.regras.olharMargem;
        s.olharFora = s.gx < -m || s.gx > 1 + m || s.gy < -m || s.gy > 1 + m;
      }
    }
    if (this._fase !== "prova" || this._suspensao || !this._cond) return;
    this._cond.ausente.atualizar(s.rostos === 0, agora, s);
    this._cond.varios.atualizar(s.rostos > 1, agora, s);
    this._cond.cabeca.atualizar(s.rostos >= 1 && !!s.cabecaFora, agora, s);
    this._cond.olhar.atualizar(s.rostos >= 1 && !s.cabecaFora && !!s.olharFora, agora, s);
  };

  /* --------------------------- áudio -------------------------------- */

  Sessao.prototype._iniciarAudio = function () {
    var eu = this, Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx || !this._camStream.getAudioTracks().length) return;
    try {
      this._audioCtx = new Ctx();
      if (this._audioCtx.state === "suspended") this._audioCtx.resume().catch(function () {});
      var fonte = this._audioCtx.createMediaStreamSource(new MediaStream(this._camStream.getAudioTracks()));
      var an = this._audioCtx.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0.3;
      fonte.connect(an);
      this._analisador = an;
      this._bins = new Float32Array(an.frequencyBinCount);
      this._voz = { piso: null, amostrasPiso: [], nivel: -120, ativa: false, janela: [], taxa: 0, semSinalDesde: null };
      this._audioId = setInterval(function () { eu._tickAudio(); }, 50);
    } catch (e) {
      this._evento("sistema", "audio_falhou", "Análise de áudio não iniciada", String(e && e.message || e));
    }
  };

  Sessao.prototype._tickAudio = function () {
    var an = this._analisador, bins = this._bins, v = this._voz, r = this.regras;
    an.getFloatFrequencyData(bins);
    var hz = this._audioCtx.sampleRate / an.fftSize;
    var banda = function (a, b) {
      var s = 0, n = 0, fim = Math.min(bins.length - 1, Math.ceil(b / hz));
      for (var i = Math.floor(a / hz); i <= fim; i++) { var d = bins[i]; if (isFinite(d)) s += Math.pow(10, d / 10); n++; }
      return 10 * Math.log10((n ? s / n : 0) + 1e-13);
    };
    var fala = banda(300, 3400), baixo = banda(150, 1000), alto = banda(3000, 8000);
    v.nivel = fala;
    if (v.piso === null) {
      v.amostrasPiso.push(fala);
      if (v.amostrasPiso.length >= 30) v.piso = Math.max(-92, mediana(v.amostrasPiso));
      return;
    }
    v.ativa = (fala - v.piso) > r.vozLimiarDb && (baixo - alto) > r.vozDominanciaDb;
    if (!v.ativa) {
      if (fala < v.piso) v.piso = Math.max(-92, v.piso * 0.8 + fala * 0.2);
      else v.piso += 0.003;
    }
    var instante = performance.now(), passoMs = v.ultimoTick ? Math.min(500, instante - v.ultimoTick) : 50;
    v.ultimoTick = instante;
    v.janela.push([instante, v.ativa ? 1 : 0]);
    while (v.janela.length && instante - v.janela[0][0] > r.vozJanelaSeg * 1000) v.janela.shift();
    var cobre = v.janela.length > 1 && instante - v.janela[0][0] >= r.vozJanelaSeg * 600;
    v.taxa = cobre ? v.janela.reduce(function (a, b) { return a + b[1]; }, 0) / v.janela.length : 0;

    if (this._fase === "preparo" && !this._micOk) {
      if (v.ativa) this._vozAcumuladaMs += passoMs;
      if (this._vozAcumuladaMs >= 600) {
        this._micOk = true;
        this._evento("sistema", "microfone_verificado", "Microfone verificado com captação de voz", "Ruído de fundo: " + arred(v.piso, 0) + " dB");
      }
    }
    if (this._fase !== "prova") return;
    var agora = instante;
    if (!this._suspensao) {
      if (!this._vozEvento && v.taxa >= 0.45) this._abrirVoz();
      else if (this._vozEvento) {
        var reg = this._vozEvento, limiteVoz = r.sinais.voz.suspensaoSeg * 1000;
        reg.pico = Math.max(reg.pico, fala - v.piso);
        if (v.taxa <= 0.1) this._fecharVoz();
        else if (!reg.escalou && limiteVoz > 0 && agora - reg.inicio >= limiteVoz) {
          reg.escalou = true;
          this._suspender("voz", "Som de voz mantido por " + segundos(agora - reg.inicio) + " depois da advertência.");
        }
      }
    }
    var mudo = fala < -110;
    if (mudo) {
      if (v.semSinalDesde === null) v.semSinalDesde = agora;
      if (!v.semSinalEvento && agora - v.semSinalDesde > r.microfoneSemSinalSeg * 1000) {
        v.semSinalEvento = this._evento("revisao", "microfone_sem_sinal", "Microfone sem sinal",
          "Nenhum som captado por mais de " + r.microfoneSemSinalSeg + " segundos, o que sugere microfone silenciado.", { evidencia: true });
        v.semSinalInicio = v.semSinalDesde;
      }
    } else {
      if (v.semSinalEvento) v.semSinalEvento.duracaoMs = Math.round(agora - v.semSinalInicio);
      v.semSinalEvento = null; v.semSinalDesde = null;
    }
  };

  Sessao.prototype._abrirVoz = function () {
    var eu = this;
    var ev = this._evento("revisao", "voz", "Som de voz no ambiente", null, { evidencia: true });
    var reg = { evento: ev, inicio: performance.now(), pico: 0, escalou: false };
    this._vozEvento = reg;
    this._advertir("voz", ev);
    try {
      var rec = new MediaRecorder(new MediaStream(this._camStream.getAudioTracks()), { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 24000 });
      var partes = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) partes.push(e.data); };
      rec.onstop = function () {
        var leitor = new FileReader();
        leitor.onload = function () { ev.evidencias = ev.evidencias || {}; ev.evidencias.audio = leitor.result; };
        leitor.readAsDataURL(new Blob(partes, { type: "audio/webm" }));
      };
      rec.start();
      reg.rec = rec;
      reg.limite = setTimeout(function () { if (rec.state !== "inactive") rec.stop(); }, 20000);
    } catch (e) {}
  };

  Sessao.prototype._fecharVoz = function () {
    var reg = this._vozEvento;
    if (!reg) return;
    this._vozEvento = null;
    this._encerrarAdvertencia("voz");
    reg.evento.duracaoMs = Math.round(performance.now() - reg.inicio);
    reg.evento.detalhe = "Intensidade máxima de " + arred(reg.pico, 0) + " dB acima do ruído de fundo.";
    clearTimeout(reg.limite);
    if (reg.rec && reg.rec.state !== "inactive") reg.rec.stop();
  };

  /* --------------------------- calibragem --------------------------- */

  Sessao.prototype._montarCalibragem = function () {
    var eu = this;
    var botao = el("button", { class: "pct-botao", type: "button", text: "Iniciar calibragem" });
    botao.addEventListener("click", function () { eu._executarCalibragem(); });
    this._camada = el("div", { class: "pct-camada", role: "dialog", "aria-modal": "true", "aria-label": "Calibragem do olhar" }, [
      el("div", { class: "pct-quadro pct-estreito" }, [
        el("div", null, [
          el("p", { class: "pct-sobre", text: "Etapa 2 de 2" }),
          el("h2", { text: "Calibragem do olhar" }),
          el("p", { text: "Nove pontos aparecem na tela, um por vez. Fixe o olhar em cada ponto até que ele desapareça, com a cabeça voltada para a tela e o rosto bem iluminado. A etapa dura cerca de vinte segundos." }),
          el("div", { class: "pct-acoes" }, [botao])
        ])
      ])
    ]);
    document.body.appendChild(this._camada);
  };

  Sessao.prototype._executarCalibragem = function () {
    var eu = this, c = this._calib;
    c.tentativas++;
    var quadro = this._camada.querySelector(".pct-quadro");
    quadro.hidden = true; quadro.style.display = "none";
    var alvo = el("div", { class: "pct-alvo", "aria-hidden": "true" });
    this._camada.appendChild(alvo);
    var coords = [[0.5, 0.5], [0.06, 0.08], [0.94, 0.08], [0.94, 0.92], [0.06, 0.92], [0.5, 0.08], [0.94, 0.5], [0.5, 0.92], [0.06, 0.5]];
    var pontos = [], i = 0;
    var proximo = function () {
      if (i >= coords.length) { alvo.remove(); eu._coleta = null; eu._concluirCalibragem(pontos); return; }
      var p = coords[i++];
      alvo.className = "pct-alvo";
      alvo.style.left = (p[0] * 100) + "%"; alvo.style.top = (p[1] * 100) + "%";
      setTimeout(function () {
        var amostras = []; eu._coleta = amostras;
        void alvo.offsetWidth; alvo.className = "pct-alvo pct-coleta";
        var inicioColeta = performance.now();
        var conferir = function () {
          var passou = performance.now() - inicioColeta;
          if ((passou >= 1300 && amostras.length >= 8) || passou >= 3000) {
            eu._coleta = null; pontos.push({ x: p[0], y: p[1], amostras: amostras }); proximo();
          } else setTimeout(conferir, 100);
        };
        setTimeout(conferir, 1300);
      }, 900);
    };
    proximo();
  };

  Sessao.prototype._concluirCalibragem = function (pontos) {
    var eu = this, c = this._calib, r = this.regras;
    var validos = pontos.filter(function (p) { return p.amostras.length >= 4; });
    var desvio = validos.length >= 7 ? desvioCalibragem(validos) : 1;
    var ok = desvio <= r.calibragemDesvioMax;
    var todas = [];
    validos.forEach(function (p) { p.amostras.forEach(function (f) { todas.push({ f: f, x: p.x, y: p.y }); }); });
    var centro = pontos[0] && pontos[0].amostras.length ? pontos[0].amostras : (todas.length ? todas.map(function (a) { return a.f; }) : null);
    if (centro) { c.yaw0 = mediana(centro.map(function (f) { return f[2] * 30; })); c.pitch0 = mediana(centro.map(function (f) { return f[3] * 30; })); }
    c.desvio = arred(desvio, 3);
    if (ok) { c.modelo = ajustar(todas); c.modo = "completa"; this._olhar = null; }
    this._evento("sistema", ok ? "calibragem_concluida" : "calibragem_insuficiente",
      ok ? "Calibragem do olhar concluída" : "Calibragem do olhar insuficiente",
      "Tentativa " + c.tentativas + ". Desvio médio estimado: " + Math.round(desvio * 100) + "% da dimensão da tela. Pontos com leitura: " + validos.length + " de 9.");

    var quadro = this._camada.querySelector(".pct-quadro");
    quadro.textContent = ""; quadro.hidden = false; quadro.style.display = "";
    var acoes = el("div", { class: "pct-acoes" });
    var repetir = el("button", { class: "pct-botao" + (ok ? " pct-sec" : ""), type: "button", text: "Repetir a calibragem" });
    repetir.addEventListener("click", function () { eu._executarCalibragem(); });
    var concluir = function (modo) {
      if (modo === "reduzida") {
        c.modo = "reduzida"; c.modelo = null;
        eu._evento("sistema", "calibragem_reduzida", "Monitoramento do olhar em modo reduzido",
          "O participante prosseguiu sem calibragem válida. O olhar é acompanhado apenas pela posição da cabeça.");
      }
      eu._camada.remove(); eu._camada = null;
      eu._fase = "pronta";
      eu._resolverPreparo({ calibragem: { modo: c.modo, desvio: c.desvio, tentativas: c.tentativas } });
    };
    var textoDesvio = validos.length >= 7
      ? "Desvio médio estimado: " + Math.round(Math.min(desvio, 1) * 100) + "% da dimensão da tela."
      : "O rosto foi identificado em " + validos.length + " dos 9 pontos.";
    var corpo;
    if (ok) {
      var iniciar = el("button", { class: "pct-botao", type: "button", text: "Iniciar a prova" });
      iniciar.addEventListener("click", function () { concluir("completa"); });
      acoes.appendChild(iniciar); acoes.appendChild(repetir);
      corpo = [el("p", { class: "pct-sobre", text: "Etapa 2 de 2" }), el("h2", { text: "Calibragem concluída" }), el("p", { text: textoDesvio }), acoes];
    } else {
      acoes.appendChild(repetir);
      var extra = null;
      if (c.tentativas >= 2) {
        var seguir = el("button", { class: "pct-botao pct-sec", type: "button", text: "Prosseguir com o monitoramento pela posição da cabeça" });
        seguir.addEventListener("click", function () { concluir("reduzida"); });
        acoes.appendChild(seguir);
        extra = el("p", { class: "pct-aviso", text: "A escolha fica registrada para a auditoria da sessão." });
      }
      corpo = [el("p", { class: "pct-sobre", text: "Etapa 2 de 2" }), el("h2", { text: "A calibragem não atingiu a precisão necessária" }),
        el("p", { text: textoDesvio + " Ilumine o rosto de frente, aproxime-se da câmera e acompanhe cada ponto apenas com os olhos." }), acoes, extra];
    }
    quadro.appendChild(el("div", null, corpo));
  };

  /* --------------------------- prova -------------------------------- */

  Sessao.prototype.iniciarProva = function () {
    var eu = this, r = this.regras;
    if (this._fase !== "pronta") throw new Error("A sessão ainda não foi preparada.");
    this._fase = "prova";
    this._inicioProvaT = this._agora();
    document.documentElement.classList.add("pct-em-prova");
    if (this.area) this.area.classList.add("pct-area");

    var criar = function (tipo, titulo, detalhar) {
      var c = r.sinais[tipo];
      return new Condicao(c.avisoSeg * 1000, c.suspensaoSeg * 1000, 700,
        function (sinais, desde) {
          var ev = eu._evento("revisao", tipo, titulo, detalhar ? detalhar(sinais) : null, { evidencia: true });
          ev.detectadoT = ev.t;
          ev.t = Math.max(0, ev.t - Math.round(performance.now() - desde));
          eu._advertir(tipo, ev);
          return ev;
        },
        function (ev, sinais, ms) { eu._suspender(tipo, "Condição mantida por " + segundos(ms) + ", com advertência exibida."); },
        function (ev, ms) { if (ev) ev.duracaoMs = Math.round(ms); eu._encerrarAdvertencia(tipo); });
    };
    this._cond = {
      ausente: criar("rosto_ausente", "Rosto ausente da imagem"),
      varios: criar("mais_de_um_rosto", "Mais de um rosto na imagem"),
      cabeca: criar("cabeca_fora", "Cabeça voltada para fora da tela", function (sinais) {
        return "Desvio de " + Math.round(Math.abs(sinais.dYaw)) + "° na horizontal e " + Math.round(Math.abs(sinais.dPitch)) + "° na vertical em relação à posição calibrada.";
      }),
      olhar: criar("olhar_fora", "Olhar fora da tela", function (sinais) {
        var lados = [];
        if (sinais.gx < 0) lados.push("à esquerda"); if (sinais.gx > 1) lados.push("à direita");
        if (sinais.gy < 0) lados.push("acima"); if (sinais.gy > 1) lados.push("abaixo");
        return "Direção estimada: " + (lados.join(" e ") || "limite da tela") + ".";
      })
    };

    this._evento("sistema", "prova_iniciada", "Prova iniciada", null, {
      dados: { calibragem: this._calib.modo, tecladoRetido: this._tecladoRetido, superficie: this._superficie }
    });
    if (r.gravarTela) this._iniciarGravacao("tela");
    if (r.gravarCamera) this._iniciarGravacao("camera");
    this._armarVigilancia();
    if (r.bloquearAcoes) this._armarBloqueios();
    if (r.mostrarSinais) this._montarSinais();

    this._temporizadores.push(setInterval(function () { eu._amostrarTelemetria(); }, Math.max(0.25, r.telemetriaSeg) * 1000));
    if (r.capturaPeriodicaSeg > 0) {
      this._temporizadores.push(setInterval(function () {
        if (eu._capturas.length >= 400) return;
        var c = { t: eu._agora() }, cam = eu._quadro(eu._camVideo, 240, 0.55), tela = eu._quadro(eu._telaVideo, 800, 0.45);
        if (cam) c.camera = cam; if (tela) c.tela = tela;
        eu._capturas.push(c);
      }, r.capturaPeriodicaSeg * 1000));
    }
    try { navigator.clipboard.writeText("").catch(function () {}); } catch (e) {}
    this._conferirCondicoesIniciais();
  };

  Sessao.prototype._conferirCondicoesIniciais = function () {
    var r = this.regras;
    if (r.exigirTelaCheia && !document.fullscreenElement) this._suspender("tela_cheia", "A prova foi iniciada fora da tela cheia.");
    if (!this._monitorUnico()) this._suspender("monitor", "Há um monitor adicional conectado.");
    if (!document.hasFocus()) this._suspender("foco", "A janela da prova não estava em primeiro plano no início.");
  };

  Sessao.prototype._amostrarTelemetria = function () {
    var s = this._sinais, v = this._voz || {};
    this._telemetria.push([
      this._agora(), s.rostos || 0,
      s.rostos ? arred(s.dYaw || 0, 1) : null, s.rostos ? arred(s.dPitch || 0, 1) : null,
      s.gx === undefined ? null : arred(s.gx, 2), s.gy === undefined ? null : arred(s.gy, 2),
      v.piso === null || v.piso === undefined ? null : arred(v.nivel - v.piso, 1), v.ativa ? 1 : 0,
      document.hasFocus() ? 1 : 0, this._suspensao ? 1 : 0
    ]);
  };

  /* --------------------------- vigilância objetiva ------------------ */

  Sessao.prototype._vigiarTrilhas = function () {
    var eu = this;
    var vigiar = function (trilha, motivo, texto) {
      if (!trilha) return;
      trilha.addEventListener("ended", function () { eu._suspender(motivo, texto + " foi desconectado."); });
      trilha.addEventListener("mute", function () {
        setTimeout(function () { if (trilha.muted && trilha.readyState === "live") eu._suspender(motivo, texto + " deixou de enviar sinal."); }, 2000);
      });
    };
    vigiar(this._camStream.getVideoTracks()[0], "camera", "A câmera");
    vigiar(this._camStream.getAudioTracks()[0], "microfone", "O microfone");
  };

  Sessao.prototype._armarVigilancia = function () {
    var eu = this;
    this._ouvir(global, "blur", function () {
      setTimeout(function () {
        if (!document.hasFocus() && !eu._ocupado) eu._suspender("foco", document.hidden ? "A aba da prova deixou de estar visível." : "Outra janela ou outro aplicativo recebeu o foco.");
      }, 200);
    });
    this._ouvir(document, "visibilitychange", function () {
      if (document.hidden && !eu._ocupado) eu._suspender("foco", "A aba da prova deixou de estar visível.");
    });
    this._ouvir(document, "fullscreenchange", function () {
      if (!document.fullscreenElement && eu.regras.exigirTelaCheia) eu._suspender("tela_cheia", "A tela cheia foi encerrada.");
    });
    this._temporizadores.push(setInterval(function () {
      if (!eu._monitorUnico()) eu._suspender("monitor", "Um monitor adicional foi conectado.");
      if (!document.hasFocus() && !eu._suspensao) eu._suspender("foco", "A janela da prova não está em primeiro plano.");
    }, 1500));
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      this._ouvir(navigator.mediaDevices, "devicechange", function () {
        navigator.mediaDevices.enumerateDevices().then(function (lista) {
          var conta = {};
          lista.forEach(function (d) { conta[d.kind] = (conta[d.kind] || 0) + 1; });
          eu._evento("sistema", "dispositivos", "Alteração nos dispositivos de áudio e vídeo",
            "Câmeras: " + (conta.videoinput || 0) + ". Microfones: " + (conta.audioinput || 0) + ". Saídas de áudio: " + (conta.audiooutput || 0) + ".");
        }).catch(function () {});
      });
    }
    this._ouvir(global, "resize", function () {
      clearTimeout(eu._redimId);
      eu._redimId = setTimeout(function () {
        eu._evento("sistema", "redimensionamento", "Dimensão da janela alterada",
          "Janela: " + global.innerWidth + " x " + global.innerHeight + ". Tela: " + global.screen.width + " x " + global.screen.height + ".");
      }, 400);
    });
    this._ouvir(global, "offline", function () { eu._evento("sistema", "rede", "Conexão com a internet interrompida"); });
    this._ouvir(global, "online", function () { eu._evento("sistema", "rede", "Conexão com a internet restabelecida"); });
    this._ouvir(document.documentElement, "mouseleave", function () {
      if (eu._cursorFora || eu._suspensao) return;
      eu._cursorFora = { ev: eu._evento("atividade", "cursor_fora", "Cursor fora da área da prova"), inicio: performance.now() };
    });
    this._ouvir(document.documentElement, "mouseenter", function () {
      if (!eu._cursorFora) return;
      eu._cursorFora.ev.duracaoMs = Math.round(performance.now() - eu._cursorFora.inicio);
      eu._cursorFora = null;
    });
    this._ouvir(global, "beforeunload", function (e) {
      eu._evento("bloqueio", "saida_da_pagina", "Tentativa de fechar ou recarregar a página");
      e.preventDefault(); e.returnValue = "";
    });
    this._ouvir(global, "beforeprint", function () { eu._bloqueio("impressao", "Tentativa de imprimir a página", ""); });
    try {
      var canal = new BroadcastChannel("proctoria:" + this.prova.id + ":" + this.aluno.id);
      var meuId = String(Math.random()).slice(2);
      canal.onmessage = function (m) {
        if (!m.data || m.data.id === meuId) return;
        if (m.data.tipo === "presente") canal.postMessage({ tipo: "ocupado", id: meuId });
        eu._evento("revisao", "outra_aba", "Prova aberta em outra aba deste navegador", null, { evidencia: true });
      };
      canal.postMessage({ tipo: "presente", id: meuId });
      this._canal = canal;
    } catch (e) {}
  };

  /* --------------------------- bloqueios ---------------------------- */

  Sessao.prototype._bloqueio = function (tipo, titulo, chave) {
    var agora = performance.now(), id = tipo + "|" + chave, ultimo = this._bloqueiosRecentes[id];
    if (ultimo && agora - ultimo.quando < 1500) {
      ultimo.quando = agora; ultimo.ev.dados.vezes++;
      return ultimo.ev;
    }
    var ev = this._evento("bloqueio", tipo, titulo, null, { dados: { vezes: 1 } });
    this._bloqueiosRecentes[id] = { quando: agora, ev: ev };
    return ev;
  };

  Sessao.prototype._armarBloqueios = function () {
    var eu = this;
    var impedir = function (tipo, titulo) {
      return function (e) { e.preventDefault(); e.stopPropagation(); eu._bloqueio(tipo, titulo, ""); };
    };
    this._ouvir(document, "copy", impedir("copiar", "Tentativa de copiar o conteúdo"), true);
    this._ouvir(document, "cut", impedir("recortar", "Tentativa de recortar o conteúdo"), true);
    this._ouvir(document, "paste", impedir("colar", "Tentativa de colar conteúdo"), true);
    this._ouvir(document, "contextmenu", impedir("menu_contexto", "Menu de contexto solicitado"), true);
    this._ouvir(document, "dragstart", function (e) { e.preventDefault(); }, true);
    this._ouvir(document, "selectstart", function (e) {
      var alvo = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      if (alvo && alvo.closest && alvo.closest("input,textarea")) return;
      e.preventDefault();
    }, true);
    this._ouvir(document, "keydown", function (e) {
      var k = e.key || "", mod = e.ctrlKey || e.metaKey, baixa = k.toLowerCase();
      var partes = [];
      if (e.ctrlKey) partes.push("Ctrl"); if (e.metaKey) partes.push("Meta");
      if (e.altKey) partes.push("Alt"); if (e.shiftKey) partes.push("Shift");
      if (["Control", "Meta", "Alt", "Shift", "OS"].indexOf(k) < 0) partes.push(k.length === 1 ? k.toUpperCase() : k);
      var combo = partes.join("+");
      var bloquear = false;
      if (mod && k.length === 1 && "cxvapsufgjortnwldheik".indexOf(baixa) >= 0) bloquear = true;
      if (/^F\d{1,2}$/.test(k)) bloquear = true;
      if (e.altKey && ["Tab", "F4", "ArrowLeft", "ArrowRight", "Escape"].indexOf(k) >= 0) bloquear = true;
      if (mod && k === "Tab") bloquear = true;
      if (bloquear) {
        e.preventDefault(); e.stopPropagation();
        eu._bloqueio("atalho", "Atalho de teclado bloqueado: " + combo, combo);
      } else if ((k === "Meta" || k === "OS") && !e.repeat) {
        eu._bloqueio("tecla_sistema", "Tecla de sistema pressionada", "meta");
      } else if (k === "Escape" && !e.repeat) {
        eu._bloqueio("escape", "Tecla Esc pressionada", "esc");
      }
    }, true);
    this._ouvir(document, "keyup", function (e) {
      if (e.key === "PrintScreen") {
        eu._bloqueio("captura_teclado", "Tecla de captura de tela pressionada", "prtsc");
        try { navigator.clipboard.writeText("").catch(function () {}); } catch (x) {}
      }
    }, true);
  };

  /* --------------------------- suspensão ---------------------------- */

  /* Advertência ao participante. Devolve verdadeiro quando a reincidência leva à suspensão. */
  Sessao.prototype._advertir = function (tipo, ev) {
    var eu = this, agora = performance.now(), c = this.regras.sinais[tipo], janela = this.regras.reincidenciaJanelaMin * 60000;
    this._nAdvertencias++;
    ev.dados = ev.dados || {}; ev.dados.advertencia = this._nAdvertencias;
    var recentes = (this._avisos[tipo] || []).filter(function (t) { return agora - t < janela; });
    recentes.push(agora); this._avisos[tipo] = recentes;
    this._mostrarAdvertencia(tipo, c.suspensaoSeg * 1000);
    if (c.reincidencia > 0 && recentes.length >= c.reincidencia) {
      this._avisos[tipo] = [];
      var texto = recentes.length + " advertências por " + MENSAGENS[tipo][0].toLowerCase() + " em " + this.regras.reincidenciaJanelaMin + " minutos.";
      setTimeout(function () { eu._suspender("reincidencia", texto); }, 0);
      return true;
    }
    return false;
  };

  Sessao.prototype._mostrarAdvertencia = function (tipo, prazoMs) {
    var eu = this, m = MENSAGENS[tipo];
    if (!this._advCaixa) {
      this._advCaixa = el("div", { class: "pct-advertencias", "aria-live": "assertive" });
      document.body.appendChild(this._advCaixa);
      this._temporizadores.push(setInterval(function () { eu._atualizarAdvertencias(); }, 200));
    }
    this._removerAdvertencia(tipo);
    var prazo = el("small");
    var caixa = el("div", { class: "pct-adv", role: "alert" }, [
      el("b", { text: "Advertência " + this._nAdvertencias }), el("strong", { text: m[0] + ". " }), document.createTextNode(m[1]), prazo
    ]);
    this._advAtivas[tipo] = { el: caixa, prazo: prazo, limite: prazoMs > 0 ? performance.now() + prazoMs : null, fim: null };
    this._advCaixa.appendChild(caixa);
    this._atualizarAdvertencias();
  };

  Sessao.prototype._atualizarAdvertencias = function () {
    var eu = this, agora = performance.now();
    Object.keys(this._advAtivas).forEach(function (tipo) {
      var a = eu._advAtivas[tipo];
      if (a.fim !== null) { if (agora - a.fim > 2500) eu._removerAdvertencia(tipo); return; }
      if (a.limite === null) { a.prazo.textContent = ""; return; }
      var resta = Math.max(0, Math.ceil((a.limite - agora) / 1000));
      a.prazo.textContent = "A prova é suspensa em " + resta + " s se a condição continuar.";
    });
  };

  Sessao.prototype._encerrarAdvertencia = function (tipo) {
    var a = this._advAtivas[tipo];
    if (!a || a.fim !== null) return;
    a.fim = performance.now();
    a.el.className = "pct-adv pct-fim";
    a.prazo.textContent = "Advertência registrada no histórico da sessão.";
  };

  Sessao.prototype._removerAdvertencia = function (tipo) {
    var a = this._advAtivas[tipo];
    if (a) { a.el.remove(); delete this._advAtivas[tipo]; }
  };

  Sessao.prototype._suspender = function (motivo, detalhe) {
    if (this._fase !== "prova") return;
    if (this._suspensao && this._suspensao.motivos[motivo]) return;
    var eu = this;
    var ev = this._evento("suspensao", motivo, ROTULOS[motivo] || motivo, detalhe, { evidencia: true });
    if (motivo === "foco") {
      setTimeout(function () {
        var depois = eu._quadro(eu._telaVideo, 960, 0.5);
        if (depois) { ev.evidencias = ev.evidencias || {}; ev.evidencias.telaApos = depois; }
      }, 1500);
    }
    if (this._suspensao) {
      this._suspensao.motivos[motivo] = true; this._suspensao.eventos.push(ev);
      this._atualizarSuspensao();
      return;
    }
    this._ocorrencias++; this._ciclo++;
    ev.dados = { suspensao: this._ocorrencias };
    var limite = this.regras.limiteSuspensoes, bloqueada = limite > 0 && this._ciclo >= limite;
    var motivos = {}; motivos[motivo] = true;
    this._suspensao = { inicio: performance.now(), motivos: motivos, eventos: [ev], bloqueada: bloqueada };
    Object.keys(this._cond || {}).forEach(function (k) { eu._cond[k].fechar(performance.now()); });
    if (this._vozEvento) this._fecharVoz();
    Object.keys(this._advAtivas).forEach(function (t) { eu._removerAdvertencia(t); });
    if (this.area) this.area.style.visibility = "hidden";
    if (this.cfg.aoSuspender) { try { this.cfg.aoSuspender({ motivo: motivo, numero: this._ocorrencias, bloqueada: bloqueada }); } catch (e) {} }
    if (bloqueada) {
      this._nBloqueios++;
      this._suspensao.eventos.push(this._evento("suspensao", "bloqueio_admin", "Prova bloqueada até a liberação do administrador",
        "Suspensão de número " + this._ciclo + " desde a última liberação; o limite configurado é " + limite + "."));
      if (this.cfg.aoBloquear) { try { this.cfg.aoBloquear({ numero: this._nBloqueios, motivo: motivo }); } catch (e) {} }
      this._montarBloqueio();
    } else this._montarSuspensao();
  };

  Sessao.prototype._condicoes = function () {
    var r = this.regras, lista = [
      { id: "camera", texto: "Câmera ativa", ok: this._trilhaViva(this._camStream, "video") },
      { id: "microfone", texto: "Microfone ativo", ok: this._trilhaViva(this._camStream, "audio") },
      { id: "tela", texto: "Tela inteira compartilhada", ok: this._trilhaViva(this._telaStream, "video", true) },
      { id: "foco", texto: "Janela da prova em primeiro plano", ok: document.hasFocus() && !document.hidden }
    ];
    if (r.exigirMonitorUnico) lista.push({ id: "monitor", texto: "Um único monitor conectado", ok: this._monitorUnico() });
    if (this._detector) lista.push({ id: "rosto", texto: "Um rosto identificado na imagem", ok: (this._sinais.rostos || 0) === 1 });
    return lista;
  };

  /* Bloqueio: a retomada depende do administrador (código na tela ou sessao.liberar() chamado pela página). */
  Sessao.prototype._montarBloqueio = function () {
    var eu = this, confirmando = false;
    this._susLista = null;
    this._susMotivos = el("ul", { class: "pct-motivos" });
    var campo = el("input", { class: "pct-campo", type: "password", id: "pct-codigo", autocomplete: "off", inputmode: "numeric" });
    var aviso = el("p", { class: "pct-aviso", role: "status" });
    var liberar = el("button", { class: "pct-botao", type: "button", text: "Liberar a prova" });
    var entregar = el("button", { class: "pct-botao pct-sec", type: "button", text: "Encerrar e entregar a prova" });
    var tentar = function () {
      if (!eu.regras.liberacaoHash) { aviso.textContent = "Nesta prova, a liberação é feita a distância pelo administrador."; return; }
      resumoSHA256(campo.value.trim()).then(function (h) {
        if (h === eu.regras.liberacaoHash) { eu.liberar("código informado na tela do participante"); return; }
        eu._evento("bloqueio", "codigo_incorreto", "Código de liberação incorreto");
        aviso.textContent = "Código incorreto."; campo.value = ""; campo.focus();
      });
    };
    liberar.addEventListener("click", tentar);
    campo.addEventListener("keydown", function (e) { if (e.key === "Enter") tentar(); });
    entregar.addEventListener("click", function () {
      if (!confirmando) { confirmando = true; entregar.textContent = "Confirmar o encerramento"; aviso.textContent = "As respostas registradas até este momento são entregues e a sessão segue para auditoria."; return; }
      entregar.disabled = true;
      eu.encerrar("encerrada_durante_bloqueio").then(function (res) { if (eu.cfg.aoEncerrar) eu.cfg.aoEncerrar(res); });
    });
    this._camada = el("div", { class: "pct-camada", role: "alertdialog", "aria-modal": "true", "aria-label": "Prova bloqueada" }, [
      el("div", { class: "pct-quadro pct-estreito" }, [
        el("div", null, [
          el("p", { class: "pct-sobre", text: "Suspensão " + this._ciclo + " de " + this.regras.limiteSuspensoes }),
          el("h2", { text: "Prova bloqueada" }),
          el("p", { text: "O limite de suspensões foi atingido. A retomada depende da liberação do administrador da prova. O tempo de prova segue em contagem." }),
          el("p", { class: "pct-aviso", text: "Ocorrência registrada:" }),
          this._susMotivos,
          el("label", { class: "pct-rotulo", for: "pct-codigo", text: "Código de liberação do administrador" }),
          campo,
          el("div", { class: "pct-acoes" }, [liberar, entregar]),
          aviso
        ])
      ])
    ]);
    document.body.appendChild(this._camada);
    this._atualizarSuspensao();
    try { campo.focus(); } catch (e) {}
  };

  Sessao.prototype.liberar = function (origem) {
    var s = this._suspensao;
    if (!s || !s.bloqueada) return false;
    s.bloqueada = false; this._ciclo = 0; this._nLiberacoes++;
    this._evento("sistema", "liberacao", "Prova liberada pelo administrador", origem ? "Origem: " + origem + "." : null);
    if (this._camada) { this._camada.remove(); this._camada = null; }
    this._montarSuspensao();
    return true;
  };

  Sessao.prototype._montarSuspensao = function () {
    var eu = this, limite = this.regras.limiteSuspensoes;
    this._susLista = el("ol", { class: "pct-lista" });
    this._susMotivos = el("ul", { class: "pct-motivos" });
    this._susBotao = el("button", { class: "pct-botao", type: "button", text: "Retomar a prova" });
    this._susAviso = el("p", { class: "pct-aviso" });
    this._susBotao.addEventListener("click", function () { eu._acaoRetomar(); });
    var liberada = this._ciclo === 0;
    var contagem = liberada ? "Liberação registrada" : "Suspensão " + this._ciclo + (limite > 0 ? " de " + limite : "");
    var texto = "O tempo de prova segue em contagem. Restabeleça as condições abaixo para retomar.";
    if (limite > 0 && !liberada) texto += " Na suspensão de número " + limite + ", a retomada passa a depender do administrador da prova.";
    this._camada = el("div", { class: "pct-camada", role: "alertdialog", "aria-modal": "true", "aria-label": "Prova suspensa" }, [
      el("div", { class: "pct-quadro pct-estreito" }, [
        el("div", null, [
          el("p", { class: "pct-sobre", text: contagem }),
          el("h2", { text: liberada ? "Prova liberada pelo administrador" : "Prova suspensa" }),
          el("p", { text: texto }),
          el("p", { class: "pct-aviso", text: "Ocorrência registrada:" }),
          this._susMotivos
        ]),
        el("div", null, [this._susLista, el("div", { class: "pct-acoes" }, [this._susBotao]), this._susAviso])
      ])
    ]);
    document.body.appendChild(this._camada);
    clearInterval(this._susTick);
    this._susTick = setInterval(function () { eu._atualizarSuspensao(); }, 300);
    this._atualizarSuspensao();
    try { this._susBotao.focus(); } catch (e) {}
  };

  Sessao.prototype._atualizarSuspensao = function () {
    if (!this._suspensao) return;
    var eu = this;
    if (this._susMotivos) {
      this._susMotivos.textContent = "";
      Object.keys(this._suspensao.motivos).forEach(function (m) { eu._susMotivos.appendChild(el("li", { text: ROTULOS[m] || m })); });
    }
    if (!this._susLista) return;
    var cond = this._condicoes();
    this._susLista.textContent = "";
    cond.forEach(function (c) {
      eu._susLista.appendChild(el("li", { "data-estado": c.ok ? "conforme" : "nao" }, [
        el("span", { class: "pct-ponto-estado" }), el("b", { text: c.texto }),
        el("span", { class: "pct-estado", text: c.ok ? "Conforme" : "Não conforme" }), el("small")
      ]));
    });
    var por = {}; cond.forEach(function (c) { por[c.id] = c.ok; });
    var proxima = !por.camera || !por.microfone ? "midia" : !por.tela ? "tela" : "retomar";
    this._susProxima = proxima;
    this._susBotao.textContent = proxima === "midia" ? "Reativar câmera e microfone" : proxima === "tela" ? "Compartilhar novamente a tela inteira" : "Retomar a prova";
    this._susBotao.disabled = !!this._ocupado || (proxima === "retomar" && (por.monitor === false || por.rosto === false));
  };

  Sessao.prototype._acaoRetomar = function () {
    var eu = this;
    if (this._ocupado) return;
    this._ocupado = true;
    var fim = function () { eu._ocupado = false; eu._atualizarSuspensao(); };
    if (this._susProxima === "midia") {
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: "user" },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      }).then(function (stream) {
        eu._pararGravacao("camera");
        if (eu._camStream) eu._camStream.getTracks().forEach(function (t) { t.stop(); });
        clearInterval(eu._audioId);
        if (eu._audioCtx) eu._audioCtx.close().catch(function () {});
        eu._camStream = stream; eu._camVideo.srcObject = stream;
        eu._camVideo.play().catch(function () {});
        if (eu._sinaisVideo) eu._sinaisVideo.srcObject = stream;
        eu._vigiarTrilhas(); eu._iniciarAudio();
        if (eu.regras.gravarCamera) eu._iniciarGravacao("camera");
        if (eu.regras.gravarTela && eu._trilhaViva(eu._telaStream, "video", true)) { eu._pararGravacao("tela"); eu._iniciarGravacao("tela"); }
        eu._evento("sistema", "midia_reativada", "Câmera e microfone reativados");
      }, function () { eu._susAviso.textContent = "Não foi possível reativar a câmera e o microfone."; }).then(fim, fim);
    } else if (this._susProxima === "tela") {
      this._abrirTela().then(function (ok) {
        eu._susAviso.textContent = ok ? "" : "Selecione a opção Tela inteira na janela do navegador.";
      }).then(fim, fim);
    } else {
      var entrar = this.regras.exigirTelaCheia ? this._entrarTelaCheia() : Promise.resolve();
      entrar.then(function () {
        var pendentes = eu._condicoes().filter(function (c) { return !c.ok; });
        if (pendentes.length) { eu._susAviso.textContent = "Ainda há condição não conforme: " + pendentes[0].texto.toLowerCase() + "."; return; }
        eu._retomar();
      }, function () { eu._susAviso.textContent = "O navegador não autorizou a tela cheia. Repita a ação."; }).then(fim, fim);
    }
  };

  Sessao.prototype._retomar = function () {
    var s = this._suspensao;
    if (!s) return;
    var ms = Math.round(performance.now() - s.inicio);
    s.eventos.forEach(function (ev) { ev.duracaoMs = ms; });
    this._tempoSuspensoMs += ms;
    this._suspensao = null;
    clearInterval(this._susTick);
    if (this._camada) { this._camada.remove(); this._camada = null; }
    this._susLista = null;
    if (this.area) this.area.style.visibility = "";
    this._evento("sistema", "retomada", "Prova retomada", "Suspensão de " + segundos(ms) + ".");
    if (this.cfg.aoRetomar) { try { this.cfg.aoRetomar({ duracaoMs: ms }); } catch (e) {} }
  };

  /* --------------------------- gravação ----------------------------- */

  Sessao.prototype._iniciarGravacao = function (tipo) {
    var eu = this;
    try {
      var origem = tipo === "tela" ? this._telaStream : this._camStream;
      if (!origem || !this._trilhaViva(origem, "video", true)) return;
      var trilhas = origem.getVideoTracks().concat(this._camStream.getAudioTracks());
      var mimes = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      var mime = mimes.filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || "";
      var rec = new MediaRecorder(new MediaStream(trilhas), {
        mimeType: mime, videoBitsPerSecond: tipo === "tela" ? 350000 : 200000, audioBitsPerSecond: 24000
      });
      var g = { tipo: tipo, inicioT: this._agora(), fimT: null, partes: [], bytes: 0, mime: mime || "video/webm", rec: rec };
      rec.ondataavailable = function (e) {
        if (!e.data || !e.data.size) return;
        g.partes.push(e.data); g.bytes += e.data.size;
        if (eu.cfg.aoTrecho) { try { eu.cfg.aoTrecho(tipo, e.data, { segmento: eu._gravacoes[tipo].indexOf(g) + 1, inicioT: g.inicioT }); } catch (x) {} }
      };
      g.parada = new Promise(function (ok) { rec.onstop = function () { g.fimT = eu._agora(); ok(); }; });
      rec.start(4000);
      this._gravacoes[tipo].push(g);
    } catch (e) {
      this._evento("sistema", "gravacao_falhou", "Gravação não iniciada", tipo + ": " + String(e && e.message || e));
    }
  };

  Sessao.prototype._pararGravacao = function (tipo) {
    var lista = this._gravacoes[tipo], g = lista[lista.length - 1];
    if (!g || g.rec.state === "inactive") return Promise.resolve();
    try { g.rec.stop(); } catch (e) { return Promise.resolve(); }
    return Promise.race([g.parada, new Promise(function (ok) { setTimeout(ok, 3000); })]);
  };

  /* --------------------------- painel de sinais --------------------- */

  Sessao.prototype._montarSinais = function () {
    var eu = this;
    this._sinaisVideo = el("video", { autoplay: "", playsinline: "" });
    this._sinaisVideo.muted = true; this._sinaisVideo.srcObject = this._camStream;
    var dl = el("dl");
    var campos = {};
    [["rostos", "Rostos"], ["cabeca", "Cabeça"], ["olhar", "Olhar"], ["voz", "Voz"], ["foco", "Foco"], ["conta", "Suspensões"]].forEach(function (c) {
      campos[c[0]] = el("dd", { text: "" });
      dl.appendChild(el("dt", { text: c[1] })); dl.appendChild(campos[c[0]]);
    });
    this._feed = el("ol", { class: "pct-feed" });
    this._sinaisCaixa = el("div", { class: "pct-sinais", "aria-hidden": "true" }, [
      el("h3", { text: "Painel de demonstração" }), this._sinaisVideo, dl, el("h3", { text: "Alertas" }), this._feed
    ]);
    this._mira = el("div", { class: "pct-mira", "aria-hidden": "true" });
    this._mira.hidden = true;
    document.body.appendChild(this._sinaisCaixa); document.body.appendChild(this._mira);
    document.documentElement.classList.add("pct-com-sinais");
    this._temporizadores.push(setInterval(function () {
      var s = eu._sinais, v = eu._voz || {}, limite = eu.regras.limiteSuspensoes;
      campos.rostos.textContent = String(s.rostos || 0);
      campos.cabeca.textContent = s.rostos ? Math.round(s.dYaw || 0) + "° / " + Math.round(s.dPitch || 0) + "°" + (s.cabecaFora ? " fora" : "") : "sem leitura";
      campos.olhar.textContent = s.gx === undefined ? (eu._calib.modelo ? "sem leitura" : "modo reduzido")
        : Math.round(s.gx * 100) + "% / " + Math.round(s.gy * 100) + "%" + (s.olharFora ? " fora" : "");
      campos.voz.textContent = v.piso === null || v.piso === undefined ? "sem leitura" : Math.round(v.nivel - v.piso) + " dB" + (v.ativa ? " ativa" : "");
      campos.foco.textContent = document.hasFocus() ? "na prova" : "fora";
      campos.conta.textContent = eu._ciclo + (limite > 0 ? " de " + limite : "");
      if (s.gx !== undefined && s.rostos && !eu._suspensao) {
        eu._mira.hidden = false;
        eu._mira.style.left = (limitar(s.gx, 0, 1) * 100) + "%"; eu._mira.style.top = (limitar(s.gy, 0, 1) * 100) + "%";
      } else eu._mira.hidden = true;
    }, 150));
  };

  Sessao.prototype._alimentar = function (ev) {
    var t = this._inicioProvaT === undefined ? 0 : ev.t - this._inicioProvaT;
    var li = el("li", { class: "pct-f-" + ev.classe }, [el("i", { text: relogioCurto(t) }), el("span", { text: ev.titulo })]);
    this._feed.insertBefore(li, this._feed.firstChild);
    while (this._feed.children.length > 7) this._feed.removeChild(this._feed.lastChild);
  };

  /* --------------------------- encerramento ------------------------- */

  Sessao.prototype._desligar = function () {
    var eu = this;
    this._ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); });
    this._ouvintes = [];
    this._temporizadores.forEach(function (t) { clearInterval(t); });
    this._temporizadores = [];
    clearInterval(this._tickVerif); clearInterval(this._susTick); clearInterval(this._audioId); clearTimeout(this._lacoId);
    if (this._canal) { try { this._canal.close(); } catch (e) {} }
    [this._camStream, this._telaStream].forEach(function (s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); });
    if (this._audioCtx) { try { this._audioCtx.close(); } catch (e) {} }
    if (this._detector && this._detector.close) { try { this._detector.close(); } catch (e) {} }
    this._detector = null;
    ["_camada", "_sinaisCaixa", "_mira", "_advCaixa"].forEach(function (k) { if (eu[k]) { eu[k].remove(); eu[k] = null; } });
    this._feed = null; this._advAtivas = {};
    document.documentElement.classList.remove("pct-em-prova", "pct-com-sinais");
    if (this.area) { this.area.classList.remove("pct-area"); this.area.style.visibility = ""; }
    if (navigator.keyboard && navigator.keyboard.unlock) { try { navigator.keyboard.unlock(); } catch (e) {} }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  };

  Sessao.prototype.encerrar = function (situacao) {
    var eu = this;
    if (this._resultado) return this._resultado;
    situacao = situacao || "entregue";
    var agora = performance.now();
    Object.keys(this._cond || {}).forEach(function (k) { eu._cond[k].fechar(agora); });
    if (this._vozEvento) this._fecharVoz();
    if (this._suspensao) {
      var ms = Math.round(agora - this._suspensao.inicio);
      this._suspensao.eventos.forEach(function (ev) { ev.duracaoMs = ms; });
      this._tempoSuspensoMs += ms; this._suspensao = null;
    }
    this._evento("sistema", "sessao_encerrada", "Sessão encerrada",
      { entregue: "Prova entregue pelo participante.", encerrada_durante_bloqueio: "Encerramento pelo participante durante o bloqueio.", interrompida: "Sessão interrompida." }[situacao] || situacao);
    var fimT = this._agora();
    var faseAnterior = this._fase;
    this._fase = "encerrando";
    this._resultado = Promise.all([this._pararGravacao("tela"), this._pararGravacao("camera")]).then(function () {
      return new Promise(function (ok) { setTimeout(ok, 400); });   // tempo para os trechos de áudio de evidência
    }).then(function () {
      eu._fase = "encerrada";
      eu._desligar();
      var arquivos = [], gravacoes = { tela: [], camera: [] };
      var base = "proctoria_" + String(eu.prova.id).replace(/[^\w-]+/g, "-") + "_" + String(eu.aluno.id).replace(/[^\w-]+/g, "-");
      ["tela", "camera"].forEach(function (tipo) {
        eu._gravacoes[tipo].forEach(function (g, i) {
          if (!g.partes.length) return;
          var nome = base + "_" + tipo + "_" + (i + 1) + ".webm";
          arquivos.push({ nome: nome, tipo: tipo, blob: new Blob(g.partes, { type: "video/webm" }) });
          gravacoes[tipo].push({ arquivo: nome, inicioT: g.inicioT, fimT: g.fimT === null ? fimT : g.fimT, bytes: g.bytes, mime: g.mime });
        });
      });
      var conta = function (classe) { return eu._eventos.filter(function (e) { return e.classe === classe; }).length; };
      var porTipo = {};
      eu._eventos.forEach(function (e) { if (e.classe !== "sistema" && e.classe !== "atividade") porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1; });
      var registro = {
        formato: "proctoria-registro", versao: VERSAO,
        aluno: eu.aluno, prova: eu.prova, regras: eu.regras,
        situacao: situacao, criadaEm: eu._criadaEm,
        inicioProvaT: eu._inicioProvaT === undefined ? null : eu._inicioProvaT, fimT: fimT,
        ambiente: {
          navegador: navigator.userAgent, idioma: navigator.language,
          fuso: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "",
          tela: { largura: global.screen.width, altura: global.screen.height, densidade: global.devicePixelRatio },
          superficieCompartilhada: eu._superficie || null, tecladoRetido: eu._tecladoRetido,
          detector: eu._delegado || null,
          calibragem: { modo: eu._calib.modo, desvio: eu._calib.desvio, tentativas: eu._calib.tentativas }
        },
        resumo: {
          duracaoProvaMs: eu._inicioProvaT === undefined ? 0 : fimT - eu._inicioProvaT,
          suspensoes: eu._ocorrencias, tempoSuspensoMs: eu._tempoSuspensoMs,
          advertencias: eu._nAdvertencias, bloqueios: eu._nBloqueios, liberacoes: eu._nLiberacoes,
          sinaisParaRevisao: conta("revisao"), acoesBloqueadas: conta("bloqueio"), porTipo: porTipo
        },
        eventos: eu._eventos.slice().sort(function (a, b) { return a.t - b.t || a.n - b.n; }), capturas: eu._capturas,
        telemetria: { colunas: ["t", "rostos", "desvioYaw", "desvioPitch", "olharX", "olharY", "vozDb", "vozAtiva", "foco", "suspensa"], linhas: eu._telemetria },
        gravacoes: gravacoes,
        revisao: { decisoes: {}, parecer: "" }
      };
      return { registro: registro, arquivos: arquivos, nomeBase: base, faseAnterior: faseAnterior };
    });
    return this._resultado;
  };

  global.Proctoria = {
    versao: VERSAO,
    regrasPadrao: REGRAS_PADRAO,
    criar: function (cfg) { return new Sessao(cfg); },
    resumoSHA256: resumoSHA256,
    _interno: { ajustar: ajustar, prever: prever, desvioCalibragem: desvioCalibragem, Condicao: Condicao, caracteristicas: caracteristicas }
  };
})(typeof window !== "undefined" ? window : globalThis);
