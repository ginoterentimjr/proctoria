# Integração entre a Pionira e a Proctoria

Especificação para a equipe técnica da Pionira. Versão 0.5 da Proctoria.

## Visão geral

A Pionira continua responsável pelo aluno, pela disciplina e pela nota. A Proctoria aplica a prova fiscalizada e devolve o resultado depois da liberação do administrador.

1. O aluno abre a prova na Pionira.
2. O servidor da Pionira pede à Proctoria o endereço de prova daquele aluno.
3. A Pionira redireciona o aluno para o endereço recebido.
4. O aluno faz a prova na Proctoria.
5. O administrador revisa a sessão e libera o resultado.
6. A Proctoria envia o resultado ao endereço de retorno da Pionira.

A chamada do passo 2 parte do servidor da Pionira, nunca do navegador do aluno: a chave de integração não pode aparecer no código da página.

## Credencial

A chave de integração fica em Administração, Configurações. Ela segue em todas as chamadas:

```
Authorization: Bearer pct_xxxxxxxxxxxxxxxxxxxxxxxx
```

Gerar uma nova chave invalida a anterior.

## 1. Listar as provas

```
GET /api/integracao/provas
```

```json
[{ "id": "5339f29cfe13f790", "titulo": "Valor Vitalício do Cliente: prova final" }]
```

O `id` da prova é o que a Pionira guarda na disciplina correspondente.

## 2. Criar o endereço de prova do aluno

```
POST /api/integracao/convites
Content-Type: application/json

{
  "prova": "5339f29cfe13f790",
  "aluno": { "id": "pio-1001", "nome": "Nome completo do aluno", "email": "aluno@exemplo.com" }
}
```

```json
{
  "codigo": "k7m2…",
  "endereco": "https://prova.exemplo.com/prova#k7m2…",
  "enderecoSEB": "sebs://prova.exemplo.com/api/seb/config.seb?c=k7m2…",
  "navegador": "comum",
  "prova": { "id": "5339f29cfe13f790", "titulo": "Valor Vitalício do Cliente: prova final", "duracaoMin": 60 },
  "jaIniciada": false
}
```

- `aluno.id` é o identificador do aluno na Pionira. É a chave que volta no resultado.
- A chamada é idempotente: o mesmo aluno na mesma prova recebe sempre o mesmo endereço. Depois de uma queda, o aluno retoma a sessão pelo mesmo endereço.
- O endereço é pessoal. A Pionira deve entregá-lo apenas ao aluno autenticado.
- `navegador` informa a regra da prova: `comum` (Google Chrome ou Microsoft Edge), `seb` (somente o Safe Exam Browser) ou `ambos`.
- A Pionira pode usar sempre `endereco`. Quando a prova exige o Safe Exam Browser, essa página orienta o aluno e apresenta o botão de abertura no programa. `enderecoSEB` abre a prova diretamente no Safe Exam Browser e serve a quem preferir oferecer esse botão na própria Pionira.

## 3. Receber o resultado

Quando o administrador libera o resultado de uma sessão, a Proctoria envia um `POST` ao endereço de retorno configurado em Administração, Configurações:

```json
{
  "evento": "resultado_liberado",
  "enviadoEm": "2026-10-11T04:40:00.000Z",
  "resultado": {
    "sessao": "37f61abd98884eebb08c0be3",
    "prova": { "id": "5339f29cfe13f790", "titulo": "Valor Vitalício do Cliente: prova final" },
    "aluno": { "id": "pio-1001", "nome": "Nome completo do aluno", "email": "aluno@exemplo.com" },
    "situacao": "entregue",
    "situacaoFinal": "valida",
    "nota": 3,
    "total": 4,
    "iniciadaEm": "2026-10-11T04:00:00.000Z",
    "encerradaEm": "2026-10-11T04:38:00.000Z",
    "suspensoes": 1,
    "advertencias": 2,
    "bloqueios": 0,
    "quedas": 0,
    "parecer": "Texto do parecer do administrador."
  }
}
```

| Campo | Valores |
| --- | --- |
| `situacao` | `entregue`, `tempo_esgotado`, `invalidada`, `encerrada_durante_bloqueio`, `encerrada_pelo_administrador` |
| `situacaoFinal` | `valida`, `invalidada` ou vazio (decisão pendente). É a decisão do administrador depois da revisão. |
| `nota` e `total` | Pontos obtidos e pontos possíveis. A conversão para a escala da disciplina cabe à Pionira. |

### Conferência da origem

O cabeçalho `X-Proctoria-Assinatura` traz `sha256=` seguido do HMAC-SHA256 do corpo da requisição, calculado com a chave de integração. A Pionira deve recalcular o valor sobre o corpo recebido, sem alterações, e recusar a chamada quando a assinatura não coincidir.

A Proctoria considera a entrega feita com qualquer resposta `2xx`. Uma falha fica registrada na sessão, e o administrador pode reenviar.

## 4. Consultar os resultados liberados

Alternativa ao endereço de retorno, ou conferência posterior:

```
GET /api/integracao/resultados?prova=5339f29cfe13f790
GET /api/integracao/resultados?prova=5339f29cfe13f790&aluno=pio-1001
```

A resposta é uma lista de objetos no formato de `resultado` descrito acima. Só aparecem as sessões cujo resultado o administrador já liberou.

## Erros

| Código | Significado |
| --- | --- |
| 400 | Dados ausentes: `aluno.id` e `aluno.nome` são obrigatórios |
| 401 | Chave de integração ausente ou inválida |
| 404 | Prova inexistente ou arquivada |

O corpo dos erros tem o formato `{ "erro": "mensagem" }`.

## O que a Pionira precisa implementar

1. Guardar, em cada disciplina, o `id` da prova na Proctoria.
2. No botão da prova, chamar `POST /api/integracao/convites` a partir do servidor e redirecionar o aluno para `endereco`.
3. Expor um endereço de retorno que confira a assinatura e grave a nota do aluno.
