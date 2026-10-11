/*! Proctoria 0.2.0 | painel de auditoria da sessão */
(function (global) {
  "use strict";

  var SELOS = { suspensao: "Suspensão", revisao: "Advertência", bloqueio: "Ação bloqueada", atividade: "Atividade", sistema: "Sistema" };
  var SITUACOES = { entregue: "Prova entregue", encerrada_durante_bloqueio: "Encerrada pelo participante durante o bloqueio",
    encerrada_por_limite: "Encerrada por limite de suspensões", interrompida: "Interrompida" };
  var FILTROS = [
    ["principais", "Ocorrências", ["suspensao", "revisao", "bloqueio"]],
    ["suspensao", "Suspensões", ["suspensao"]],
    ["revisao", "Advertências", ["revisao"]],
    ["bloqueio", "Ações bloqueadas", ["bloqueio"]],
    ["atividade", "Atividade", ["atividade"]],
    ["sistema", "Sistema", ["sistema"]],
    ["todos", "Registro completo", ["suspensao", "revisao", "bloqueio", "atividade", "sistema"]]
  ];

  var CSS = [
    ".ppn{--ppn-tinta:#1B1512;--ppn-tinta2:#5A4B40;--ppn-papel:#FFFDF8;--ppn-linha:rgba(27,21,18,.16);--ppn-acento:#B04A1C;--ppn-ouro:#C99A57;--ppn-critico:#A8321F;--ppn-atencao:#8A6410;--ppn-neutro:#46586A;color:var(--ppn-tinta);font:400 18px/1.55 Lora,Georgia,serif;display:grid;gap:36px}",
    ".ppn *{box-sizing:border-box}",
    ".ppn [hidden]{display:none!important}",
    ".ppn h2{font:600 34px/1.15 Poppins,'Segoe UI',system-ui,sans-serif;margin:0;text-wrap:balance}",
    ".ppn h3{font:600 22px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;margin:0 0 14px}",
    ".ppn-sobre{font:600 13px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ppn-acento);margin:0 0 8px}",
    ".ppn-dados{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px 28px;margin:20px 0 0}",
    ".ppn-dados div{min-width:0}",
    ".ppn-dados dt{font:600 12px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--ppn-tinta2)}",
    ".ppn-dados dd{margin:3px 0 0;overflow-wrap:anywhere}",
    ".ppn-numeros{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0;border-top:2px solid var(--ppn-tinta);border-bottom:1px solid var(--ppn-linha)}",
    ".ppn-numeros div{padding:16px 18px 16px 0}",
    ".ppn-numeros b{display:block;font:600 40px/1 Poppins,'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}",
    ".ppn-numeros span{display:block;margin-top:6px;font:500 15px/1.3 Poppins,'Segoe UI',system-ui,sans-serif;color:var(--ppn-tinta2)}",
    ".ppn-faixas{display:grid;gap:8px}",
    ".ppn-faixa{display:grid;grid-template-columns:170px minmax(0,1fr);gap:14px;align-items:center}",
    ".ppn-faixa>span{font:500 15px/1.2 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".ppn-trilho{position:relative;height:30px;background:var(--ppn-papel);border:1px solid var(--ppn-linha);border-radius:4px}",
    ".ppn-marca{position:absolute;top:3px;bottom:3px;min-width:6px;border:0;border-radius:2px;padding:0;cursor:pointer}",
    ".ppn-marca:hover,.ppn-marca:focus-visible{outline:2px solid var(--ppn-tinta);outline-offset:1px}",
    ".ppn-c-suspensao{background:var(--ppn-critico)}.ppn-c-revisao{background:var(--ppn-atencao)}.ppn-c-bloqueio{background:var(--ppn-neutro)}",
    ".ppn-eixo{position:relative;height:24px;font:500 14px/1 Poppins,'Segoe UI',system-ui,sans-serif;color:var(--ppn-tinta2);font-variant-numeric:tabular-nums}",
    ".ppn-eixo i{position:absolute;top:6px;font-style:normal;transform:translateX(-50%)}",
    ".ppn-eixo i:first-child{transform:none}.ppn-eixo i:last-child{transform:translateX(-100%)}",
    ".ppn-videos{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:20px;align-items:start}",
    "@media (max-width:760px){.ppn-videos{grid-template-columns:minmax(0,1fr)}.ppn-faixa{grid-template-columns:minmax(0,1fr);gap:4px}}",
    ".ppn-videos figure{margin:0;min-width:0}",
    ".ppn-videos video{width:100%;display:block;background:#1B1512;border-radius:4px;aspect-ratio:16/10}",
    ".ppn-videos figure:last-child video{aspect-ratio:4/3}",
    ".ppn-videos figcaption{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:space-between;margin-top:8px;font:500 15px/1.3 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".ppn-nota{font-size:16px;color:var(--ppn-tinta2);margin:10px 0 0;max-width:68ch}",
    ".ppn-bt{font:600 15px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;color:var(--ppn-tinta);background:transparent;border:1px solid var(--ppn-tinta);border-radius:5px;padding:9px 14px;cursor:pointer}",
    ".ppn-bt:hover{background:rgba(27,21,18,.07)}",
    ".ppn-bt:focus-visible,.ppn-tempo:focus-visible,.ppn-mini:focus-visible{outline:3px solid var(--ppn-acento);outline-offset:2px}",
    ".ppn-bt[aria-pressed=true]{background:var(--ppn-tinta);color:#FAF5EC}",
    ".ppn-bt.ppn-forte{background:var(--ppn-acento);border-color:var(--ppn-acento);color:#fff}",
    ".ppn-bt.ppn-forte:hover{background:#983f17}",
    ".ppn-filtros{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}",
    ".ppn-lista{list-style:none;margin:0;padding:0}",
    ".ppn-ev{display:grid;grid-template-columns:86px minmax(0,1fr);gap:16px;padding:16px 0;border-bottom:1px solid var(--ppn-linha)}",
    ".ppn-ev.ppn-foco{background:rgba(201,154,87,.18);box-shadow:-12px 0 0 rgba(201,154,87,.18),12px 0 0 rgba(201,154,87,.18)}",
    ".ppn-tempo{font:600 18px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums;color:var(--ppn-acento);background:none;border:0;padding:2px 0;text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:3px;align-self:start}",
    ".ppn-tempo[disabled]{color:var(--ppn-tinta2);text-decoration:none;cursor:default;font-size:14px}",
    ".ppn-topo{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}",
    ".ppn-topo strong{font:600 18px/1.3 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".ppn-selo{font:600 12px/1 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:5px 8px;border-radius:3px;color:#fff;white-space:nowrap}",
    ".ppn-c-atividade,.ppn-c-sistema{background:transparent;color:var(--ppn-tinta2);border:1px solid var(--ppn-linha)}",
    ".ppn-dur{font:500 15px/1.3 Poppins,'Segoe UI',system-ui,sans-serif;color:var(--ppn-tinta2)}",
    ".ppn-det{margin:6px 0 0;max-width:70ch;overflow-wrap:anywhere}",
    ".ppn-evid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-top:12px}",
    ".ppn-mini{background:none;border:1px solid var(--ppn-linha);border-radius:4px;padding:0;cursor:zoom-in;overflow:hidden;text-align:left}",
    ".ppn-mini img{display:block;height:96px;width:auto;max-width:100%}",
    ".ppn-mini.ppn-grande img{height:auto;width:100%;max-height:420px;object-fit:contain;background:#1B1512}",
    ".ppn-ambiente{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px;align-items:start}",
    "@media (max-width:760px){.ppn-ambiente{grid-template-columns:minmax(0,1fr)}}",
    ".ppn-mini span{display:block;font:500 13px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;padding:5px 7px;color:var(--ppn-tinta2)}",
    ".ppn-evid audio{height:40px;max-width:100%}",
    ".ppn-decisao{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
    ".ppn-vazio{padding:18px 0;color:var(--ppn-tinta2)}",
    ".ppn-capturas{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:14px}",
    ".ppn textarea{width:100%;min-height:120px;font:400 18px/1.5 Lora,Georgia,serif;color:var(--ppn-tinta);background:var(--ppn-papel);border:1px solid var(--ppn-tinta2);border-radius:4px;padding:12px}",
    ".ppn-acoes{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:center}",
    ".ppn summary{cursor:pointer;font:600 22px/1.2 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".ppn-ampliada{border:0;padding:0;background:#1B1512;max-width:min(96vw,1400px);max-height:94vh}",
    ".ppn-ampliada::backdrop{background:rgba(27,21,18,.8)}",
    ".ppn-ampliada img{display:block;max-width:100%;max-height:calc(94vh - 56px)}",
    ".ppn-ampliada form{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;color:#FAF5EC;font:500 15px/1.2 Poppins,'Segoe UI',system-ui,sans-serif}",
    ".ppn-ampliada button{font:600 15px/1 Poppins,'Segoe UI',system-ui,sans-serif;background:#FAF5EC;color:#1B1512;border:0;border-radius:4px;padding:9px 14px;cursor:pointer}"
  ].join("\n");

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
  function doisDigitos(n) { return (n < 10 ? "0" : "") + n; }
  function relogio(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" : "") + doisDigitos(m) + ":" + doisDigitos(s % 60);
  }
  function duracao(ms) {
    if (ms === undefined || ms === null) return "";
    if (ms < 1000) return "menos de 1 s";
    var s = Math.round(ms / 1000);
    return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
  }
  function tamanho(bytes) { return bytes > 1048576 ? (bytes / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"; }

  function baixar(nome, blob) {
    var url = URL.createObjectURL(blob), a = el("a", { href: url, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* Gravações do navegador não trazem a duração no cabeçalho; este passo faz o player calculá-la. */
  function prepararVideo(v, aoPronto) {
    var pronto = function () { v.removeEventListener("timeupdate", pronto); v.currentTime = 0; if (aoPronto) aoPronto(); };
    v.addEventListener("loadedmetadata", function () {
      if (v.duration === Infinity || isNaN(v.duration)) { v.addEventListener("timeupdate", pronto); v.currentTime = 1e101; }
      else if (aoPronto) aoPronto();
    }, { once: true });
  }

  function montar(container, registro, arquivos, opcoes) {
    opcoes = opcoes || {};
    arquivos = arquivos || [];
    if (!document.getElementById("ppn-estilos")) {
      var st = el("style", { id: "ppn-estilos" }); st.textContent = CSS; document.head.appendChild(st);
    }
    registro.revisao = registro.revisao || { decisoes: {}, parecer: "" };
    registro.revisao.decisoes = registro.revisao.decisoes || {};
    (registro.eventos || []).forEach(function (e) { if (e.classe === "objetiva") e.classe = "suspensao"; });   // registros da versão 0.1
    var inicio = registro.inicioProvaT || 0, fim = registro.fimT || inicio + 1, total = Math.max(1, fim - inicio);
    var r = registro.resumo || {}, amb = registro.ambiente || {}, cal = amb.calibragem || {};
    var urls = {}, blobs = {};
    arquivos.forEach(function (a) { urls[a.nome] = URL.createObjectURL(a.blob); blobs[a.nome] = a.blob; });
    var nomeBase = opcoes.nomeBase || ("proctoria_" + ((registro.prova || {}).id || "prova") + "_" + ((registro.aluno || {}).id || "participante"));

    var raiz = el("section", { class: "ppn" });
    container.textContent = ""; container.appendChild(raiz);

    /* cabeçalho */
    var dado = function (rotulo, valor) { return el("div", null, [el("dt", { text: rotulo }), el("dd", { text: valor })]); };
    var textoCal = cal.modo === "completa" ? "Completa, desvio médio de " + Math.round((cal.desvio || 0) * 100) + "% da tela"
      : cal.modo === "reduzida" ? "Reduzida: olhar acompanhado pela posição da cabeça" : "Não realizada";
    raiz.appendChild(el("header", null, [
      el("p", { class: "ppn-sobre", text: "Registro da sessão" }),
      el("h2", { text: (registro.aluno || {}).nome || "Participante" }),
      el("dl", { class: "ppn-dados" }, [
        dado("Prova", (registro.prova || {}).titulo || ""),
        dado("Situação", SITUACOES[registro.situacao] || registro.situacao || ""),
        dado("Início da sessão", registro.criadaEm ? new Date(registro.criadaEm).toLocaleString("pt-BR") : ""),
        dado("Duração da prova", relogio(r.duracaoProvaMs || 0)),
        dado("Calibragem do olhar", textoCal),
        dado("Tela compartilhada", amb.superficieCompartilhada === "monitor" ? "Tela inteira" : (amb.superficieCompartilhada || "Não informada")),
        dado("Atalhos de sistema retidos", amb.tecladoRetido ? "Sim, pelo navegador em tela cheia" : "Não disponível neste navegador"),
        dado("Bloqueios e liberações", "Bloqueios: " + (r.bloqueios || 0) + ". Liberações do administrador: " + (r.liberacoes || 0) + "."),
        dado("Telemetria", ((registro.telemetria || {}).linhas || []).length + " leituras incluídas no arquivo")
      ])
    ]));

    /* números */
    var numero = function (valor, rotulo) { return el("div", null, [el("b", { text: String(valor) }), el("span", { text: rotulo })]); };
    raiz.appendChild(el("div", { class: "ppn-numeros" }, [
      numero(r.suspensoes || 0, "suspensões da prova"),
      numero(relogio(r.tempoSuspensoMs || 0), "tempo em suspensão"),
      numero(r.advertencias === undefined ? (r.sinaisParaRevisao || 0) : r.advertencias, "advertências ao participante"),
      numero(r.acoesBloqueadas || 0, "ações bloqueadas")
    ]));

    /* linha do tempo */
    var linhaTempo = el("div", null, [el("h3", { text: "Linha do tempo da prova" })]);
    var faixas = el("div", { class: "ppn-faixas" });
    [["suspensao", "Suspensões"], ["revisao", "Advertências"], ["bloqueio", "Ações bloqueadas"]].forEach(function (f) {
      var trilho = el("div", { class: "ppn-trilho" });
      (registro.eventos || []).forEach(function (ev) {
        if (ev.classe !== f[0] || ev.t < inicio) return;
        var esq = (ev.t - inicio) / total * 100, larg = Math.max(0, (ev.duracaoMs || 0) / total * 100);
        var m = el("button", { class: "ppn-marca ppn-c-" + f[0], type: "button", title: relogio(ev.t - inicio) + " " + ev.titulo, "aria-label": relogio(ev.t - inicio) + " " + ev.titulo });
        m.style.left = Math.min(99.4, esq) + "%"; m.style.width = Math.min(100 - esq, larg) + "%";
        m.addEventListener("click", function () { focar(ev); });
        trilho.appendChild(m);
      });
      faixas.appendChild(el("div", { class: "ppn-faixa" }, [el("span", { text: f[1] }), trilho]));
    });
    var eixo = el("div", { class: "ppn-eixo" });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (p) { var i = el("i", { text: relogio(total * p) }); i.style.left = (p * 100) + "%"; eixo.appendChild(i); });
    faixas.appendChild(el("div", { class: "ppn-faixa" }, [el("span", { text: "" }), eixo]));
    linhaTempo.appendChild(faixas);
    raiz.appendChild(linhaTempo);

    /* gravações */
    var videos = {}, legendas = {};
    var blocoVideos = el("div", null, [el("h3", { text: "Gravações da sessão" })]);
    var grade = el("div", { class: "ppn-videos" });
    [["tela", "Tela com o áudio do microfone"], ["camera", "Câmera"]].forEach(function (t) {
      var v = el("video", { controls: "", preload: "metadata", playsinline: "" });
      videos[t[0]] = v;
      legendas[t[0]] = el("figcaption", null, [el("span", { text: t[1] })]);
      grade.appendChild(el("figure", null, [v, legendas[t[0]]]));
    });
    blocoVideos.appendChild(grade);
    var notaVideos = el("p", { class: "ppn-nota" });
    blocoVideos.appendChild(notaVideos);
    var entrada = el("input", { type: "file", accept: ".webm,video/webm", multiple: "", id: "ppn-arquivos-" + Date.now() });
    entrada.addEventListener("change", function () {
      Array.prototype.forEach.call(entrada.files, function (f) { urls[f.name] = URL.createObjectURL(f); blobs[f.name] = f; });
      carregarVideos();
    });
    var rotuloEntrada = el("label", { for: entrada.id, class: "ppn-nota", text: "Carregar os arquivos de gravação (.webm) desta sessão: " });
    rotuloEntrada.appendChild(entrada);
    blocoVideos.appendChild(rotuloEntrada);
    raiz.appendChild(blocoVideos);

    function segmentoDe(tipo, t) {
      var segs = ((registro.gravacoes || {})[tipo] || []).filter(function (g) { return urls[g.arquivo]; });
      if (!segs.length) return null;
      var achado = null;
      segs.forEach(function (g) { if (t >= g.inicioT && t <= g.fimT) achado = g; });
      if (achado) return achado;
      return segs.reduce(function (a, b) { return Math.abs(b.inicioT - t) < Math.abs(a.inicioT - t) ? b : a; });
    }
    function abrirSegmento(tipo, g, alvo) {
      var v = videos[tipo];
      if (v.getAttribute("data-arquivo") === g.arquivo) { if (alvo !== undefined) v.currentTime = alvo; return; }
      v.setAttribute("data-arquivo", g.arquivo);
      prepararVideo(v, function () { if (alvo !== undefined) v.currentTime = alvo; });
      v.src = urls[g.arquivo];
    }
    function carregarVideos() {
      var faltam = [];
      ["tela", "camera"].forEach(function (tipo) {
        var todos = (registro.gravacoes || {})[tipo] || [];
        var g = segmentoDe(tipo, inicio);
        var cap = legendas[tipo];
        while (cap.childNodes.length > 1) cap.removeChild(cap.lastChild);
        if (g) {
          abrirSegmento(tipo, g);
          todos.forEach(function (seg, i) {
            if (!blobs[seg.arquivo]) return;
            var b = el("button", { class: "ppn-bt", type: "button", text: "Baixar" + (todos.length > 1 ? " o trecho " + (i + 1) : "") + " (" + tamanho(blobs[seg.arquivo].size) + ")" });
            b.addEventListener("click", function () { baixar(seg.arquivo, blobs[seg.arquivo]); });
            cap.appendChild(b);
          });
        }
        todos.forEach(function (seg) { if (!urls[seg.arquivo]) faltam.push(seg.arquivo); });
        if (!todos.length) cap.appendChild(el("span", { class: "ppn-dur", text: "Gravação não realizada nesta sessão." }));
      });
      notaVideos.textContent = faltam.length ? "Arquivos de gravação ainda não carregados: " + faltam.join(", ") + "."
        : "O instante de cada ocorrência abre as duas gravações dois segundos antes do registro.";
      rotuloEntrada.hidden = !faltam.length;
    }
    function irPara(t) {
      ["tela", "camera"].forEach(function (tipo) {
        var g = segmentoDe(tipo, t);
        if (g) abrirSegmento(tipo, g, Math.max(0, (t - g.inicioT) / 1000 - 2));
      });
    }

    /* ocorrências */
    var filtroAtual = FILTROS[0], itens = {};
    var blocoEventos = el("div", null, [el("h3", { text: "Ocorrências e registro" })]);
    var barra = el("div", { class: "ppn-filtros", role: "group", "aria-label": "Filtro do registro" });
    var lista = el("ol", { class: "ppn-lista" });
    FILTROS.forEach(function (f) {
      var n = (registro.eventos || []).filter(function (e) { return f[2].indexOf(e.classe) >= 0; }).length;
      var b = el("button", { class: "ppn-bt", type: "button", "aria-pressed": f === filtroAtual ? "true" : "false", text: f[1] + " (" + n + ")" });
      b.addEventListener("click", function () {
        filtroAtual = f;
        Array.prototype.forEach.call(barra.children, function (c) { c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
        desenharLista();
      });
      barra.appendChild(b);
    });
    blocoEventos.appendChild(barra); blocoEventos.appendChild(lista);
    raiz.appendChild(blocoEventos);

    var ampliada = el("dialog", { class: "ppn-ampliada" });
    var imgAmpliada = el("img", { alt: "" }), tituloAmpliada = el("span");
    ampliada.appendChild(imgAmpliada);
    ampliada.appendChild(el("form", { method: "dialog" }, [tituloAmpliada, el("button", { text: "Fechar" })]));
    raiz.appendChild(ampliada);
    function miniatura(src, rotulo, contexto) {
      var b = el("button", { class: "ppn-mini", type: "button" }, [el("img", { src: src, alt: rotulo + ", " + contexto }), el("span", { text: rotulo })]);
      b.addEventListener("click", function () { imgAmpliada.src = src; imgAmpliada.alt = rotulo + ", " + contexto; tituloAmpliada.textContent = rotulo + " · " + contexto; ampliada.showModal(); });
      return b;
    }

    var amb = (registro.eventos || []).filter(function (e) { return e.tipo === "ambiente" && e.evidencias && e.evidencias.tela; })[0];
    if (amb) {
      var grande = miniatura(amb.evidencias.tela, "Tela no instante da declaração", "antes da prova");
      grande.className = "ppn-mini ppn-grande";
      var blocoAmb = el("div", null, [el("h3", { text: "Área de trabalho antes da prova" }),
        el("div", { class: "ppn-ambiente" }, [grande, el("p", { class: "ppn-nota", text: (amb.detalhe || "") + " A imagem mostra as janelas e os aplicativos visíveis naquele instante." })])]);
      raiz.insertBefore(blocoAmb, linhaTempo);
    }

    function desenharLista() {
      lista.textContent = ""; itens = {};
      var evs = (registro.eventos || []).filter(function (e) { return filtroAtual[2].indexOf(e.classe) >= 0; });
      if (!evs.length) { lista.appendChild(el("li", { class: "ppn-vazio", text: "Nenhum registro nesta categoria." })); return; }
      evs.forEach(function (ev) {
        var naProva = registro.inicioProvaT !== null && ev.t >= inicio;
        var quando = naProva ? relogio(ev.t - inicio) : "Antes do início";
        var bt = el("button", { class: "ppn-tempo", type: "button", text: quando });
        if (naProva) { bt.title = "Abrir as gravações neste instante"; bt.addEventListener("click", function () { irPara(ev.t); videos.tela.scrollIntoView({ block: "center", behavior: "smooth" }); }); }
        else bt.disabled = true;
        var topo = el("div", { class: "ppn-topo" }, [
          el("span", { class: "ppn-selo ppn-c-" + ev.classe, text: ev.classe === "revisao" && !(ev.dados && ev.dados.advertencia) ? "Para revisão" : (SELOS[ev.classe] || ev.classe) }),
          el("strong", { text: ev.titulo }),
          ev.duracaoMs !== undefined ? el("span", { class: "ppn-dur", text: "Duração: " + duracao(ev.duracaoMs) }) : null
        ]);
        var corpo = el("div", null, [topo]);
        var det = ev.detalhe || "";
        if (ev.dados) {
          var pares = Object.keys(ev.dados).filter(function (k) { return k !== "vezes" && k !== "suspensao" && k !== "advertencia" && typeof ev.dados[k] !== "object"; })
            .map(function (k) { return k + ": " + ev.dados[k]; });
          if (ev.dados.vezes > 1) pares.push("repetido " + ev.dados.vezes + " vezes em sequência");
          if (ev.dados.suspensao) pares.push("suspensão de número " + ev.dados.suspensao);
          if (ev.dados.advertencia) pares.push("advertência de número " + ev.dados.advertencia);
          if (pares.length) det = (det ? det + " " : "") + pares.join(" · ");
        }
        if (det) corpo.appendChild(el("p", { class: "ppn-det", text: det }));
        var e = ev.evidencias;
        if (e && (e.camera || e.tela || e.telaApos || e.audio)) {
          var caixa = el("div", { class: "ppn-evid" });
          if (e.camera) caixa.appendChild(miniatura(e.camera, "Câmera", quando + " " + ev.titulo));
          if (e.tela) caixa.appendChild(miniatura(e.tela, "Tela", quando + " " + ev.titulo));
          if (e.telaApos) caixa.appendChild(miniatura(e.telaApos, "Tela 1,5 s depois", quando + " " + ev.titulo));
          if (e.audio) caixa.appendChild(el("audio", { controls: "", src: e.audio, preload: "none" }));
          corpo.appendChild(caixa);
        }
        if (ev.classe === "suspensao" || ev.classe === "revisao") {
          var dec = el("div", { class: "ppn-decisao" });
          [["relevante", "Relevante"], ["desconsiderado", "Desconsiderar"]].forEach(function (o) {
            var b = el("button", { class: "ppn-bt", type: "button", text: o[1], "aria-pressed": registro.revisao.decisoes[ev.n] === o[0] ? "true" : "false" });
            b.addEventListener("click", function () {
              var novo = registro.revisao.decisoes[ev.n] === o[0] ? undefined : o[0];
              if (novo) registro.revisao.decisoes[ev.n] = novo; else delete registro.revisao.decisoes[ev.n];
              Array.prototype.forEach.call(dec.children, function (c) { c.setAttribute("aria-pressed", c === b && novo ? "true" : "false"); });
            });
            dec.appendChild(b);
          });
          corpo.appendChild(dec);
        }
        var li = el("li", { class: "ppn-ev" }, [bt, corpo]);
        itens[ev.n] = li; lista.appendChild(li);
      });
    }
    function focar(ev) {
      if (!itens[ev.n]) {
        filtroAtual = FILTROS[0];
        Array.prototype.forEach.call(barra.children, function (c, i) { c.setAttribute("aria-pressed", i === 0 ? "true" : "false"); });
        desenharLista();
      }
      Object.keys(itens).forEach(function (k) { itens[k].classList.remove("ppn-foco"); });
      if (itens[ev.n]) { itens[ev.n].classList.add("ppn-foco"); itens[ev.n].scrollIntoView({ block: "center", behavior: "smooth" }); }
      irPara(ev.t);
    }

    /* capturas periódicas */
    var caps = registro.capturas || [];
    if (caps.length) {
      var gradeCaps = el("div", { class: "ppn-capturas" });
      var detalhes = el("details", null, [el("summary", { text: "Capturas periódicas (" + caps.length + ")" }), gradeCaps]);
      detalhes.addEventListener("toggle", function () {
        if (!detalhes.open || gradeCaps.childNodes.length) return;
        caps.forEach(function (c) {
          var quando = relogio(c.t - inicio);
          if (c.tela) gradeCaps.appendChild(miniatura(c.tela, "Tela " + quando, "captura periódica"));
          if (c.camera) gradeCaps.appendChild(miniatura(c.camera, "Câmera " + quando, "captura periódica"));
        });
      });
      raiz.appendChild(detalhes);
    }

    /* parecer */
    var campo = el("textarea", { id: "ppn-parecer-" + Date.now(), placeholder: "Conclusão da auditoria, com os fundamentos da decisão." });
    campo.value = registro.revisao.parecer || "";
    campo.addEventListener("input", function () { registro.revisao.parecer = campo.value; });
    var salvar = el("button", { class: "ppn-bt ppn-forte", type: "button", text: "Baixar o registro com a revisão" });
    salvar.addEventListener("click", function () {
      baixar(nomeBase + "_registro.json", new Blob([JSON.stringify(registro)], { type: "application/json" }));
    });
    raiz.appendChild(el("div", null, [
      el("h3", null, [el("label", { for: campo.id, text: "Parecer da revisão" })]),
      campo,
      el("div", { class: "ppn-acoes" }, [salvar]),
      el("p", { class: "ppn-nota", text: "As marcações de cada ocorrência e o parecer seguem no arquivo de registro." })
    ]));

    desenharLista();
    carregarVideos();
    return { irPara: irPara };
  }

  global.ProctoriaPainel = { montar: montar, baixar: baixar, tamanho: tamanho, relogio: relogio };
})(window);
