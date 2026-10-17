# ⚡ Eletric Offer Track

Acompanhe a quantidade de anúncios das suas ofertas, com atualização diária e gráfico de evolução.

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
