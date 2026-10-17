# ⚡ Eletric Offer Track

Acompanhe a quantidade de anúncios das suas ofertas, com atualização diária e gráfico de evolução. Classifique por **Info ou Drop**, **nicho** e **TSL, VSL, QUIZ ou QUIZ + VSL**. Use **Editar** para completar ou alterar a classificação. Cada oferta também mostra os dias desde o início dos anúncios observados e uma **nota de triagem de 0 a 10**, com critérios em **Ver análise**.

## Colocar na Vercel

1. Na **Vercel**, clique em **Add New → Project** e importe este repositório.
2. Crie um banco no [Turso](https://turso.tech/) e copie a URL e o token.
3. Em **Environment Variables**, adicione:

| Nome | O que colocar |
| --- | --- |
| `TURSO_DATABASE_URL` | URL do banco Turso |
| `TURSO_AUTH_TOKEN` | Token do banco Turso |

4. Clique em **Deploy**. O projeto já tem a configuração da Vercel; use Node.js 24 e Fluid Compute com duração de função de 300 segundos.

O app abre diretamente, sem login ou senha. Só essas duas variáveis do Turso são necessárias. Guarde o token na Vercel, nunca no GitHub ou no chat.

**Atualização diária:** por volta das 9h de Fortaleza (no plano Hobby, entre 9h e 10h). Até 10 ofertas. A primeira consulta inicia o histórico; o gráfico cresce com as próximas coletas e preserva dias sem dados como lacunas. A contagem pode ser aproximada e segue a página e os filtros do link da Meta.

**Já tem histórico local?** Com o Turso vazio e suas credenciais em um `.env` local, execute `npm run db:import`. O banco local não é enviado no deploy. A coleta já foi validada neste ambiente; é necessário conferir a primeira atualização depois da publicação na Vercel.

## Rodar no computador

Node.js 24 e Chromium instalados: `npm ci`, depois `npm start`. Para verificar: `npm test` e `npm run build`.

**Nota de modelagem:** considera idade dos anúncios, proporção com 14+ dias, volume e evolução semanal. Os pesos e pontos aparecem em **Ver análise**. A amostra tem até 40 anúncios ativos carregados; faltando histórico semanal ou com menos de 5 anúncios, a nota é provisória. Dados ausentes ou desatualizados ficam sem avaliação.

As idades usam o início informado pela Meta e a data da coleta; pausas não são conhecidas. A nota prioriza pesquisa e não comprova vendas, lucro ou retorno. Após atualizar a versão, clique em **Atualizar** para coletar as datas das ofertas existentes. A migração preserva o histórico.
