# Book Técnico

Editor de books técnicos multicloud (OCI · AWS · Azure · GCP · VMware), com menus customizáveis,
blocos arrastáveis e exportação para **PDF**, **Word** e **HTML**.

## Como rodar

```bash
npm run dev            # http://localhost:5173  (Node 22.5+; SQLite nativo, sem dependências)
npm install            # só para usar o MongoDB fora do container (instala o driver "mongodb")
npm test               # testa a API, login, lixeira, backup, conectores e casos-limite (com respostas simuladas)
npm run build          # gera book-tecnico.html (versão de arquivo único, para abrir sem servidor)
```

### Rodar em container 🐳

```bash
cp .env.example .env              # 1ª vez: defina usuário/senha do MongoDB (e porta, fuso…)
docker compose up -d --build      # ou: npm run docker:up   →  http://localhost:5173
docker compose logs -f book-tecnico   # npm run docker:logs (só o app)
docker compose down               # npm run docker:down (os dados continuam no volume)
```

O compose sobe dois containers: o app (`node:22-alpine` + drivers) e um **MongoDB 7** já com usuário e senha:
na primeira subida o MongoDB cria o usuário de `MONGO_USER`/`MONGO_PASSWORD` (arquivo `.env`) e o app conecta com
ele sozinho (`MONGO_URL` é montada a partir dessas variáveis). Sem `.env`, valem os padrões do compose — troque a
senha antes de usar em produção. Mudar a senha depois não altera o usuário já criado no volume. Por padrão
(`BOOK_STORAGE=mongo`) tudo fica no MongoDB, no volume `mongo-data`: books, templates, conexões, configurações
globais e sessões do navegador. Se já existir conteúdo antigo em arquivos (`data/books`, …) e o banco estiver
vazio, ele é importado na primeira subida. Para usar SQLite, troque `BOOK_STORAGE` para `sqlite`; vazio, a escolha
é feita em ⚙️ Configurações. Para abrir o banco no Compass, descomente a porta `27017` do serviço `mongo`.

O log do MongoDB não aparece no terminal: ele vai para `/data/db/mongod.log` dentro do container
(`docker exec book-tecnico-mongo tail -f /data/db/mongod.log`). Com `BOOK_STORAGE` definido, ⚙️ Configurações
mostra só o armazenamento em uso e se está conectado.

## Instalar, atualizar e remover com um comando (Windows)

O **instalar** baixa o projeto para **Downloads**, cria o `.env` a partir do exemplo, sobe o app com o MongoDB e abre o navegador.
O **atualizar** baixa a versão mais nova do GitHub e mantém o `.env` e os dados (books, usuários, MongoDB).
O **remover** apaga containers, volumes (**inclusive os dados do MongoDB**), imagens e arquivos baixados.

### > Docker

Requisito: **Docker Desktop** aberto (já traz o `docker compose`).

#### PowerShell 7

Instalar:

```powershell
Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip && Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force && Set-Location $HOME\Downloads\book-tecnico-main && Copy-Item .env.example .env && docker compose up -d --build && Start-Process http://localhost:5173
```

Atualizar:

```powershell
Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip && Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force && Set-Location $HOME\Downloads\book-tecnico-main && docker compose up -d --build
```

Remover:

```powershell
Set-Location $HOME\Downloads\book-tecnico-main && docker compose down -v --rmi all && Set-Location $HOME && Remove-Item $HOME\Downloads\book-tecnico-main, $HOME\Downloads\book-tecnico.zip -Recurse -Force; docker rmi node:22-alpine
```

#### PowerShell 5.1

Instalar:

```powershell
$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip -UseBasicParsing; Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force; Set-Location $HOME\Downloads\book-tecnico-main; Copy-Item .env.example .env; docker compose up -d --build; if ($LASTEXITCODE) { throw 'compose falhou' }; Start-Process http://localhost:5173
```

Atualizar:

```powershell
$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip -UseBasicParsing; Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force; Set-Location $HOME\Downloads\book-tecnico-main; docker compose up -d --build; if ($LASTEXITCODE) { throw 'compose falhou' }
```

Remover:

```powershell
$ErrorActionPreference='Stop'; Set-Location $HOME\Downloads\book-tecnico-main; docker compose down -v --rmi all; if ($LASTEXITCODE) { throw 'compose falhou' }; Set-Location $HOME; Remove-Item $HOME\Downloads\book-tecnico-main, $HOME\Downloads\book-tecnico.zip -Recurse -Force; docker rmi node:22-alpine 2>$null
```

No Docker, a imagem base do Node é removida por último: se ela já não existir, o erro não interrompe o resto.

### > Podman

Requisitos: Podman com a máquina iniciada (`podman machine start`) e um provedor de compose (`podman compose` usa o docker-compose ou o podman-compose).

#### PowerShell 7

Instalar:

```powershell
Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip && Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force && Set-Location $HOME\Downloads\book-tecnico-main && Copy-Item .env.example .env && podman compose up -d --build && Start-Process http://localhost:5173
```

Atualizar:

