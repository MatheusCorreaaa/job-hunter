# Job Hunter

Radar desktop de estágios e vagas júnior em tecnologia.

## Personalizar o radar

Em **Meu perfil → Preferências do radar**, escolha áreas, cargos, níveis e modalidades. Cadastre uma cidade ou um país por linha para vagas presenciais e híbridas. Para vagas remotas, informe de onde você pode trabalhar. O curso é opcional e pode ser usado como termo de busca. As competências ajudam a ordenar os resultados.

Em **Radar de vagas → Importar link**, cole a URL de um anúncio ou um link de resultado do Google que aponte para ele. O radar tenta confirmar a página original, a data e a candidatura. A busca web via Firecrawl também pode encontrar vagas dos portais por palavras-chave. A lixeira remove a vaga do radar e evita que o mesmo anúncio volte em outra busca.

## Abrir no computador

Extraia todo o ZIP para uma pasta.

- **Windows 64 bits ou ARM64** — abra **Abrir Job Hunter.cmd**.
- **macOS Intel ou Apple Silicon e Linux x64** — execute `bash "Abrir Job Hunter.sh"` no Terminal, na pasta extraída. No Linux, o Electron usa o sandbox de namespaces do sistema.

A primeira abertura baixa o Electron da distribuição oficial e confere o SHA‑256. As próximas usam o runtime baixado. O app vem pronto para executar, sem instalar Node.js nem rodar npm.

Ao atualizar, encerre a versão anterior em **Sair do Job Hunter** na bandeja do sistema e abra o executável na pasta da nova versão. O número da versão aparece no topo do aplicativo.

## Ligar o radar

A tela inicial contém vagas fictícias para explorar a interface. Clique em **Ativar busca real** para consultar Gupy, Jobbol, LinkedIn, Indeed, RioVagas, Vagas.com, Super Estágios, Empregos.com.br, Infojobs, Sólides Vagas, Glassdoor e Jooble. O Firecrawl usa a opção pública sem chave de API. Quando o Firecrawl chega ao limite temporário, o radar continua com as consultas diretas aos portais. Em **Fontes e contas**, você pode escolher os portais e ver o estado da última busca. Catho e 99jobs estão disponíveis em **Portais de candidatura** para acesso manual.

**Fontes e contas** também mostra o motivo de uma consulta parcial ou indisponível, quando identificado. Por exemplo, HTTP 403 indica que a fonte recusou o acesso, e HTTP 429 indica limite de requisições. A disponibilidade da busca pública depende de cada portal.

As três buscas diárias rodam às **08h, 16h e 22h**, no horário de Brasília. Em **Configurações**, veja as rodadas executadas no dia e a próxima busca. O app precisa estar em execução e o computador precisa estar ligado e conectado. Quando a bandeja do sistema estiver disponível, fechar a janela mantém o radar em execução. Use **Sair do Job Hunter** na bandeja para encerrar o processo. Você também pode iniciar uma busca pelo radar.

A busca limita a lista a publicações dos últimos 30 dias. A busca usa as localidades e modalidades salvas nas preferências. Perfis que ainda usam a configuração inicial seguem a cobertura de exemplo. Quando a vaga no exterior publica condições de autorização de trabalho ou visto, o app as exibe no detalhe. A fonte original e um caminho de candidatura em aberto são necessários para incluir a vaga. Páginas sem informação suficiente ficam fora da lista. O radar guarda o histórico de anúncios verificados no computador e só gera avisos para novas correspondências ou uma interrupção persistente da busca.

A lista abre com até 30 vagas por vez. Use **Mostrar mais vagas** para continuar. A busca por cargo, empresa ou tecnologia considera a lista inteira.

## Aparência

Use a lua ou o sol no topo da janela para alternar o tema. Em **Configurações**, também é possível seguir a aparência do sistema.

## Candidatar-se

Em **Meu perfil**, confira as informações de formação e experiência e selecione seu currículo em PDF. Em **Fontes e contas**, abra um dos portais e entre diretamente no portal. O navegador integrado guarda as sessões neste computador. A busca roda em fontes públicas e separadas dessas sessões.

Ao clicar em **Abrir candidatura**, o formulário abre na janela do Job Hunter e a vaga passa do **Radar de vagas** para **Candidaturas**, com a etapa **Em preenchimento**. Use os recursos do portal, anexe o currículo quando for necessário e faça o envio manualmente. Depois, clique em **Marcar como enviada**. Se já tiver se candidatado, use o ícone de prancheta com visto ao lado da vaga no radar.

Em **Candidaturas**, atualize a etapa, registre respostas ou notas e clique em **Salvar acompanhamento**. Use **Devolver ao radar** se quiser tirar a vaga do acompanhamento. A disponibilidade de login dentro da janela depende do portal. O app usa o perfil local para calcular aderência, e cada portal mantém o próprio cadastro.

Para acompanhar uma vaga para a qual você já enviou currículo por fora do aplicativo, abra **Candidaturas → Registro manual**. Informe empresa e cargo. Você também pode escolher uma logo da empresa em PNG ou JPG, indicar o tipo de vaga, o portal, a localidade, a modalidade e as datas de publicação e envio. O aplicativo identifica portais conhecidos pelo link da vaga ou pela sua seleção. A imagem fica salva no computador com o registro.

Preencha os requisitos obrigatórios, os diferenciais e a descrição em campos próprios. Depois de salvar, o registro abre em **Candidaturas → Vagas do radar**, com o link para reabrir a candidatura, o painel de acompanhamento e o botão **Editar registro**. Nas vagas de estágio e júnior com informações suficientes, o painel também mostra uma estimativa de aderência ao perfil.

## Código

A pasta **codigo-fonte** contém os arquivos do projeto. Para executar a versão editável, use `npm ci` e `npm start` nessa pasta. A versão distribuída em **app** já inclui as dependências necessárias.
