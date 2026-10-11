# Proctoria v0.7

Fiscalização de prova on-line: engine para navegador, servidor, página da prova e módulo de administração.

- Demonstração sem servidor: https://ginoterentimjr.github.io/proctoria/
- Versões anteriores da demonstração: `/v0.6/`, `/v0.5/`, `/v0.4/`, `/v0.3/`, `/v0.2/`, `/v0.1/`

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
| `servidor/seb.mjs` | Safe Exam Browser: arquivo de configuração, Config Key e conferência do navegador |
| `servidor/custos.mjs` | Consumo na Cloudflare: preços, estimativa em dólares e teto de gasto |
| `docs/integracao-pionira.md` | Especificação da integração com a Pionira |

## O que o servidor acrescenta

- Questões e gabarito ficam no servidor. O participante recebe uma questão por vez, depois da verificação, sem a alternativa correta.
- Registro, evidências e gravações são enviados durante a sessão.
- Retomada depois de queda: o participante volta pelo mesmo endereço, refaz a verificação e encontra respostas e rascunho preservados. A interrupção conta como suspensão e o tempo segue em contagem.
- Acompanhamento ao vivo, mensagens entre administrador e participante, liberação de bloqueio, suspensão, encerramento e invalidação a distância.
- Em cada sessão: download das gravações, do registro e do relatório formal.
- Integração com a Pionira e prazo de retenção dos dados.

## Organização do módulo de administração

- Navegação fixa à esquerda: Provas, Acompanhamento, Sessões e auditoria, Configurações, com o consumo do ciclo sempre à vista.
- Cada prova abre com três abas: Regras, Questões e Participantes. As regras ficam em painéis por assunto, com índice lateral.
- O acompanhamento ao vivo traz as contagens da turma no topo e um cartão por sessão, com a cor da situação.
- A auditoria reúne decisão e arquivos em um painel e separa registro, respostas e mensagens em abas.
- As configurações se dividem em quatro abas: consumo e teto de gasto, avisos, integração com a Pionira e retenção dos dados.

## Opções por prova, no módulo de administração

| Opção | Escolhas |
| --- | --- |
| Navegador aceito | Navegador comum (Google Chrome ou Microsoft Edge), somente o Safe Exam Browser, ou os dois |
| Identidade | Foto do rosto, com ou sem a foto do documento de identificação |
| Ausência diante da câmera | Tolerância em segundos (padrão: 10) e a consequência ao esgotá-la: invalidar a prova (prova sem pausas) ou suspender |
| Demais regras | Suspensões até o bloqueio, tempos de advertência e suspensão, prova de vida, varredura do ambiente, gravações, calculadora e rascunho |

## Safe Exam Browser

O Safe Exam Browser (SEB) é um navegador de prova gratuito, para Windows e macOS, que ocupa a tela inteira e impede o uso de outros programas até a entrega. A escolha é feita por prova.

- O participante recebe o mesmo endereço de sempre. Em prova que exige o SEB, a página orienta a instalação e apresenta o botão que abre a prova no programa (endereço `sebs://`).
- O servidor entrega o arquivo de configuração em `/api/seb/config.seb`: endereço inicial, câmera, microfone e captura de tela autorizados, um único monitor e endereço de encerramento.
- A cada acesso, o servidor confere a Config Key informada pelo SEB: SHA256 do endereço da página seguido da chave da configuração. O cálculo da chave foi validado com dois arquivos de configuração reais e suas chaves conhecidas.
- No SEB, a engine dispensa a tela cheia e a janela exclusiva, que ficam a cargo do programa, e mantém câmera, microfone, olhar, voz, gravações e registro.
- Se a versão do SEB não oferecer o compartilhamento de tela à página, a sessão segue sem a gravação da tela e o fato fica registrado.
- Encerrar o SEB antes da entrega interrompe a sessão; ao voltar, vale a retomada, com a interrupção contada como suspensão.

A compatibilidade com o SEB real (versões 3.7 para macOS e 3.10 para Windows) precisa ser confirmada em piloto antes de uma prova que valha nota: os testes desta versão usaram um SEB simulado.

## Publicação do servidor na Cloudflare

1. **Armazenamento.** No painel da Cloudflare, em R2, crie o bucket `proctoria-arquivos`.
2. **Servidor.** Em Workers e Pages, escolha Criar, depois Importar um repositório, e selecione `ginoterentimjr/proctoria`. O comando de publicação é `npx wrangler deploy`.
3. **Senha do administrador.** No Worker publicado, em Configurações, Variáveis e Segredos, adicione o segredo `ADMIN_SENHA` com a senha desejada.
4. **Aviso por e-mail (opcional).** Com uma conta no serviço de e-mail Resend, adicione o segredo `RESEND_CHAVE` e informe o e-mail de avisos em Configurações. Sem domínio próprio verificado, o serviço entrega apenas ao e-mail da própria conta.
5. **Endereços.** A administração fica em `/admin` e cada participante recebe um endereço `/prova#código`.