```powershell
Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip && Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force && Set-Location $HOME\Downloads\book-tecnico-main && podman compose up -d --build
```

Remover:

```powershell
Set-Location $HOME\Downloads\book-tecnico-main && podman compose down -v --rmi all && podman rmi --ignore docker.io/library/node:22-alpine && Set-Location $HOME && Remove-Item $HOME\Downloads\book-tecnico-main, $HOME\Downloads\book-tecnico.zip -Recurse -Force
```

#### PowerShell 5.1

Instalar:

```powershell
$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip -UseBasicParsing; Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force; Set-Location $HOME\Downloads\book-tecnico-main; Copy-Item .env.example .env; podman compose up -d --build; if ($LASTEXITCODE) { throw 'compose falhou' }; Start-Process http://localhost:5173
```

Atualizar:

```powershell
$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest https://github.com/xdarkerx/book-tecnico/archive/refs/heads/main.zip -OutFile $HOME\Downloads\book-tecnico.zip -UseBasicParsing; Expand-Archive $HOME\Downloads\book-tecnico.zip $HOME\Downloads -Force; Set-Location $HOME\Downloads\book-tecnico-main; podman compose up -d --build; if ($LASTEXITCODE) { throw 'compose falhou' }
```

Remover:

```powershell
$ErrorActionPreference='Stop'; Set-Location $HOME\Downloads\book-tecnico-main; podman compose down -v --rmi all; if ($LASTEXITCODE) { throw 'compose falhou' }; podman rmi --ignore docker.io/library/node:22-alpine; Set-Location $HOME; Remove-Item $HOME\Downloads\book-tecnico-main, $HOME\Downloads\book-tecnico.zip -Recurse -Force
```

### Observações

- **PowerShell 7** usa `&&`, que para no primeiro erro. O **PowerShell 5.1** não tem `&&`, então usa `;` com `$ErrorActionPreference='Stop'` e `if ($LASTEXITCODE) { throw … }`, que fazem o mesmo papel. O `Tls12` e o `-UseBasicParsing` evitam falhas de download no 5.1. O `Stop` continua valendo naquela janela: feche e abra o PowerShell se incomodar.
- O `.env` criado usa a senha de exemplo do MongoDB: para uso real, edite o `.env` antes de subir.

## Como a página e os dados são organizados

A página é dividida em partes, na pasta `html/`:

| Arquivo | Conteúdo |
|---|---|
| `index.html` | esqueleto da página, só com os marcadores `<!-- @include html/… -->` |
| `html/head.html` | fontes e folhas de estilo |
| `html/menu.html` | barra lateral (capa, menus e seções, "Novo menu") |
| `html/header.html` | barra superior (título, status, sessão, dados de cloud, arquivo, exportar ▾ com pré-visualização) |
| `html/editor.html` | área de edição |
| `html/palette.html` | paleta de blocos e atalhos de dados de cloud |
| `html/preview.html` | pré-visualização e área de impressão |
| `html/settings.html` | ⚙️ Configurações (menus padrão dos novos books, comparativo, armazenamento) |
| `html/layers.html` | modais, avisos e seletores de arquivo |
| `html/scripts.html` | scripts do app, na ordem de carregamento |

Como a página é montada em cada forma de abrir:
- **`npm run dev`:** o servidor junta as partes antes de enviar a página.
- **Outro servidor** (ex.: Live Server): `js/core/include.js` busca as partes no navegador.
- **Duplo-clique:** abra `book-tecnico.html`, que já vem montado. O navegador não lê as partes via `file://`.
  Depois de editar algo em `html/`, rode `npm run build` para regenerar esse arquivo.

Com `npm run dev` (ou o container), o book aberto e a tela atual ficam no **cookie** e na URL, e o conteúdo fica
no servidor, em um dos dois bancos (escolha em **⚙️ Configurações › Onde salvar os books**):
- **SQLite** (padrão): um arquivo só, `data/book-tecnico.sqlite`, com o SQLite nativo do Node (sem dependências).
  Backup = copiar o arquivo.
- **MongoDB**: coleções `books`, `templates`, `connections`, `settings` e `sessions` no banco `MONGO_DB`
  (padrão `book_tecnico`), em `MONGO_URL` (padrão `mongodb://127.0.0.1:27017`). O endereço e o banco também podem
  ser definidos na tela, com o botão **🔌 Testar conexão** (as variáveis de ambiente têm prioridade; a senha nunca
  volta ao navegador e `data/settings.json` é gravado com permissão 600).

**Versões antigas (arquivos em `data/books/…`):** na primeira inicialização, books, templates, conexões e sessões
são importados para o banco ativo, se ele estiver vazio. Os arquivos não são apagados (ficam como backup), e
`BOOK_STORAGE=file` / `"storage": "file"` passam a valer como `sqlite`.

**Sessões do navegador:** além do cookie, cada navegador tem um identificador (cookie `bt_sid`) e a sessão (book
aberto, tela e URL) é gravada no armazenamento ativo. Se o cookie do book se perder, a sessão volta do servidor.

