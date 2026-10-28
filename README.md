# Busca de Vagas

Encontra vagas **remotas e recém-publicadas** de desenvolvimento (fullstack, front, back, mobile), estima a **chance de retorno** de cada uma, indica qual currículo usar e acompanha suas candidaturas com gráficos. Também ajuda a preencher formulários.

O envio da candidatura é **sempre feito por você**. Isso respeita os termos dos sites (Gupy, LinkedIn etc. proíbem robôs) e evita candidaturas genéricas em massa.

## Como usar

```powershell
cd D:\projetos\busca-vagas
npm install          # só na primeira vez
npm run painel       # abre http://127.0.0.1:4321 no navegador
```

No painel, clique em **Buscar agora**. Também dá para buscar pelo terminal: `npm run buscar` (ou `node buscar.mjs --sem-ia`).

### Abas

| Aba | Para quê |
|---|---|
| **Vagas** | Lista ordenada pela chance de retorno. Mostra há quanto tempo foi publicada (verde se < 24h), tecnologias em comum, currículo indicado e o link da vaga. Use **Marquei como aplicada** depois de se candidatar. |
| **Candidaturas** | Tudo o que você aplicou. Marque o resultado: Retornou, Entrevista, Proposta, Recusada ou Sem retorno. Após 14 dias sem resposta, aparece um aviso. |
| **Resultados** | Taxa de retorno, funil e gráficos: retorno por idade da vaga ao aplicar, por faixa de chance, por fonte, por tipo de vaga e candidaturas por dia. |
| **Meus dados** | Respostas para os campos comuns de formulários, com botão Copiar e o favorito **Preencher formulário**. |

## Busca automática e notificações

Com o painel aberto, ele busca sozinho a cada 60 minutos, das 8h às 22h.

Quando chegam vagas **novas com chance ≥ 60%**, aparece uma notificação do Windows com a melhor vaga e os botões **Abrir painel** e **Ver a vaga**.

- A notificação é do tipo **lembrete**: aparece mesmo com o "Não perturbe" do Windows 11 ligado e fica na tela até você clicar.
- O botão **🔔 Testar aviso** no topo do painel envia uma notificação de teste.
- Ajustes em `config.json` → `automatico`: intervalo, horário, chance mínima para avisar, ou `ativo: false` para desligar.
- Para receber avisos com o painel **fechado**: rode `.\agendar.ps1` no PowerShell. Isso cria uma tarefa agendada do Windows; para remover, use `.\agendar.ps1 -Remover`. Se usar a tarefa, desligue a busca automática do painel para não consultar as fontes em dobro.

## Chance de retorno

Uma nota de 0 a 100, recalculada a cada vez que o painel abre (ela cai com o passar das horas):

- **50% frescor**: a pontuação cai pela metade a cada 48h desde a publicação. Quem aplica nas primeiras horas está no topo da pilha do recrutador.
- **35% aderência**: tecnologias em comum com o seu currículo, senioridade e tipo de vaga. Se a IA estiver ligada, usa a nota dela.
- **15% concorrência**: vagas de comunidades brasileiras recebem bem menos candidatos do que vagas remotas globais.

Os pesos ficam em `config.json` → `chance`. A aba Resultados mostra se a nota está funcionando: se estiver, as faixas altas de chance devem ter taxa de retorno maior.

## Botão "Aplicar" (o jeito mais rápido)

1. No card da vaga, clique em **Aplicar**. Abre uma janela do Edge controlada pelo programa. Ela usa um perfil próprio, guardado em `dados/navegador`: na primeira vez, faça login na Gupy, no LinkedIn etc. nessa janela, e ele lembra.
2. Se a página for só a descrição, ele clica em "Candidatar-se/Apply" para chegar ao formulário.
3. Preenche os campos que reconhece (contorno **verde**) e marca os obrigatórios que ficaram vazios (contorno **laranja**).
4. Um **kit flutuante** aparece na página, com botões de copiar:
   - prompt pronto para o ChatGPT ("por que esta empresa" e carta);
   - sobre mim;
   - maior desafio;
   - pretensão.
5. Confira, clique em **Enviar** no site e depois em **✔ Já enviei** no kit: a vaga fica marcada como aplicada no painel.

O programa **nunca clica em enviar**.