A cada alteração enviada ao repositório, a Cloudflare publica de novo.

### Custo previsto

| Item | Plano gratuito (Workers Free) | Plano pago (Workers Paid, US$ 5 por mês) |
| --- | --- | --- |
| Requisições | 100 mil por dia | 10 milhões por mês incluídas |
| Linhas gravadas no banco | 100 mil por dia | 50 milhões por mês incluídas |
| Arquivos (R2) | 10 GB incluídos; acima disso, US$ 0,015 por GB ao mês | Igual |

Uma turma de 40 alunos em prova de 1 hora consome cerca de 70 mil requisições, de 80 mil a 120 mil linhas gravadas e perto de 11 GB de gravação. No plano gratuito, ao atingir um limite diário a Cloudflare interrompe o serviço até a virada do dia: ele atende ao piloto e a turmas de até cerca de 25 participantes por dia, e turmas maiores pedem o plano pago.

### Teto de gasto

A Cloudflare não oferece limite de gasto para Workers, Durable Objects e R2: o alerta de orçamento dela apenas avisa por e-mail. A contenção é feita pelo próprio servidor.

- O servidor mede requisições, linhas gravadas, operações e volume armazenado, e converte em dólares pelos preços publicados (`servidor/custos.mjs`).
- Em Configurações ficam o teto por ciclo (padrão: US$ 30), o plano contratado e o dia de início do ciclo de cobrança.
- Aos 70% do teto, o administrador recebe um aviso. Ao atingir o teto, o servidor deixa de armazenar gravações e de abrir novas sessões; as sessões em andamento seguem com respostas e registro de eventos.
- O aviso aparece no topo de todas as telas da administração, segue por e-mail quando o envio está configurado e, se houver, a um endereço de retorno.
- Cada sessão tem limite próprio de armazenamento, de cerca de três vezes o volume esperado para a duração da prova.
- No plano gratuito, aos 85% do limite diário o servidor suspende novas sessões, para preservar as que estão em andamento.

A medição é do próprio servidor. Tempo de processamento e leituras ficam fora dela, e a fatura da Cloudflare pode diferir em centavos.

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
      limiteSuspensoes: 3, identidade: true, identidadeDocumento: true, provaDeVida: "registrar", varreduraAmbiente: false, semPausasSeg: 10,
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
2. **Suspensão** se a condição continuar por mais 4 s (para rosto ausente, vale a tolerância definida na prova), ou por reincidência de advertências do mesmo sinal em 5 minutos.
3. **Bloqueio** na suspensão de número `limiteSuspensoes`: a retomada depende do administrador. A liberação reinicia a contagem.

Saída da janela, janela minimizada, encoberta ou redimensionada, saída da tela cheia, compartilhamento interrompido, câmera ou microfone interrompidos, monitor adicional e queda da sessão suspendem de imediato.

Com a regra **sem pausas** ligada, o rosto fora da imagem além da tolerância (10 s por padrão) encerra a prova como invalidada. As respostas são preservadas e a decisão final cabe ao administrador. Com a regra desligada, a mesma tolerância conduz à suspensão.

## Limites desta versão

- Funciona no Google Chrome e no Microsoft Edge em computador e, por escolha do administrador, no Safe Exam Browser.
- Um navegador comum detecta a saída da janela e reage, sem impedi-la, e não enxerga as outras abas nem os aplicativos abertos. O bloqueio efetivo de outros programas depende do Safe Exam Browser.
- A conferência da Config Key confirma a configuração do Safe Exam Browser, sem atestar o programa em si: um participante com conhecimento técnico avançado poderia simulá-la. Câmera, gravações e registro seguem como segunda barreira.
- Os limiares de olhar, cabeça, voz e prova de vida são valores iniciais e pedem ajuste com participantes reais.
- A conferência das fotos de identidade é feita pelo administrador, na auditoria. Não há comparação automática de rostos.
- O relatório formal é uma página pronta para impressão; o PDF é gerado pela função de salvar em PDF do navegador.
- O detector facial (MediaPipe Face Landmarker) é carregado de `cdn.jsdelivr.net` e `storage.googleapis.com`.
- Imagem, voz, documento e análise do olhar são dados pessoais sensíveis pela LGPD: o uso requer termo específico, finalidade declarada e prazo de retenção.