A troca pode copiar books, templates, conexões e sessões para o outro banco (nos dois sentidos).
Variáveis opcionais: `PORT=5173`, `HOST=0.0.0.0` (libera acesso pela rede), `BOOK_DATA_DIR=/caminho/dos/dados`,
`BOOK_STORAGE=sqlite|mongo` (fixa o banco), `BOOK_TRUST_PROXY=1` (só atrás de um proxy reverso: usa o IP do cabeçalho `X-Forwarded-For` nos logs e no bloqueio de força bruta), `BOOK_DB_FILE` (caminho do SQLite), `MONGO_URL` e `MONGO_DB`.

Abrir o `book-tecnico.html` direto (duplo-clique) também funciona, mas os books ficam só naquele navegador e as
conexões de cloud ficam indisponíveis.

### Navegação e URL
**Clientes › Ano › Books › Editor**, e cada tela tem seu endereço:

| URL | Tela |
|---|---|
| `/` | lista de clientes |
| `/?cliente=acme&ano=2026` | books do cliente no ano |
| `/?cliente=acme&ano=2026&mes=11&area=infracloud` | editor do book |
| `…&secao=<id>` | seção aberta no editor |

**Excluir:** na lista de clientes, passe o mouse no card e use 🗑 (ou **🗑 Excluir cliente** na página do cliente)
para remover o cliente com **todos os anos, books e conexões**. Na página do cliente, **🗑 Excluir 2026** remove
todos os books daquele ano. Há sempre uma confirmação, e o que é excluído vai para a **lixeira**: um administrador
restaura em ⚙️ › Lixeira por até 30 dias (veja "Lixeira" abaixo). Sem servidor (`book-tecnico.html`), a exclusão é definitiva.

O link pode ser compartilhado ou salvo nos favoritos. Recarregar a página volta exatamente ao mesmo lugar: a URL,
o cookie `bt_book`/`bt_route` e o arquivo no servidor guardam tudo. O botão Voltar do navegador também funciona.
Um link para um book que ainda não existe abre a criação já preenchida.

### Criar um book
Em **＋ Novo book**, escolha cliente, ano, mês, área técnica e o **template**:
- **InfraCloud:** completo, com todas as clouds (servidores, rede, segurança, storage, backup) e operações.
- **Network:** topologia, conectividade, VCN/VPC/VNet, subnets, segurança de rede, LB, DNS e firewall.
- **Backup:** indicadores, política, jobs, falhas, cobertura por cloud, testes de restore e retenção.
- **Em branco**, ou **templates personalizados** criados em *Arquivo › Salvar como template*.

Também dá para copiar outro book do cliente (só estrutura e textos, ou tudo), criar a partir de um ZIP ou
usar ⧉ na lista para gerar o próximo mês.

### Dados de cloud direto das APIs (sem ZIP)
1. Na página do cliente, abra **🔑 Conexões de cloud** e configure OCI, AWS, Azure e/ou GCP. Depois use **⚡ Testar conexão**.
2. No editor, use **☁️ Dados de cloud › 🔄 Sincronizar com a cloud**, escolha as clouds e o que buscar
   (servidores, storage, redes, baseline). Na tela de revisão, confira o destino e escolha as linhas antes de aplicar.

**Várias contas no mesmo provedor (ex.: AWS PRD e HML):** em cada aba de **🔑 Conexões**, use **＋ Adicionar conta**,
dê um nome a ela em **Nome da conta** (ex.: `PRD`, `HML`) e preencha as credenciais. **🗑 Remover conta** apaga a conta
selecionada (ao salvar). Quando o provedor tem mais de uma conta ativa, a sincronização lista cada conta separadamente
e o book ganha um menu por conta (ex.: "AWS · PRD" e "AWS · HML"), também listados em "Ambientes" na capa.

| Cloud | Credencial | Permissão (somente leitura) |
|---|---|---|
| OCI | `~/.oci/config` do servidor ou API key (tenancy, user, fingerprint, chave) | `inspect all-resources`, `read instances/volumes/virtual-network-family/buckets` |
| AWS | profile de `~/.aws/credentials` ou Access Key | `ReadOnlyAccess` (ou `ec2:Describe*`, `s3:ListAllMyBuckets`) |
| Azure | service principal (tenant, client id, secret) | role **Reader** nas assinaturas |
| GCP | JSON de conta de serviço | `roles/viewer` |

#### Geral (tenant) e Cloud Security Score
Na sincronização, marque **🏷️ Geral (tenant)** e/ou **🛡️ Security Score**.

**Geral** é a primeira seção do menu de cada cloud (acima de Servidores, Networking, Segurança…). Ela traz a planilha
**Tenant**, com as colunas no formato daquela cloud:

| Cloud | Colunas de Geral › Tenant |
|---|---|
| OCI | Tenancy, OCID, Região principal, Regiões assinadas, Descrição |
| AWS | Conta, Account ID, Alias, ARN, Regiões |
| Azure | Tenant, Tenant ID, Assinatura, Subscription ID, Estado (uma linha por assinatura) |
| GCP | Projeto, Project ID, Número, Organização / Pasta |

