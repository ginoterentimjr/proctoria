# Proctoria v0.1

Engine de fiscalização de prova on-line para navegador, com página de demonstração e painel de auditoria.

Demonstração: https://ginoterentimjr.github.io/proctoria/

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
    regras: { limiteSuspensoes: 3 },                 // demais regras em Proctoria.regrasPadrao
    aoEvento: (evento) => {},                        // cada linha do registro, no instante em que ocorre
    aoTrecho: (tipo, blob, info) => {},              // trechos de gravação a cada 4 s, para envio ao servidor
    aoEncerrar: (resultado) => {}                    // encerramento por limite de suspensões
  });

  await sessao.preparar();          // verificação do ambiente e calibragem, em camadas da própria engine
  sessao.iniciarProva();            // bloqueios, vigilância, gravação e telemetria
  sessao.registrar("Resposta assinalada", { questão: 1, alternativa: "B" });
  const { registro, arquivos } = await sessao.encerrar("entregue");
</script>
```

`registro` é um objeto JSON com ocorrências, evidências (imagens da câmera e da tela, trechos de áudio), telemetria por segundo e os metadados das gravações. `arquivos` traz as gravações em WebM.

## Classes de ocorrência

| Classe | Efeito | Exemplos |
| --- | --- | --- |
| `objetiva` | Suspende a prova na hora | Saída da janela ou da tela cheia, compartilhamento interrompido, câmera ou microfone interrompidos, monitor adicional |
| `revisao` | Registra com evidência, sem suspender | Rosto ausente, mais de um rosto, cabeça ou olhar fora da tela, som de voz, microfone sem sinal |
| `bloqueio` | Ação impedida e registrada | Copiar, recortar, colar, menu de contexto, atalhos, impressão |
| `atividade` | Registro da página da prova | Questão exibida, resposta assinalada |
| `sistema` | Funcionamento da sessão | Permissões, calibragem, retomadas, dispositivos, rede |

## Limites desta versão

- Funciona no Google Chrome e no Microsoft Edge em computador.
- Um navegador comum detecta a saída da janela e reage, sem impedi-la. O bloqueio completo exige navegador dedicado, como o Safe Exam Browser.
- Nenhum dado é enviado: registro e gravações ficam no navegador do participante até o download. O uso em prova real requer envio a um servidor durante a sessão (ganchos `aoEvento` e `aoTrecho`).
- Os limiares de olhar, cabeça e voz são valores iniciais e pedem ajuste com participantes reais.
- O detector facial (MediaPipe Face Landmarker) é carregado de `cdn.jsdelivr.net` e `storage.googleapis.com`. Para prova real, convém hospedar esses arquivos junto da aplicação (`recursos` na configuração).
- Imagem, voz e análise do olhar são dados pessoais sensíveis pela LGPD: o uso requer termo específico, finalidade declarada e prazo de retenção.
