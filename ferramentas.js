/*! Proctoria 0.6.0 | rascunho e calculadora na tela da prova */
(function (global) {
  "use strict";

  var CSS = [
    ".pfe{display:grid;gap:12px;font:400 18px/1.5 Lora,Georgia,serif;color:#1B1512}",
    ".pfe *{box-sizing:border-box}",
    ".pfe-barra{display:flex;flex-wrap:wrap;gap:10px}",
    ".pfe-bt{font:600 16px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;color:#1B1512;background:transparent;border:1px solid #1B1512;border-radius:6px;padding:10px 16px;cursor:pointer}",
    ".pfe-bt:hover{background:rgba(27,21,18,.07)}",
    ".pfe-bt[aria-expanded=true]{background:#1B1512;color:#FAF5EC}",
    ".pfe-bt:focus-visible,.pfe-tecla:focus-visible,.pfe textarea:focus-visible,.pfe-visor:focus-visible{outline:3px solid #E5662C;outline-offset:2px}",
    ".pfe-paineis{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:start}",
    ".pfe-painel{background:#FFFDF8;border:1px solid rgba(27,21,18,.2);border-radius:6px;padding:16px;min-width:0}",
    ".pfe-painel h3{font:600 14px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#B04A1C;margin:0 0 10px}",
    ".pfe textarea{width:100%;min-height:210px;resize:vertical;font:400 18px/1.5 Lora,Georgia,serif;color:#1B1512;background:#fff;border:1px solid #5A4B40;border-radius:4px;padding:10px;-webkit-user-select:text;user-select:text}",
    ".pfe-nota{font:500 14px/1.3 Poppins,'Segoe UI',system-ui,sans-serif;color:#5A4B40;margin:8px 0 0}",
    ".pfe-visor{width:100%;font:500 26px/1.2 Poppins,'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:right;color:#1B1512;background:#fff;border:1px solid #5A4B40;border-radius:4px;padding:10px 12px;-webkit-user-select:text;user-select:text}",
    ".pfe-resultado{min-height:30px;margin:6px 0 10px;text-align:right;font:600 22px/1.3 Poppins,'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#B04A1C;overflow-wrap:anywhere}",
    ".pfe-teclas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
    ".pfe-tecla{font:600 20px/1 Poppins,'Segoe UI',system-ui,sans-serif;color:#1B1512;background:#FAF5EC;border:1px solid rgba(27,21,18,.25);border-radius:5px;padding:14px 0;cursor:pointer}",
    ".pfe-tecla:hover{background:#f0e6d4}",
    ".pfe-tecla.pfe-op{background:#1B1512;color:#FAF5EC;border-color:#1B1512}",
    ".pfe-tecla.pfe-igual{background:#B04A1C;color:#fff;border-color:#B04A1C}"
  ].join("\n");

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k]; else if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === "string" ? document.createTextNode(f) : f); });
    return n;
  }

  /* Avaliador de expressões: + − × ÷, parênteses, vírgula decimal e percentual no estilo das calculadoras
     (200 + 10% = 220; 200 × 10% = 20). Não usa eval. */
  function calcular(texto) {
    var t = String(texto).replace(/\s+/g, "").replace(/×|x|X/g, "*").replace(/÷|:/g, "/").replace(/−|–/g, "-").replace(/,/g, ".");
    if (!t) return null;
    var i = 0;
    function erro() { throw new Error("expressão"); }
    function numero() {
      var ini = i;
      while (i < t.length && /[0-9.]/.test(t[i])) i++;
      if (ini === i) erro();
      var txt = t.slice(ini, i);
      if ((txt.match(/\./g) || []).length > 1) erro();
      return parseFloat(txt);
    }
    function primario() {
      if (t[i] === "(") { i++; var v = expressao(); if (t[i] !== ")") erro(); i++; return { v: v, pct: false }; }
      return { v: numero(), pct: false };
    }
    function fator() {
      if (t[i] === "-") { i++; var f = fator(); return { v: -f.v, pct: f.pct }; }
      if (t[i] === "+") { i++; return fator(); }
      var p = primario();
      while (t[i] === "%") { i++; p = { v: p.v / 100, pct: true }; }
      return p;
    }
    function termo() {
      var a = fator();
      while (t[i] === "*" || t[i] === "/") {
        var op = t[i++], b = fator();
        if (op === "/" && b.v === 0) throw new Error("divisão por zero");
        a = { v: op === "*" ? a.v * b.v : a.v / b.v, pct: false };
      }
      return a;
    }
    function expressao() {
      var a = termo(), v = a.v;
      while (t[i] === "+" || t[i] === "-") {
        var op = t[i++], b = termo(), parcela = b.pct ? v * b.v : b.v;
        v = op === "+" ? v + parcela : v - parcela;
      }
      return v;
    }
    var r = expressao();
    if (i !== t.length || !isFinite(r)) erro();
    return Math.round(r * 1e10) / 1e10;
  }

  function formatar(n) {
    return n.toLocaleString("pt-BR", { maximumFractionDigits: 10 });
  }

  function montar(container, op) {
    op = op || {};
    if (!document.getElementById("pfe-estilos")) { var st = el("style", { id: "pfe-estilos" }); st.textContent = CSS; document.head.appendChild(st); }
    var raiz = el("div", { class: "pfe" }), barra = el("div", { class: "pfe-barra" }), paineis = el("div", { class: "pfe-paineis" });
    var estado = { rascunho: op.textoInicial || "", usos: { calculadora: 0, rascunho: 0 } };
    var id = "pfe" + Math.random().toString(36).slice(2, 7), salvar = null;

    function alternar(botao, painel, nome) {
      botao.addEventListener("click", function () {
        var abrir = painel.hidden;
        painel.hidden = !abrir; botao.setAttribute("aria-expanded", abrir ? "true" : "false");
        if (abrir) { estado.usos[nome]++; if (op.aoUsar) op.aoUsar(nome); var foco = painel.querySelector("textarea,input"); if (foco) foco.focus(); }
      });
    }

    if (op.calculadora !== false) {
      var visor = el("input", { class: "pfe-visor", type: "text", id: id + "-visor", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "aria-label": "Expressão da calculadora" });
      var resultado = el("div", { class: "pfe-resultado", "aria-live": "polite" });
      var teclas = el("div", { class: "pfe-teclas" });
      var mostrar = function () {
        try { var r = calcular(visor.value); resultado.textContent = r === null ? "" : "= " + formatar(r); return r; }
        catch (e) { resultado.textContent = e.message === "divisão por zero" ? "Divisão por zero" : (visor.value ? "Expressão incompleta" : ""); return null; }
      };
      [["C", "limpar"], ["(", "("], [")", ")"], ["÷", "÷"], ["7", "7"], ["8", "8"], ["9", "9"], ["×", "×"], ["4", "4"], ["5", "5"], ["6", "6"], ["−", "−"],
        ["1", "1"], ["2", "2"], ["3", "3"], ["+", "+"], ["0", "0"], [",", ","], ["%", "%"], ["=", "igual"]].forEach(function (k) {
        var classe = "pfe-tecla" + (/[÷×−+()%]/.test(k[0]) ? " pfe-op" : "") + (k[1] === "igual" ? " pfe-igual" : "");
        var b = el("button", { class: classe, type: "button", text: k[0], "aria-label": k[1] === "limpar" ? "Limpar" : k[1] === "igual" ? "Calcular" : k[0] });
        b.addEventListener("click", function () {
          if (k[1] === "limpar") visor.value = "";
          else if (k[1] === "igual") { var r = mostrar(); if (r !== null) visor.value = formatar(r).replace(/\./g, ""); }
          else visor.value += k[1];
          mostrar(); visor.focus();
        });
        teclas.appendChild(b);
      });
      visor.addEventListener("input", mostrar);
      visor.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); var r = mostrar(); if (r !== null) visor.value = formatar(r).replace(/\./g, ""); mostrar(); }
      });
      var pCalc = el("div", { class: "pfe-painel" }, [el("h3", { text: "Calculadora" }), visor, resultado, teclas]);
      pCalc.hidden = true;
      var bCalc = el("button", { class: "pfe-bt", type: "button", text: "Calculadora", "aria-expanded": "false" });
      alternar(bCalc, pCalc, "calculadora");
      barra.appendChild(bCalc); paineis.appendChild(pCalc);
    }

    if (op.rascunho !== false) {
      var area = el("textarea", { id: id + "-rascunho", spellcheck: "false", "aria-label": "Rascunho" });
      area.value = estado.rascunho;
      area.addEventListener("input", function () {
        estado.rascunho = area.value;
        clearTimeout(salvar);
        salvar = setTimeout(function () { if (op.aoMudarRascunho) op.aoMudarRascunho(estado.rascunho); }, 800);
      });
      var pRasc = el("div", { class: "pfe-painel" }, [el("h3", { text: "Rascunho" }), area,
        el("p", { class: "pfe-nota", text: "As anotações ficam guardadas com a sessão e fazem parte do registro da prova." })]);
      pRasc.hidden = true;
      var bRasc = el("button", { class: "pfe-bt", type: "button", text: "Rascunho", "aria-expanded": "false" });
      alternar(bRasc, pRasc, "rascunho");
      barra.appendChild(bRasc); paineis.appendChild(pRasc);
    }

    raiz.appendChild(barra); raiz.appendChild(paineis);
    container.textContent = ""; container.appendChild(raiz);
    return { rascunho: function () { return estado.rascunho; }, usos: function () { return estado.usos; } };
  }

  global.ProctoriaFerramentas = { montar: montar, calcular: calcular, formatar: formatar };
})(typeof window !== "undefined" ? window : globalThis);
