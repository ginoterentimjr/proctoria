# Proctoria v0.4

Fiscalização de prova on-line: engine para navegador, servidor, página da prova e módulo de administração.

- Demonstração sem servidor: https://ginoterentimjr.github.io/proctoria/
- Versões anteriores da demonstração: `/v0.3/`, `/v0.2/`, `/v0.1/`

## Componentes

| Arquivo | Função |
| --- | --- |
| `proctoria.js` | Engine: verificação do ambiente, identidade, prova de vida, calibragem do olhar, bloqueios, advertência, suspensão, bloqueio, gravação e registro |
| `ferramentas.js` | Calculadora e rascunho na tela da prova |
| `painel.js` | Painel de auditoria: linha do tempo, gravações, ocorrências com evidências, decisão e parecer |
| `relatorio.js` | Relatório formal de ocorrências da sessão, pronto para salvar em PDF |
| `index.html` | Demonstração sem servidor, com prova ilustrativa |
| `prova.html` | Página da prova ligada ao servidor |
| `admin.html` | Módulo de administração |
| `servidor/index.js` | Servidor: Cloudflare Worker, banco em Durable Object (SQLite) e arquivos em R2 |
| `docs/integracao-pionira.md` | Especificação da integração com a Pionira |

## O que o servidor acrescenta

- Questões e gabarito ficam no servidor. O participante recebe uma questão por vez, depois da verificação, sem a alternativa correta.
- Registro, evidências e gravações são enviados durante a sessão.
- Retomada depois de queda: o participante volta pelo mesmo endereço, refaz a verificação e encontra respostas e rascunho preservados. A interrupção conta como suspensão e o tempo segue em contagem.
- Acompanhamento ao vivo, mensagens entre administrador e participante, liberação de bloqueio, suspensão, encerramento e invalidação a distância.
- Em cada sessão: download das gravações, do registro e do relatório formal.
- Integração com a Pionira e prazo de retenção dos dados.

## Publicação do servidor na Cloudflare

1. **Armazenamento.** No painel da Cloudflare, em R2, crie o bucket `proctoria-arquivos`.
2. **Servidor.** Em Workers e Pages, escolha Criar, depois Importar um repositório, e selecione `ginoterentimjr/proctoria`. O comando de publicação é `npx wrangler deploy`.
3. **Senha do administrador.** No Worker publicado, em Configurações, Variáveis e Segredos, adicione o segredo `ADMIN_SENHA` com a senha desejada.
4. **Endereços.** A administração fica em `/admin` e cada participante recebe um endereço `/prova#código`.

A cada alteração enviada ao repositório, a Cloudflare publica de novo.

### Custo previsto

| Item | Plano gratuito | Uso em turma |
| --- | --- | --- |
| Requisições | 100 mil por dia | Uma turma de 40 alunos em prova de 1 hora consome cerca de 70 mil. O plano pago custa US$ 5 por mês, com 10 milhões de requisições |
| Arquivos (R2) | 10 GB | Cada hora de prova gera até cerca de 270 MB por aluno; acima da franquia, US$ 0,015 por GB ao mês |

## Execução local

```
npm install
printf 'ADMIN_SENHA=uma-senha-local\n' > .dev.vars
npm run local
```

A administração abre em `http://127.0.0.1:8787/admin`.

## Uso da engine em outra página

```html
<script src="proctoria.js"></script>
<script>
  const sessao = Proctoria.criar({
    aluno: { id: "123", nome: "Nome do participante" },
    prova: { id: "disciplina-07", titulo: "Prova da disciplina" },
    areaDaProva: document.getElementById("prova"),   // ocultada durante cada suspensão
    regras: {                                        // demais regras em Proctoria.regrasPadrao
      limiteSuspensoes: 3, identidade: true, provaDeVida: "registrar", varreduraAmbiente: false, semPausasSeg: 0,
      sinais: { olhar_fora: { avisoSeg: 2, suspensaoSeg: 4, reincidencia: 4 } }
    },
    retomada: null,                                  // estado devolvido pelo servidor depois de uma queda
    aoEvento: (evento) => {},                        // cada linha do registro
    aoTrecho: (tipo, blob, info) => {},              // trechos de gravação, para envio ao servidor
    aoBloquear: (info) => {},                        // prova bloqueada
    aoEncerrar: (resultado) => {}                    // encerramento iniciado pela engine
  });

  await sessao.preparar();          // verificação do ambiente e calibragem
  sessao.iniciarProva();            // bloqueios, vigilância, gravação e telemetria
  sessao.registrar("Resposta assinalada", { questão: 1, alternativa: "B" });
  sessao.liberar("administrador");  // liberação de uma prova bloqueada
  const { registro, arquivos } = await sessao.encerrar("entregue");
</script>
```

## Resposta a cada sinal

Olhar, cabeça, rosto e voz seguem a mesma progressão, com tempos ajustáveis por prova:

1. **Advertência** na tela do participante depois de 2 s contínuos (cerca de 1 s de fala, para voz).
2. **Suspensão** se a condição continuar por mais 4 s (3 s para rosto), ou por reincidência de advertências do mesmo sinal em 5 minutos.
3. **Bloqueio** na suspensão de número `limiteSuspensoes`: a retomada depende do administrador. A liberação reinicia a contagem.

Saída da janela, janela minimizada, encoberta ou redimensionada, saída da tela cheia, compartilhamento interrompido, câmera ou microfone interrompidos, monitor adicional e queda da sessão suspendem de imediato.

Com a regra **sem pausas** ligada, o rosto fora da imagem pelo tempo definido encerra a prova como invalidada. As respostas são preservadas e a decisão final cabe ao administrador.

## Limites desta versão

- Funciona no Google Chrome e no Microsoft Edge em computador.
- Um navegador comum detecta a saída da janela e reage, sem impedi-la, e não enxerga as outras abas nem os aplicativos abertos. Exigir o fechamento de outros programas requer navegador dedicado, como o Safe Exam Browser.
- Os limiares de olhar, cabeça, voz e prova de vida são valores iniciais e pedem ajuste com participantes reais.
- A conferência das fotos de identidade é feita pelo administrador, na auditoria. Não há comparação automática de rostos.
- O relatório formal é uma página pronta para impressão; o PDF é gerado pela função de salvar em PDF do navegador.
- O detector facial (MediaPipe Face Landmarker) é carregado de `cdn.jsdelivr.net` e `storage.googleapis.com`.
- Imagem, voz, documento e análise do olhar são dados pessoais sensíveis pela LGPD: o uso requer termo específico, finalidade declarada e prazo de retenção.
