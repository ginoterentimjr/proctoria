# Proctoria v0.3

Engine de fiscalização de prova on-line para navegador, com página de demonstração e painel de auditoria.

Demonstração: https://ginoterentimjr.github.io/proctoria/ (versões anteriores em https://ginoterentimjr.github.io/proctoria/v0.2/ e https://ginoterentimjr.github.io/proctoria/v0.1/)

## Arquivos

| Arquivo | Função |
| --- | --- |
| `proctoria.js` | Engine: verificação do ambiente, calibragem do olhar, bloqueios, suspensão, sinais, gravação e registro |
| `painel.js` | Painel de auditoria: linha do tempo, gravações, ocorrências com evidências, decisão e parecer |
| `index.html` | Página de demonstração com prova ilustrativa de quatro questões |

## Uso em uma página de prova

```html
<script src="proctoria.js"></script>
<script>
  const sessao = Proctoria.criar({
    aluno: { id: "123", nome: "Nome do participante" },
    prova: { id: "disciplina-07", titulo: "Prova da disciplina" },
    areaDaProva: document.getElementById("prova"),   // ocultada durante cada suspensão
    regras: {                                        // demais regras em Proctoria.regrasPadrao
      limiteSuspensoes: 3,                           // na terceira suspensão, a prova fica bloqueada
      liberacaoHash: await Proctoria.resumoSHA256("código do administrador"),
      sinais: { olhar_fora: { avisoSeg: 2, suspensaoSeg: 4, reincidencia: 4 } }
    },
    aoEvento: (evento) => {},                        // cada linha do registro, no instante em que ocorre
    aoTrecho: (tipo, blob, info) => {},              // trechos de gravação a cada 4 s, para envio ao servidor
    aoBloquear: (info) => {},                        // prova bloqueada: o servidor avisa o administrador
    aoEncerrar: (resultado) => {}                    // encerramento pelo participante durante o bloqueio
  });

  await sessao.preparar();          // verificação do ambiente e calibragem, em camadas da própria engine
  sessao.iniciarProva();            // bloqueios, vigilância, gravação e telemetria
  sessao.registrar("Resposta assinalada", { questão: 1, alternativa: "B" });
  sessao.liberar("painel do administrador");        // liberação a distância de uma prova bloqueada
  const { registro, arquivos } = await sessao.encerrar("entregue");
</script>
```

`registro` é um objeto JSON com ocorrências, evidências (imagens da câmera e da tela, trechos de áudio), telemetria por segundo e os metadados das gravações. `arquivos` traz as gravações em WebM.

## Resposta a cada sinal

Olhar, cabeça, rosto e voz seguem a mesma progressão, com tempos ajustáveis por sinal em `regras.sinais`:

1. **Advertência** na tela do participante depois de `avisoSeg` contínuos (2 s para olhar, cabeça e rosto; cerca de 1 s de fala para voz).
2. **Suspensão** se a condição continuar por mais `suspensaoSeg` (4 s para olhar, cabeça e voz; 3 s para rosto), ou na advertência de número `reincidencia` do mesmo sinal em `reincidenciaJanelaMin` minutos.
3. **Bloqueio** na suspensão de número `limiteSuspensoes`: a retomada depende do administrador, por código na tela do participante ou por `sessao.liberar()`. A liberação reinicia a contagem.

Saída da janela, janela minimizada, encoberta ou redimensionada, saída da tela cheia, compartilhamento interrompido, câmera ou microfone interrompidos e monitor adicional suspendem de imediato, sem advertência.

A janela exclusiva abre ocupando toda a área útil da tela. A página não consegue impedir que ela seja minimizada ou redimensionada: confere o tamanho, restaura quando o navegador permite e suspende a prova.

## Classes de ocorrência

| Classe | Efeito | Exemplos |
| --- | --- | --- |
| `suspensao` | Prova suspensa e área da prova oculta | Saída da janela ou da tela cheia, sinal mantido depois da advertência, reincidência, bloqueio |
| `revisao` | Advertência na tela, com evidência no registro | Olhar ou cabeça fora da tela, rosto ausente, mais de um rosto, som de voz |
| `bloqueio` | Ação impedida e registrada | Copiar, recortar, colar, menu de contexto, atalhos, impressão, código de liberação incorreto |
| `atividade` | Registro da página da prova | Questão exibida, resposta assinalada |
| `sistema` | Funcionamento da sessão | Permissões, área de trabalho registrada, calibragem, retomadas, liberações, dispositivos, rede |

## Limites desta versão

- Funciona no Google Chrome e no Microsoft Edge em computador.
- Um navegador comum detecta a saída da janela e reage, sem impedi-la. Uma página também não enxerga as outras abas nem os aplicativos abertos: a engine abre a prova em janela exclusiva, registra a imagem da área de trabalho antes do início e grava a tela inteira. Listar aplicativos e exigir o fechamento de outros navegadores requer navegador dedicado, como o Safe Exam Browser.
- Nenhum dado é enviado: registro e gravações ficam no navegador do participante até o download. O uso em prova real requer envio a um servidor durante a sessão (ganchos `aoEvento` e `aoTrecho`).
- Os limiares de olhar, cabeça e voz são valores iniciais e pedem ajuste com participantes reais.
- O detector facial (MediaPipe Face Landmarker) é carregado de `cdn.jsdelivr.net` e `storage.googleapis.com`. Para prova real, convém hospedar esses arquivos junto da aplicação (`recursos` na configuração).
- Imagem, voz e análise do olhar são dados pessoais sensíveis pela LGPD: o uso requer termo específico, finalidade declarada e prazo de retenção.
