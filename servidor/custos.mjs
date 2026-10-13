/*! Proctoria 0.8.0 | consumo na Cloudflare: medição própria do servidor, estimativa em dólares e teto de gasto */

/* Preços e franquias publicados pela Cloudflare (dólares americanos), conferidos em outubro de 2026.
   A Cloudflare não oferece limite de gasto para Workers, Durable Objects e R2: o teto é aplicado aqui,
   com base na medição do próprio servidor. A fatura da Cloudflare pode diferir desta estimativa. */
export const PRECOS = {
  pago: {
    base: 5,
    requisicoes: { incluidas: 10e6, porMilhao: 0.30 },        // Workers
    requisicoesBanco: { incluidas: 1e6, porMilhao: 0.15 },    // Durable Objects
    linhasGravadas: { incluidas: 50e6, porMilhao: 1.00 }      // SQLite do Durable Object
  },
  gratuito: { base: 0, limiteDiario: { requisicoes: 100000, linhasGravadas: 100000 } },
  r2: { gbIncluidos: 10, porGbMes: 0.015, operacoesIncluidas: 1e6, operacoesPorMilhao: 4.50 }
};
export const GB = 1024 * 1024 * 1024;
const dois = (n) => (n < 10 ? "0" : "") + n;

/* Ciclo de cobrança: começa no dia informado (1 a 28) de cada mês, em UTC. */
export function ciclo(agora, diaInicio) {
  const dia = Math.min(28, Math.max(1, parseInt(diaInicio, 10) || 1)), d = new Date(agora);
  let ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  if (d.getUTCDate() < dia) { mes--; if (mes < 0) { mes = 11; ano--; } }
  const inicio = Date.UTC(ano, mes, dia), fim = Date.UTC(mes === 11 ? ano + 1 : ano, mes === 11 ? 0 : mes + 1, dia);
  return { chave: ano + "-" + dois(mes + 1) + "-" + dois(dia), inicio, fim };
}
export const diaDe = (agora) => new Date(agora).toISOString().slice(0, 10);
export const usoNovo = (agora, diaInicio) => ({ ciclo: ciclo(agora, diaInicio).chave, req: 0, linhas: 0, opsA: 0, picoBytes: 0, dia: diaDe(agora), reqDia: 0, linhasDia: 0 });

const excedente = (valor, incluido, porMilhao) => Math.max(0, valor - incluido) / 1e6 * porMilhao;
const centavos = (v) => Math.round(v * 100) / 100;

/* Estimativa do ciclo em curso. uso: contadores do servidor; bytes: armazenamento atual no R2. */
export function estimar(uso, bytes, cfg) {
  const plano = cfg.plano === "pago" ? "pago" : "gratuito", teto = Math.max(0, Number(cfg.teto) || 0);
  const pico = Math.max(uso.picoBytes || 0, bytes || 0), gb = pico / GB;
  const itens = [];
  if (plano === "pago") {
    const p = PRECOS.pago;
    itens.push({ item: "Plano Workers Paid", medida: "mensalidade", custo: p.base });
    itens.push({ item: "Requisições ao servidor", medida: uso.req + " de " + p.requisicoes.incluidas / 1e6 + " milhões incluídas",
      custo: excedente(uso.req, p.requisicoes.incluidas, p.requisicoes.porMilhao) + excedente(uso.req, p.requisicoesBanco.incluidas, p.requisicoesBanco.porMilhao) });
    itens.push({ item: "Linhas gravadas no banco", medida: uso.linhas + " de " + p.linhasGravadas.incluidas / 1e6 + " milhões incluídas", custo: excedente(uso.linhas, p.linhasGravadas.incluidas, p.linhasGravadas.porMilhao) });
  } else {
    itens.push({ item: "Plano Workers Free", medida: "sem mensalidade; os limites diários interrompem o serviço em vez de gerar cobrança", custo: 0 });
  }
  itens.push({ item: "Arquivos no R2", medida: gb.toFixed(2).replace(".", ",") + " GB no pico do ciclo; " + PRECOS.r2.gbIncluidos + " GB incluídos", custo: Math.max(0, gb - PRECOS.r2.gbIncluidos) * PRECOS.r2.porGbMes });
  itens.push({ item: "Operações de gravação no R2", medida: uso.opsA + " de 1 milhão incluído", custo: excedente(uso.opsA, PRECOS.r2.operacoesIncluidas, PRECOS.r2.operacoesPorMilhao) });
  itens.forEach((i) => { i.custo = centavos(i.custo); });
  const total = centavos(itens.reduce((s, i) => s + i.custo, 0));
  const pct = teto > 0 ? Math.round(total / teto * 100) : 0;
  const lim = PRECOS.gratuito.limiteDiario;
  const diario = plano === "gratuito" ? { requisicoes: uso.reqDia, linhasGravadas: uso.linhasDia, limiteRequisicoes: lim.requisicoes, limiteLinhas: lim.linhasGravadas,
    proximo: uso.reqDia >= lim.requisicoes * 0.85 || uso.linhasDia >= lim.linhasGravadas * 0.85 } : null;
  return { plano, teto, total, pct, itens, bytes: bytes || 0, picoBytes: pico, ciclo: uso.ciclo, diario,
    estado: teto > 0 && total >= teto ? "contencao" : teto > 0 && pct >= 70 ? "atencao" : "normal", contencao: teto > 0 && total >= teto };
}