O bloco **Cloud Security Score** fica na **Segurança** de cada cloud ou conta. Ele tem três partes: a **pontuação**,
as **recomendações** e os **alertas**, com as colunas no formato de cada cloud:

| Cloud | Pontuação | Recomendações | Alertas | Permissão extra |
|---|---|---|---|---|
| OCI | Cloud Guard (0–100) | recomendações do Cloud Guard (risco, problemas, compartimento) | problemas abertos do Cloud Guard | `read cloud-guard-family` |
| AWS | Security Hub: % de controles aprovados por região | controles reprovados (controle, título, severidade, recursos reprovados) | findings críticos e altos de outros serviços (GuardDuty, Inspector…) | `securityhub:GetFindings`, `iam:ListAccountAliases` |
| Azure | Defender for Cloud Secure Score por assinatura | recomendações não íntegras (severidade, recursos afetados) | alertas de segurança ativos | Reader ou Security Reader |
| GCP | sem score nativo: à mão ou pelo ZIP | à mão ou pelo ZIP | à mão ou pelo ZIP | — |

O bloco também está na paleta. No editor, o seletor **Formato de recomendações e alertas** define as colunas
(OCI, AWS, Azure, GCP ou Genérico), e as linhas podem ser editadas à mão. Cada pontuação mostra o percentual e uma
barra colorida (≥ 80% bom, ≥ 60% atenção, abaixo disso crítico). No book, a severidade aparece como etiqueta colorida.
Sincronizar de novo atualiza o bloco, sem duplicar.

**Escolher os riscos ao importar:** na tela de revisão da sincronização (e do ZIP), a opção **🛡️ Segurança — riscos a
importar** mostra quantas recomendações e alertas há de cada risco (Crítica, Alta, Média, Baixa, Informativa). Só os
riscos marcados entram no book. A tela mostra o total, por exemplo "Entram 6 de 12 recomendações/alertas", e a escolha
fica lembrada para as próximas importações neste navegador. Itens sem risco informado sempre entram.

Se a sincronização trouxer as recomendações mas não a pontuação, a tela avisa o motivo (ex.: o Cloud Guard ainda não
calculou a pontuação da tenancy). O resto entra normalmente.

#### Zabbix e GLPI (monitoramento e chamados)
Configure-os nas mesmas **Conexões** do cliente. A sincronização usa o **período do book** (do primeiro ao
último dia do mês), que pode ser ajustado.

| Fonte | Preenche |
|---|---|
| **Zabbix** (URL, API token ou usuário/senha, host groups) | **Capacidade:** relatório igual ao book original, com indicadores, resumo executivo, top 5 hosts com mais alertas (CPU/MEM/DISCO), top CPU, top memória, filesystems em alerta, gráfico de alertas por dia e de severidade. **Monitoramento:** hosts com CPU/memória médias, maior disco e alertas. **Servidores — Recomendações:** onde aumentar **CPU, RAM ou disco**, com prioridade. |
| **GLPI** (URL, App-Token, token de usuário) | **Incidentes:** indicadores (chamados, incidentes, requisições, resolvidos, em aberto, backlog, tempo médio), gráficos por status, categoria e dia, e a planilha de chamados |

Na sincronização do Zabbix dá para escolher as **severidades** que entram (Desastre, Alta, Média, Atenção,
Informação, Não classificado). Também dá para **incluir ou não os servidores sem nenhum alerta** no período (planilha de Monitoramento).

Os limites que geram recomendações (padrão CPU 80%, memória 80%, disco 85%) são configuráveis. A classificação
dos triggers é a mesma do book original: falha de coleta, swap, latência de I/O, serviços parados e jobs de
backup não contam como consumo. Sincronizar de novo **atualiza** os blocos, sem duplicar.

#### Importar chaves
Em **Conexões › 📥 Importar chaves**, envie os arquivos de credencial e o formulário é preenchido sozinho:
`~/.oci/config`, chave `.pem`, CSV de access key da AWS, `~/.aws/credentials`, JSON da conta de serviço do GCP,
JSON do `az ad sp create-for-rbac` e JSON com várias conexões (`{"providers": {…}}`).

As credenciais ficam **somente no servidor** (no banco ativo: tabela/coleção `connections`). A API devolve os
segredos mascarados. Os conectores não usam SDK: as assinaturas (SigV4, OCI HTTP Signature, OAuth, JWT) são feitas
com o `crypto` do Node e foram testadas com respostas simuladas, incluindo o vetor oficial da AWS. Ainda não foram
testadas contra contas reais.

### Preencher tudo de uma vez com um ZIP 📦
Use **Criar a partir de ZIP** em "Novo book" (cria um book novo) ou **☁️ Dados de cloud › Importar ZIP**
(aplica no book aberto). Em **Baixar modelo de ZIP** você recebe a estrutura pronta com `LEIA-ME.txt`.

