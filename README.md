# Job Hunter

Aplicativo desktop em Electron para buscar estágios e vagas júnior em tecnologia e acompanhar candidaturas.

Veja o [histórico de mudanças](CHANGELOG.md) e as [versões publicadas](https://github.com/MatheusCorreaaa/job-hunter/releases).

## Executar pelo código-fonte

Com Node.js 22 ou mais recente, rode na pasta do projeto.

```sh
npm ci
npm start
```

Em **Meu perfil**, substitua o perfil de exemplo pelos seus dados. Em **Preferências do radar**, escolha áreas, cargos, níveis, modalidades e localidades. Use uma linha para cada localidade e indique separadamente de onde pode trabalhar em vagas remotas. Salve as preferências, abra **Radar de vagas** e clique em **Ativar busca real** ou **Buscar agora**.

O aplicativo combina consultas a portais com busca na web via Firecrawl e verifica a página original dos anúncios. As buscas automáticas rodam às **08h, 16h e 22h**, no horário de Brasília, enquanto o aplicativo está em execução. Você também pode usar **Importar link** para verificar um anúncio encontrado no Google ou no portal e usar a lixeira ao lado da vaga para removê-la do radar.

Em **Fontes e contas**, o radar mostra o estado da última consulta de cada portal e o motivo identificado em caso de falha ou verificação incompleta. Catho e 99jobs ficam em **Portais de candidatura** para acesso manual.

O navegador integrado abre o formulário do portal para envio manual. Em **Candidaturas**, é possível acompanhar as etapas, registrar respostas e devolver vagas ao radar. Em **Registro manual**, você também pode cadastrar candidaturas feitas antes de usar o app, com logo da empresa, cargo, portal, modalidade, localidade e datas. Perfil, currículo, sessões e registros manuais ficam no computador.

Use `npm run check` para verificar a sintaxe dos arquivos principais e `node --test` para testar o radar. O [guia da versão empacotada](release/LEIA-ME.md) descreve os atalhos da distribuição.

Ao empacotar para Windows, use `npm run brand:windows -- electron.exe "Job Hunter.exe"` na cópia extraída da distribuição oficial do Electron. O comando grava o ícone do Job Hunter no novo executável.

## Atualizações

Abra uma branch para cada atualização. No pull request, descreva o que mudou no aplicativo, por que mudou e como foi testado. Atualize o [histórico de mudanças](CHANGELOG.md) com o que a pessoa que usa o app precisa saber e publique as notas no GitHub Releases depois da integração à `main`.
