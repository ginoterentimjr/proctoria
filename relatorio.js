/*! Proctoria 0.5.0 | relatório formal de ocorrências da sessão, pronto para impressão em PDF */
(function (global) {
  "use strict";

  var CLASSES = { suspensao: "Suspensão", revisao: "Advertência", bloqueio: "Ação bloqueada", sistema: "Registro da sessão" };
  var SITUACOES = {
    entregue: "Prova entregue pelo participante",
    encerrada_durante_bloqueio: "Encerrada pelo participante durante o bloqueio",
    invalidada: "Invalidada por ausência da câmera",
    encerrada_pelo_administrador: "Encerrada por determinação do administrador",
    tempo_esgotado: "Encerrada por tempo esgotado",
    em_andamento: "Em andamento",
    interrompida: "Interrompida"
  };
  var SISTEMA_RELEVANTE = { retomada: 1, liberacao: 1, calibragem_reduzida: 1, camera_virtual: 1, prova_retomada: 1, sessao_reaberta: 1, prova_de_vida: 1, prova_de_vida_expirada: 1, sessao_encerrada: 1, prova_iniciada: 1 };

  function e(t) { return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function dois(n) { return (n < 10 ? "0" : "") + n; }
  function navegadorDaProva(amb) {
    var n = (amb || {}).navegadorDaProva;
    if (!n) return (amb || {}).safeExamBrowser ? "Safe Exam Browser" : "Navegador comum";
    if (n.tipo !== "seb") return "Navegador comum";
    return "Safe Exam Browser" + (n.versao ? " (" + String(n.versao).replace(/_/g, " ") + ")" : "") +
      (n.conferida === true ? ", configuração conferida" : n.conferida === false ? ", configuração sem conferência positiva" : "");
  }
  function relogio(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" : "") + dois(m) + ":" + dois(s % 60);
  }
  function duracao(ms) {
    if (ms === undefined || ms === null) return "";
    if (ms < 1000) return "menos de 1 s";
    var s = Math.round(ms / 1000);
    return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
  }
  function dataHora(iso) { try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "medium" }); } catch (x) { return iso || ""; } }
  function navegador(ua) {
    var m = /(Edg|Chrome|Firefox|Safari)\/([\d.]+)/.exec(ua || ""), so = /Windows NT [\d.]+|Mac OS X [\d_]+|Linux|CrOS/.exec(ua || "");
    var nome = m ? (m[1] === "Edg" ? "Microsoft Edge" : m[1]) + " " + m[2].split(".")[0] : "Não identificado";
    return nome + (so ? ", " + so[0].replace(/_/g, ".") : "");
  }

  var CSS = [
    "@page{size:A4;margin:16mm 15mm 18mm}",
    "*{box-sizing:border-box}",
    "html{background:#e9e2d5}",
    "body{margin:0 auto;max-width:210mm;background:#FAF5EC;color:#1B1512;font:400 11.5pt/1.5 Lora,Georgia,'Times New Roman',serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    ".folha{padding:14mm 15mm}",
    "@media print{html,body{background:#fff}body{max-width:none}.folha{padding:0}.barra{display:none!important}}",
    ".barra{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:space-between;background:#1B1512;color:#FAF5EC;padding:12px 15mm;font:500 12pt/1.3 Poppins,'Segoe UI',sans-serif}",
    ".barra button{font:600 12pt/1 Poppins,'Segoe UI',sans-serif;background:#E5662C;color:#1B1512;border:0;border-radius:5px;padding:11px 18px;cursor:pointer}",
    ".capa{background:#1B1512;color:#FAF5EC;padding:11mm 10mm;border-bottom:3mm solid #B04A1C}",
    ".capa small{display:block;font:600 10pt/1.2 Poppins,'Segoe UI',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#C99A57;margin-bottom:3mm}",
    ".capa h1{font:600 22pt/1.15 Poppins,'Segoe UI',sans-serif;margin:0 0 2mm}",
    ".capa p{margin:0;font-size:13pt}",
    "h2{font:600 14pt/1.2 Poppins,'Segoe UI',sans-serif;margin:9mm 0 3mm;padding-bottom:1.5mm;border-bottom:.5mm solid #1B1512;break-after:avoid}",
    "h3{font:600 11.5pt/1.3 Poppins,'Segoe UI',sans-serif;margin:5mm 0 2mm;break-after:avoid}",
    "p{margin:0 0 3mm}",
    "dl{display:grid;grid-template-columns:1fr 1fr;gap:3mm 8mm;margin:6mm 0 0}",
    "dt{font:600 9.5pt/1.2 Poppins,'Segoe UI',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5A4B40}",
    "dd{margin:.6mm 0 0;overflow-wrap:anywhere}",
    ".numeros{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:.5mm solid #1B1512;border-bottom:.2mm solid #b9ad9c;margin-top:2mm}",
    ".numeros div{padding:3.5mm 3mm 3.5mm 0}",
    ".numeros b{display:block;font:600 20pt/1 Poppins,'Segoe UI',sans-serif}",
    ".numeros span{display:block;margin-top:1mm;font:500 10pt/1.3 Poppins,'Segoe UI',sans-serif;color:#5A4B40}",
    "table{width:100%;border-collapse:collapse;font-size:10.5pt;line-height:1.4}",
    "th{font:600 9.5pt/1.2 Poppins,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;text-align:left;color:#5A4B40;padding:2mm 2mm 2mm 0;border-bottom:.4mm solid #1B1512}",
    "td{padding:2.2mm 2mm 2.2mm 0;border-bottom:.2mm solid #cfc4b3;vertical-align:top;overflow-wrap:anywhere}",
    "tr{break-inside:avoid}",
    "td.t{font:600 10.5pt/1.4 Poppins,'Segoe UI',sans-serif;white-space:nowrap}",
    "td strong{font:600 10.5pt/1.4 Poppins,'Segoe UI',sans-serif}",
    ".selo{display:inline-block;font:600 8.5pt/1 Poppins,'Segoe UI',sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:1.2mm 1.8mm;border-radius:.8mm;color:#fff;white-space:nowrap}",
    ".s-suspensao{background:#A8321F}.s-revisao{background:#8A6410}.s-bloqueio{background:#46586A}.s-sistema{background:transparent;color:#5A4B40;border:.2mm solid #b9ad9c}",
    ".fotos{display:grid;grid-template-columns:repeat(2,1fr);gap:5mm}",
    ".fotos.tres{grid-template-columns:repeat(3,1fr)}",
    "figure{margin:0;break-inside:avoid}",
    "figure img{display:block;width:100%;height:auto;border:.2mm solid #b9ad9c;background:#1B1512}",
    "figcaption{font:500 10pt/1.3 Poppins,'Segoe UI',sans-serif;color:#5A4B40;margin-top:1.2mm}",
    ".evid{break-inside:avoid;margin-bottom:5mm}",
    ".nota{font-size:10pt;color:#5A4B40}",
    ".parecer{white-space:pre-wrap;border-left:1.2mm solid #C99A57;padding:1mm 0 1mm 4mm}",
    ".rodape{margin-top:10mm;padding-top:3mm;border-top:.2mm solid #b9ad9c;font:500 9.5pt/1.4 Poppins,'Segoe UI',sans-serif;color:#5A4B40}"
  ].join("\n");

  function html(registro, op) {
    op = op || {};
    var r = registro.resumo || {}, amb = registro.ambiente || {}, cal = amb.calibragem || {}, evs = registro.eventos || [];
    var inicio = registro.inicioProvaT || 0;
    var quando = function (ev) { return registro.inicioProvaT !== null && registro.inicioProvaT !== undefined && ev.t >= inicio ? relogio(ev.t - inicio) : "Antes do início"; };
    var decisoes = (registro.revisao || {}).decisoes || {}, parecer = (registro.revisao || {}).parecer || "";
    var p = [];
    p.push('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
    p.push("<title>Relatório de ocorrências: " + e((registro.aluno || {}).nome) + "</title>");
    p.push('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=Poppins:wght@500;600&display=swap">');
    p.push("<style>" + CSS + "</style></head><body>");
    p.push('<div class="barra"><span>Relatório de ocorrências da sessão</span><button type="button" onclick="window.print()">Salvar em PDF ou imprimir</button></div>');
    p.push('<div class="folha">');
    p.push('<div class="capa"><small>Relatório de ocorrências da sessão de prova</small><h1>' + e((registro.aluno || {}).nome || "Participante") + "</h1><p>" + e((registro.prova || {}).titulo || "") + "</p></div>");

    var cel = function (t, v) { return "<div><dt>" + e(t) + "</dt><dd>" + e(v) + "</dd></div>"; };
    p.push("<dl>" + cel("Participante", (registro.aluno || {}).nome) + cel("Identificador do participante", (registro.aluno || {}).id) +
      cel("Prova", (registro.prova || {}).titulo) + cel("Sessão", op.sessao || (registro.sessao || "") || "Registro local") +
      cel("Início da sessão", dataHora(registro.criadaEm)) + cel("Duração da prova", relogio(r.duracaoProvaMs || 0)) +
      cel("Navegador da prova", navegadorDaProva(amb)) +
      cel("Situação", (op.situacaoFinal ? op.situacaoFinal + " (decisão do administrador). Situação original: " : "") + (SITUACOES[registro.situacao] || registro.situacao || "")) +
      cel("Nota", registro.nota === undefined || registro.nota === null ? "Não apurada neste registro" : String(registro.nota).replace(".", ",")) + "</dl>");

    p.push("<h2>Síntese</h2>");
    var num = function (v, t) { return "<div><b>" + e(v) + "</b><span>" + e(t) + "</span></div>"; };
    p.push('<div class="numeros">' + num(r.suspensoes || 0, "suspensões da prova") + num(relogio(r.tempoSuspensoMs || 0), "tempo em suspensão") +
      num(r.advertencias === undefined ? (r.sinaisParaRevisao || 0) : r.advertencias, "advertências ao participante") +
      num(r.acoesBloqueadas || 0, "ações bloqueadas") + num(r.bloqueios || 0, "bloqueios da prova") + num(r.liberacoes || 0, "liberações do administrador") + "</div>");

    p.push("<h2>Condições da sessão</h2><dl>" +
      cel("Navegador e sistema", navegador(amb.navegador)) +
      cel("Tela", amb.tela ? amb.tela.largura + " x " + amb.tela.altura : "") +
      cel("Câmera", amb.camera || "Não informada") +
      cel("Compartilhamento de tela", amb.superficieCompartilhada === "monitor" ? "Tela inteira" : (amb.superficieCompartilhada || "Não informado")) +
      cel("Calibragem do olhar", cal.modo === "completa" ? "Completa, com desvio médio de " + Math.round((cal.desvio || 0) * 100) + "% da tela" : cal.modo === "reduzida" ? "Reduzida: olhar acompanhado pela posição da cabeça" : "Não realizada") +
      cel("Prova de vida", { concluida: "Concluída", nao_concluida: "Não concluída", dispensada: "Dispensada pela regra da prova" }[amb.provaDeVida] || "Não informada") +
      cel("Atalhos de sistema retidos", amb.tecladoRetido ? "Sim" : "Não disponível neste navegador") +
      cel("Versão da engine", registro.versao || "") + "</dl>");

    var antes = evs.filter(function (ev) { return /^(identidade_|ambiente)/.test(ev.tipo) && ev.evidencias && (ev.evidencias.camera || ev.evidencias.tela); });
    if (antes.length) {
      p.push("<h2>Identidade e ambiente antes da prova</h2><div class=\"fotos\">");
      antes.forEach(function (ev) { p.push('<figure><img src="' + e(ev.evidencias.camera || ev.evidencias.tela) + '" alt=""><figcaption>' + e(ev.titulo) + "</figcaption></figure>"); });
      p.push("</div>");
    }

    var linhas = evs.filter(function (ev) { return ev.classe === "suspensao" || ev.classe === "revisao" || ev.classe === "bloqueio" || (ev.classe === "sistema" && SISTEMA_RELEVANTE[ev.tipo]); });
    p.push("<h2>Ocorrências em ordem cronológica</h2>");
    if (!linhas.length) p.push("<p>Nenhuma ocorrência registrada nesta sessão.</p>");
    else {
      p.push("<table><thead><tr><th style=\"width:17mm\">Instante</th><th style=\"width:34mm\">Classificação</th><th>Ocorrência</th><th style=\"width:22mm\">Duração</th><th style=\"width:27mm\">Revisão</th></tr></thead><tbody>");
      linhas.forEach(function (ev) {
        var selo = ev.classe === "revisao" && !(ev.dados && ev.dados.advertencia) ? "Para revisão" : CLASSES[ev.classe];
        var extra = ev.dados && ev.dados.vezes > 1 ? " Repetido " + ev.dados.vezes + " vezes em sequência." : "";
        var dec = decisoes[ev.n] === "relevante" ? "Relevante" : decisoes[ev.n] === "desconsiderado" ? "Desconsiderada" : (ev.classe === "suspensao" || ev.classe === "revisao" ? "Sem marcação" : "");
        p.push('<tr><td class="t">' + e(quando(ev)) + '</td><td><span class="selo s-' + ev.classe + '">' + e(selo) + "</span></td><td><strong>" + e(ev.titulo) + "</strong>" +
          (ev.detalhe || extra ? "<br>" + e((ev.detalhe || "") + extra) : "") + "</td><td>" + e(duracao(ev.duracaoMs)) + "</td><td>" + e(dec) + "</td></tr>");
      });
      p.push("</tbody></table>");
    }

    var comImagem = evs.filter(function (ev) { return (ev.classe === "suspensao" || ev.classe === "revisao") && ev.evidencias && (ev.evidencias.camera || ev.evidencias.tela); }).slice(0, 40);
    if (comImagem.length) {
      p.push("<h2>Evidências das suspensões e das advertências</h2>");
      comImagem.forEach(function (ev) {
        var im = ev.evidencias, figs = [];
        if (im.camera) figs.push(["Câmera", im.camera]);
        if (im.tela) figs.push(["Tela", im.tela]);
        if (im.telaApos) figs.push(["Tela 1,5 s depois", im.telaApos]);
        p.push('<div class="evid"><h3>' + e(quando(ev)) + " · " + e(ev.titulo) + '</h3><div class="fotos' + (figs.length > 2 ? " tres" : "") + '">' +
          figs.map(function (f) { return '<figure><img src="' + e(f[1]) + '" alt=""><figcaption>' + e(f[0]) + "</figcaption></figure>"; }).join("") + "</div></div>");
      });
    }

    var exib = evs.filter(function (ev) { return ev.classe === "atividade" && ev.titulo === "Questão exibida" && ev.dados; });
    if (exib.length) {
      var tempos = {}, fim = registro.fimT || 0;
      exib.forEach(function (ev, k) {
        var q = ev.dados["questão"] || ev.dados.questao, ate = exib[k + 1] ? exib[k + 1].t : fim;
        tempos[q] = (tempos[q] || 0) + Math.max(0, ate - ev.t);
      });
      var resp = {};
      (registro.respostas || []).forEach(function (x) { resp[x["questão"] || x.questao || x.n] = x.alternativa; });
      p.push("<h2>Tempo de exibição por questão</h2><table><thead><tr><th>Questão</th><th>Tempo em tela</th><th>Resposta registrada</th></tr></thead><tbody>");
      Object.keys(tempos).sort(function (a, b) { return a - b; }).forEach(function (q) {
        p.push('<tr><td class="t">' + e(q) + "</td><td>" + e(duracao(tempos[q])) + "</td><td>" + e(resp[q] === undefined || resp[q] === null ? "Sem resposta" : resp[q]) + "</td></tr>");
      });
      p.push("</tbody></table><p class=\"nota\" style=\"margin-top:2mm\">O tempo em tela inclui os períodos de suspensão ocorridos com a questão aberta.</p>");
    }

    if (registro.rascunho) p.push("<h2>Rascunho do participante</h2><p class=\"parecer\">" + e(registro.rascunho) + "</p>");
    if (op.conversa && op.conversa.length) {
      p.push("<h2>Mensagens trocadas com o administrador</h2><table><thead><tr><th style=\"width:42mm\">Momento</th><th style=\"width:32mm\">Autor</th><th>Mensagem</th></tr></thead><tbody>");
      op.conversa.forEach(function (m) { p.push("<tr><td>" + e(dataHora(m.quando)) + "</td><td>" + (m.de === "admin" ? "Administrador" : "Participante") + "</td><td>" + e(m.texto) + "</td></tr>"); });
      p.push("</tbody></table>");
    }

    p.push("<h2>Revisão do administrador</h2>");
    p.push(parecer ? '<p class="parecer">' + e(parecer) + "</p>" : "<p>O parecer da revisão ainda não foi registrado para esta sessão.</p>");
    p.push('<div class="rodape">Relatório gerado pela Proctoria ' + e(registro.versao || "") + " em " + e(dataHora(new Date().toISOString())) +
      ". Os instantes são contados a partir do início da prova. As advertências e as suspensões automáticas são indícios para a revisão humana e não constituem, por si, conclusão sobre a conduta do participante.</div>");
    p.push("</div></body></html>");
    return p.join("");
  }

  /* janela: opcional. Quando o relatório depende de preparo assíncrono, abra a janela no clique e entregue-a aqui. */
  function abrir(registro, op, janela) {
    var blob = new Blob([html(registro, op)], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    if (janela && !janela.closed) janela.location.href = url; else janela = global.open(url, "_blank");
    setTimeout(function () { URL.revokeObjectURL(url); }, 300000);
    return janela;
  }
  function baixar(registro, op, nome) {
    var url = URL.createObjectURL(new Blob([html(registro, op)], { type: "text/html" })), a = document.createElement("a");
    a.href = url; a.download = nome || "relatorio-de-ocorrencias.html"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  global.ProctoriaRelatorio = { html: html, abrir: abrir, baixar: baixar, situacoes: SITUACOES };
})(typeof window !== "undefined" ? window : globalThis);