| No ZIP | Vai para |
|---|---|
| `manifest.json` | capa: `cliente`, `mes`, `ano`, `area`, `responsavel`, `time`, `subtitulo`, `governanca{}`, e `textos{"Seção": "texto"}` |
| `logo.png` (na raiz) | logo do cliente na capa |
| `oci/servidores.csv`, `aws/storage.xlsx`, `azure/redes.csv`, `vmware/rvtools.xlsx`, `oci/baseline.csv` | a pasta indica o provedor e o nome indica a seção; exports nativos são reconhecidos |
| `operacoes/incidentes.csv`, `book/equipe.csv` … | seções que casam pelo nome |
| `aws/geral.csv` (ou `tenant.csv` dentro da pasta da cloud) | **Geral › Tenant** daquela cloud (colunas no formato da cloud, como na tabela acima) |
| `aws/security-score.csv` | pontuação do **Cloud Security Score** na Segurança daquela cloud. Colunas: `Conta`, `Pontuação` (0–100, ou com `Máximo`), `Fonte`, `Detalhe` |
| `aws/security-recomendacoes.csv`, `aws/security-alertas.csv` | recomendações e alertas do mesmo bloco (as colunas do arquivo viram as colunas da planilha). Os três arquivos de uma cloud se juntam num bloco só |
| `oci/networking/topologia.png` | imagens na seção indicada pelas pastas |
| `book/objetivo.txt` / `.md` | texto da seção |
| `*.book.json` | projeto completo usado como base |

**Para testar:** a pasta `tools/exemplo-zip/` tem um exemplo pronto com Geral, Security Score (pontuação, recomendações
e alertas) de OCI, AWS, Azure e GCP, servidores, incidentes e `manifest.json`. Para gerar o ZIP:

```powershell
Compress-Archive -Path .\tools\exemplo-zip\* -DestinationPath $HOME\Downloads\exemplo-book.zip -Force
```

Antes de aplicar, uma **tela de revisão** mostra cada arquivo com tipo, provedor, seção de destino e modo
(substituir, acrescentar ou nova planilha). O botão **✎** escolhe as **linhas e colunas** de cada arquivo.
O app aceita também uma pasta-raiz dentro do ZIP e ignora `__MACOSX`, `LEIA-ME` e arquivos ocultos.

> Para ler `.xlsx`, o app carrega a biblioteca SheetJS da internet (CDN). Sem internet, salve a
> planilha como CSV, porque o CSV tem leitor próprio e funciona offline.

### ⚙️ Configurações (dois menus)
Pelo botão **⚙️** no topo do editor, **⚙️ Configurações** na tela de clientes ou **Arquivo › ⚙️ Configurações**.

**Usuário** (todos):
- **Preferências:** tema claro, escuro ou igual ao sistema. Com login, a escolha fica no seu usuário (vale em qualquer computador).
- **Opções de book:** template padrão, menus/seções de cada template, menus extras e comparativo mensal (valem para os novos books de todos).

**Administrador** (só aparece para admins; com o login desligado, todos são admin):
- **Banco de dados:** SQLite ou MongoDB (status, contagens, conexão do Mongo com teste, troca com migração) e **excluir um banco**
  — qualquer um, inclusive o em uso, digitando o nome para confirmar; um backup dele é salvo antes na pasta local.
- **Login e acesso:** usuários, login normal e Microsoft (SAML) e **grupos do Entra ID** (abaixo).
- **Edição simultânea:** bloqueio do book (abaixo).
- **Backup**, **Lixeira** e **Logs e auditoria** (abaixo).

### 🗑️ Lixeira (com GUID)
Cada **cliente, ano e book tem um GUID**. Excluir não apaga: vai para a lixeira com **quem excluiu e quando**.
- Em **⚙️ › Lixeira**, o admin busca (nome, GUID, quem excluiu), **restaura** ou **exclui definitivamente**.
- Recriar algo com o mesmo nome gera um GUID novo: a lixeira mostra os dois lado a lado (**"duplicado: existe um ativo"**).
- Restaurar com conflito pergunta: **restaurar como cópia** ("InfraCloud (restaurado)", GUID novo) ou **substituir o atual** (o atual vai para a lixeira).
- Itens não restaurados são apagados sozinhos após **30 dias** (ajustável). Sem servidor (arquivo aberto direto), excluir continua definitivo.

### 📜 Logs e auditoria
Em **⚙️ › Logs e auditoria**, em abas, com período, filtro de texto e exportação CSV:
- **Requisições HTTP:** método, caminho, status, tempo, usuário e IP (dá para ocultar os "sinais de vida" do bloqueio).
- **Banco de dados:** cada gravação (operação, alvo, banco, tempo, erro).
- **Demais informações:** início/parada do servidor, trocas de banco, backups, sincronização do Entra ID, erros.
- **Auditoria:** logins (e tentativas recusadas), saídas, usuários criados/alterados/excluídos, papéis, exclusões e restaurações
  da lixeira, backups e restaurações, exclusão de banco e mudanças de configuração.

Ficam em `data/logs/` (um arquivo por dia): 90 dias, auditoria 1 ano. Senhas, tokens e `sid` são mascarados.

