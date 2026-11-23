# Job Hunter

Aplicativo desktop em Electron para buscar estágios e vagas júnior em tecnologia e acompanhar candidaturas.

## Executar pelo código-fonte

Com Node.js 22 ou mais recente, rode na pasta do projeto.

```sh
npm ci
npm start
```

Em **Meu perfil**, substitua o perfil de exemplo pelos seus dados. Depois, abra **Radar de vagas** e clique em **Ativar busca real**.

O aplicativo consulta 14 portais e verifica a página original dos anúncios. As buscas automáticas rodam às **08h, 16h e 22h**, no horário de Brasília, enquanto o aplicativo está em execução. A cobertura inclui Rio de Janeiro, São Paulo capital para híbrido, remoto elegível no Brasil e oportunidades no exterior.

O navegador integrado abre o formulário do portal para envio manual. Em **Candidaturas**, é possível acompanhar as etapas, registrar respostas e devolver vagas ao radar. Perfil, currículo e sessões ficam no computador.

Use `npm run check` para verificar a sintaxe dos arquivos principais. O [guia da versão empacotada](release/LEIA-ME.md) descreve os atalhos da distribuição.

Ao empacotar para Windows, use `npm run brand:windows -- electron.exe "Job Hunter.exe"` na cópia extraída da distribuição oficial do Electron. O comando grava o ícone do Job Hunter no novo executável.