Em formulários de várias etapas, o kit volta a aparecer a cada página; use "Preencher campos" de novo se precisar.

## Preenchimento de formulários (favorito, sem o painel)

1. Aba **Meus dados**: preencha e salve. Só vem pré-preenchido o que está escrito no seu currículo (nome, contato, LinkedIn, cidade, formação, inglês).
2. Arraste o botão **⇢ Preencher formulário** para a barra de favoritos (Ctrl+Shift+B mostra a barra).
3. Na página do formulário, clique no favorito. Ele preenche apenas os campos **vazios** que reconhece, contorna-os em verde e **nunca envia**.

Observações:
- Funciona com formulários React/Vue (testado com um formulário React controlado).
- Se o formulário estiver dentro de um iframe de outro domínio (comum no Greenhouse), abra esse iframe em uma aba própria.
- Depois de editar seus dados, salve e arraste o botão de novo: o favorito guarda uma cópia dos dados.

## Fontes

| Fonte | O que traz |
|---|---|
| Remotar | Vagas remotas no Brasil, atualizadas em minutos (API do próprio site, não documentada) |
| GitHub | backend-br, frontendbr, react-brasil, phpdevbr, nodejsdevbr, androiddevbr, soujava |
| We Work Remotely, Himalayas, Jobicy, Working Nomads, Remotive, RemoteOK, Arbeitnow | Vagas remotas internacionais (vagas restritas a EUA/Europa são descartadas) |
| Greenhouse / Lever | Páginas de carreira de empresas específicas: edite `fontes.greenhouse.empresas` e `fontes.lever.empresas` no `config.json` |
| Programathor | Vagas de dev no Brasil. A data vem da página de cada vaga remota (aberta uma vez e guardada em cache) |
| Nerdin | Lista de vagas home office, com data exata; a descrição vem da página da vaga (com cache) |
| Sólides | Portal vagas.solides.com.br, área Tecnologia, só remotas |
| Recrutei | Portal empregos.recrutei.com.br, pelos termos de `fontes.recrutei.buscas` |
| InHire | Páginas de carreira por empresa (`fontes.inhire.empresas`, o subdomínio de `empresa.inhire.app`) |
| Coodesh | Sitemap público de vagas. Rende pouco: hoje o sitemap traz quase só vagas presenciais do Google |

Os caches de detalhes ficam em `dados/cache-<fonte>.json` e descartam sozinhos o que não aparece há 30 dias.

A Gupy, o LinkedIn e a Catho ficam de fora: não têm API pública e os termos deles proíbem automação. O UpVagas também não entra: é um blog sem vagas de dev.

A Remotive pede no máximo 4 consultas por dia. Buscar de 2 a 4 vezes por dia é o ideal.

## IA (opcional)

Com credencial da Anthropic configurada, cada busca analisa as melhores vagas novas (até 15 por execução, `config.json` → `ia`). A análise traz:
- nota de 0 a 10;
- pontos fortes e lacunas;
- uma carta curta no idioma da vaga, sem inventar experiência.

Ative assim:

```powershell
$env:ANTHROPIC_API_KEY = "sua-chave"   # ou: ant auth login
```

A IA usa o Claude Opus 5.5 com fallback automático do servidor (`fallbacks: "default"`), caso o modelo recuse um pedido. O currículo fica em cache entre as vagas para economizar. Sem credencial, tudo funciona normalmente, só sem as notas da IA e as cartas.

## Configuração (`config.json`)

- `curriculos`: qual arquivo de `D:\curriculo` usar por tipo de vaga e idioma.
- `stack`: tecnologias e o peso de cada uma na aderência.
- `filtros`: idade máxima das vagas, nota mínima, títulos excluídos, localizações aceitas e penalidade para vagas sênior.
  - `aceitar_junior` e `bonus_junior` controlam as vagas júnior.
  - Estágio e trainee ficam sempre de fora (`excluir_estagio`).
  - Anúncios em massa ("Trabalhe de Casa … / Ref. 0289P") perdem 20 pontos e vêm com um aviso.
- `fontes.remotar.buscas`: termos pesquisados na Remotar.
- `chance`: meia-vida do frescor e pesos.

Os dados ficam em `dados/` (vagas, status e "Meus dados"). Essa pasta está no `.gitignore` e o painel só aceita conexões do próprio computador.