### 🗄️ Backup
Em **⚙️ › Backup**: books, templates, conexões de cloud, usuários, lixeira e menus padrão num arquivo compactado,
**criptografado com senha** (AES-256-GCM; sem senha, `.json.gz`).
- **Destinos** (vários ao mesmo tempo, cada um com **🔌 Testar destino**): pasta local, **caminho de rede**
  (`\\servidor\pasta` no Windows; no container, monte o compartilhamento como volume), **FTP/FTPS** e
  **bucket da Oracle** (URL pré-autenticada ou chave de API).
- **Fazer backup agora**, **Baixar um backup** e **agendado** todo dia num horário, mantendo os últimos N em cada destino.
- **Restaurar** enviando o arquivo (e a senha): substitui o conteúdo do banco em uso; antes, salva um backup de segurança.
  Login, SAML e destinos de backup (em `data/settings.json`) não são alterados pela restauração.

### 🔐 Login, usuários e login Microsoft (SAML)
Desligado por padrão (o app abre sem senha, como antes). Para ligar, em **⚙️ Configurações › Login e acesso**:
1. Cadastre um usuário **administrador** (ou, com o login já ligado e nenhum usuário, a tela de **configuração inicial** pede para criá-lo).
2. Cadastre os outros usuários (papel **Usuário** ou **Administrador**) e marque **Exigir login**. Salve: a tela de login aparece.

- Senhas guardadas com `scrypt` (sal por usuário); a sessão é um cookie `HttpOnly`/`SameSite=Lax` (`Secure` em HTTPS) de 7 dias, renovado com o uso. No banco fica só o hash do token.
- 5 senhas erradas seguidas bloqueiam o login daquele usuário/IP por alguns minutos.
- Administradores veem a **última atividade** de cada usuário, podem desativar, excluir, trocar senha e **desconectar** (encerrar as sessões).
- Só administradores mudam as configurações (menus padrão, banco, usuários, login). Nunca fica sem pelo menos um admin ativo.

**Login Microsoft (Entra ID):** em **Login Microsoft (SAML)**, ligue "Entrar com Microsoft" e siga os passos da tela:
no portal Azure, *Entra ID › Aplicativos empresariais › Novo aplicativo › Criar seu próprio aplicativo › Logon único › SAML*,
use o **Identificador (Entity ID)** e a **URL de resposta (ACS)** mostrados (ou envie o `metadata.xml`), e cole de volta a
**URL de Logon** e o **Certificado (Base64)**. Opções: domínios permitidos, criar o usuário no 1º login (papel padrão) ou só
aceitar quem já está cadastrado (login = e-mail). Atrás de proxy/HTTPS, preencha o **endereço público** do app.
Usa a biblioteca `@node-saml/node-saml` (já na imagem do container; fora dele, `npm install`).

**Grupos do Microsoft Entra ID → papel:** em **Login e acesso › Grupos do Entra ID**, informe os IDs de objeto dos grupos
de **administradores** e de **usuários**. No portal Azure, adicione ao app uma *declaração de grupo* (grupos atribuídos ao
aplicativo, atributo *ID do grupo*). O papel é **recalculado a cada login Microsoft**; quem não está em nenhum grupo pode
ser barrado. **Sincronização periódica** (opcional): com um App Registration (client secret, permissões de aplicativo
`GroupMember.Read.All` e `User.Read.All`), o servidor consulta o Microsoft Graph a cada N horas, cria os usuários dos
grupos, ajusta papéis e desativa quem saiu. Usuários com senha local nunca são alterados; se os grupos voltarem vazios
(erro de configuração), nada é desativado. **🔌 Testar** mostra o nome de cada grupo.

### 🔒 Edição simultânea (bloqueio do book)
Em **⚙️ Configurações › Edição simultânea** (exige o login ligado):
- Quem abre um book que outra pessoa está editando vê **somente leitura**, com quem está editando, desde quando e a
  **última atividade** (ex.: "há 3 h"). A lista de books também mostra "🔒 Fulano editando".
- **Pedir para editar:** quem está com o book recebe um aviso para **liberar** ou **continuar editando**.
- Sem resposta no prazo (padrão **3 min**, configurável), quem pediu pode **assumir a edição**: o outro usuário é
  desconectado daquela sessão. O que ele digitou já estava salvo.
- Voltar para a lista de clientes, sair ou fechar a aba libera o book na hora; sem sinal do navegador por ~90 s, ele fica livre sozinho.
- O servidor recusa salvar (HTTP 423) um book que está com outra pessoa, mesmo vindo de uma aba antiga.

### 🔒 Segurança do servidor
- Requisições que alteram dados (POST/PUT/DELETE) vindas de outro site são bloqueadas (checagem de `Origin`).
- Cabeçalhos `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy` em todas as respostas.
- Só as pastas públicas (`html/`, `css/`, `js/`, `assets/`) são servidas; segredos de cloud e a senha do Mongo nunca vão ao navegador.
- Ctrl+C / `docker stop` encerram com calma: o servidor para de aceitar conexões e fecha o banco.

As configurações valem para os próximos books; os books já criados não mudam.

### 📈 Comparativo mensal
O bloco **Comparativo mensal** compara o book com outro mês do mesmo cliente e área (padrão: o mês anterior, por
exemplo 10/2026 → 11/2026):
- **Ativar comparativo neste book:** liga ou desliga. Desligado, o bloco não aparece no book.
- **Métricas automáticas:** quantidade de itens de cada planilha (VMs, discos, redes…), valores dos indicadores e
  totais do Zabbix. Escolha quais entram (**☑ Tudo / ☐ Nenhum / Só as que mudaram**).
- **Linhas manuais:** para números que não estão nas planilhas (ex.: custo).
- **Exibição:** gráfico (colunas, barras ou linha) com os dois meses lado a lado e tabela com a variação (▲ ▼ =).
- **Ocultar itens sem mudança** e **Não mostrar no book se nada mudou**, para os meses sem diferença.

Os números do outro mês ficam guardados no bloco; use **🔄 Atualizar dados** se aquele book mudar.

### Menu lateral e paleta recolhíveis
- **Menu lateral:** o botão `⇤` recolhe o menu e deixa só os ícones. Recolhido, um clique abre o menu completo por
  cima do editor; ao escolher uma seção ele volta aos ícones. Use `⇥` para fixar o menu expandido.
- **Blocos:** a paleta saiu da barra superior e fica à direita. O botão `⇥` / `⇤` alterna entre só ícones e expandida.
  Arrastar e clicar funcionam nos dois modos.
- A escolha fica salva no navegador.

### Menus e seções
- **＋ Novo menu** (rodapé da barra lateral) cria um grupo, por exemplo um cliente, uma cloud ou "Operações".
  Cada menu pode abrir um capítulo no book (página divisória) e ser ligado a um provedor de cloud.
- **＋ seção** dentro do menu cria uma nova página. Dê duplo-clique para renomear ou trocar o ícone.
- **Arraste** seções para reordenar ou mover entre menus, e arraste o cabeçalho do menu para reordenar menus.
- O botão `⋯` dá acesso a duplicar, ocultar do book, mover e excluir. Todas as exclusões podem ser desfeitas.

### Blocos (arrastar e soltar)
A paleta à direita tem **Título, Texto, Planilha, Imagem, Gráfico, Comparativo mensal, Indicadores, Relatório de capacidade, Destaque,
Divisor e Quebra de página**.
- **Gráfico:** colunas, barras, linha, pizza ou rosca. Os dados podem ser **manuais** (grade editável ou colados do
  Excel) ou **ligados a uma planilha do book**, agrupando por uma coluna e contando ou somando. Ligado, o gráfico
  se atualiza quando a planilha muda. Atalho: no menu `⋯` da planilha, use *Criar gráfico desta planilha*.
  As importações também podem gerar os gráficos de distribuição (SO, região e grupo) automaticamente.
- Arraste um bloco da paleta para a posição desejada, ou clique nele para adicionar no fim.
- Use a alça `⠿⠿` para reordenar. Soltar um bloco sobre uma seção da barra lateral move o bloco para lá.
- Imagens e planilhas podem ser soltas direto no canvas, e **Ctrl+V** de um print cria um bloco de imagem.
- Todos os blocos continuam editáveis depois de criados:
  - **Planilha:** cabeçalhos editáveis; o menu `▾` de cada coluna permite marcar como badge/status, ordenar, mover, inserir e remover. Enter desce para a próxima linha, e um bloco de células colado do Excel se espalha pela planilha. Também dá para arrastar linhas pelo `#`, filtrar, usar "Colar do Excel", importar arquivo e baixar como CSV.
  - **Texto:** negrito, itálico, listas, subtítulos e links.
  - O interruptor **"no book"** oculta um bloco sem apagá-lo.

### Importação de cloud (☁️ Importar cloud)
1. **Arquivo:** CSV, XLSX ou JSON. O provedor e o tipo de export são detectados automaticamente (RVTools incluso).
2. **Selecionar itens:** escolha o mapeamento (Servidores, Storage, Redes, Baseline ou Planilha original). Depois
   escolha **quais linhas** entram (**☑ Selecionar tudo / ☐ Nenhum**, filtro, marcar/desmarcar visíveis) e **quais colunas**
   (marcar, renomear, reordenar, badge).
3. **Destino:** uma seção existente ou nova. A planilha pode ser adicionada como nova, substituir a existente ou
   ter linhas acrescentadas. Também é possível gerar KPIs de resumo e separar em várias planilhas por coluna.

### Exportar
**⬇ Exportar ▾** tem **👁 Pré-visualizar**, **PDF**, **Word** e **HTML**. A pré-visualização fica só nesse menu. No diálogo de exportação, escolha as seções e
use **👁 Pré-visualizar** para ver exatamente o que vai sair; o botão *Exportar* da pré-visualização volta ao diálogo.
- **PDF:** abre a impressão do navegador. Use "Salvar como PDF" e marque *Gráficos de fundo*. O layout segue o book
  de referência: A4 sem margem (sem data e URL do navegador), capa compacta no topo da 1ª página, faixa roxa no
  topo de cada página e capítulos começando em página nova. As páginas seguintes têm respiro no topo (abaixo da faixa)
  e no rodapé, então o conteúdo não fica mais sob a faixa. As fontes são Poppins + Consolas, e Trispace nos divisores.
- **Word (.doc):** layout em tabelas com cores sólidas e imagens embutidas.
- **HTML:** arquivo único com o book.

## Estrutura

```
package.json               npm run dev / npm test (opcionais: driver do MongoDB e @node-saml/node-saml)
server/
  index.js                 servidor HTTP: arquivos do app + API REST
  html-include.js          monta o index.html com as partes de html/
  auth/                    index.js (usuários, senhas, sessões, SAML), locks.js (bloqueio de edição), graph.js (grupos do Entra ID)
  logs.js                  logs HTTP, banco, app e auditoria (data/logs)
  trash.js                 lixeira com GUIDs (restaurar, cópia, substituir, prazo)
  backup.js                backup/restauração (local, rede, FTP, OCI) e exclusão de banco
  storage/                 index.js (banco ativo + configurações), sqlite.js, mongo.js, common.js,
                           legacy-files.js (importa os dados antigos em arquivos)
  cloud/                   conectores: oci.js, aws.js, azure.js, gcp.js, zabbix.js, glpi.js, util.js
data/                      (criada ao rodar; fora do git) book-tecnico.sqlite, settings.json
Dockerfile, docker-compose.yml, .dockerignore   container do app + MongoDB
index.html                 esqueleto da página (marcadores @include)
html/                      partes da página: head, menu, header, editor, palette, preview, settings, layers, scripts
book-tecnico.html          versão montada (npm run build) para abrir sem servidor
assets/img/                logos e favicon
css/
  base/        variables.css (tema/cores), reset.css
  layout/      app-shell, sidebar, palette, panels (recolher menu/paleta), responsive
  components/  buttons, forms, modal, toast
  editor/      canvas, nav-screen, settings + um arquivo por tipo de bloco
  import/      import-wizard.css
  book/        book.css (visual do documento) e print.css (PDF)
js/
  core/        namespace, utils, charts (gráficos SVG), sanitize, events, persistence (IndexedDB), store (estado + operações),
               api (servidor ou navegador), url (?cliente&ano&mes&area), session (book aberto + cookie), zip
  data/        providers, badges, logo, default-template, templates (InfraCloud, Network, Backup)
  ui/          modal, toast, dropdown/menu de contexto, dnd (arrastar e soltar)
  blocks/      registry.js + um módulo por tipo de bloco (chart.js = gráficos, compare.js = comparativo mensal, monitor.js = Zabbix)
  import/      file-reader, detect, wizard, zip-import (revisão em lote), cloud-sync (conexões + API), mappers/
  book/        renderer (HTML do book), preview, book-styles (gerado)
  export/      export-dialog, pdf, word, html, project-file
  editor/      nav-screen (Clientes › Ano › Books), settings (⚙️), sidebar, palette, panels (recolher), cover-form, canvas, router
  app.js       inicialização
tools/build-book-styles.js, tools/build-html.js, tools/test-server.js, tools/test-edge.js, tools/test-front.js, tools/test-support/fake-mongodb.js
tools/exemplo-zip/   arquivos de exemplo para testar a importação por ZIP (todas as clouds)
```

### Customizar
- **Cores e fontes:** `css/base/variables.css`. O visual do documento fica em `css/book/book.css`.
  Depois de editar `css/book/*.css`, rode `node tools/build-book-styles.js` para atualizar o CSS embutido no export HTML.
- **Novo tipo de bloco:** crie `js/blocks/<tipo>.js` com `BT.blocks.register(...)` (o contrato está documentado
  em `js/blocks/registry.js`) e inclua o `<script>` em `html/scripts.html`. A paleta, o book e o Word passam a usá-lo automaticamente.
- **Novo mapeamento de import:** crie `js/import/mappers/<nome>.js` seguindo `servers.js` e inclua o `<script>` em `html/scripts.html`.
- **Novo template embutido:** adicione em `js/data/templates.js` (ou use *Salvar como template* no app).
- **Novo conector de cloud:** crie `server/cloud/<nome>.js` com `test()` e `pull()` e registre em `server/cloud/index.js`.

## Limitações conhecidas
- O container foi preparado (Dockerfile e compose), mas não foi construído aqui. O comando que ele roda foi testado direto no Node 22.
- O MongoDB foi testado com um driver simulado em memória (`npm test`); ainda não contra um MongoDB real.
- O SAML foi testado com respostas assinadas por um certificado de teste (simulando o Entra ID); ainda não contra um tenant real.
- A sincronização com o Microsoft Graph foi testada com respostas simuladas.
- Backup em pasta/caminho de rede foi testado; **FTP e bucket da OCI ainda não foram testados** contra servidores reais (use 🔌 Testar destino).
- O `docker-compose.yml` com usuário/senha do MongoDB não foi executado aqui (sem Docker nesta máquina).
- Os conectores de cloud foram testados só com respostas simuladas.
