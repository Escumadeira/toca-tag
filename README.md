# TOCA tag

Chamada de presença por cartão NFC para faculdades e escolas. Roda no navegador, em computador e celular.

O aluno aproxima o cartão do leitor do professor e a presença aparece na tela com foto e nome. A secretaria acompanha por relatórios e o aluno vê a própria frequência.

## O que tem

- **Professor:** abre a chamada, lê os cartões (leitor USB, NFC do celular Android, QR code ou código digitado), marca presença manual e ajusta aulas encerradas.
- **Aluno:** cartão digital com QR code, frequência por matéria e por período, saldo de horas e o histórico de alterações feitas no registro dele.
- **Secretaria:** alunos, cursos, turmas, professores, relatórios com filtros, correção de horários, justificativas de falta com anexo e assinatura, permissões por funcionário e registro de tudo o que é feito.
- **Administrador:** cadastra as instituições. Cada uma só vê os próprios dados.

## Como rodar

Precisa do Node.js 22.5 ou mais novo. Não há dependências para instalar.

```
node server.js
```

No Windows, basta abrir o `iniciar.bat`. Na primeira vez, abra `/app.html` e crie a conta de administrador.

Para publicar em um domínio pelo túnel da Cloudflare, coloque o token em `tunel-token.txt` e use o `iniciar cloudflare.bat`.

## Estrutura

| Arquivo | O que é |
| --- | --- |
| `server.js` | Servidor HTTP e API |
| `banco.js` | Banco de dados SQLite (embutido no Node.js) e cópias de segurança |
| `public/app.html` | O aplicativo, em uma única página |
| `public/index.html` | Site de apresentação |
| `email.js`, `email/` | Envio do código de recuperação de senha |
| `carteira.js`, `carteira/` | Cartão na Carteira da Apple e do Google |
| `dados/` | Criada ao rodar: banco, cópias de segurança e registros. Não vai para o Git. |

## O que não vai para o repositório

O `.gitignore` deixa de fora a pasta `dados/`, o `tunel-token.txt`, o `email/config.json` e os certificados da Carteira. Para configurar e-mail e Carteira, copie os arquivos `config.exemplo.json` para `config.json` e preencha.

## Tecnologia

JavaScript com Node.js no servidor, sem bibliotecas externas além do `lib/forge.cjs` (usado só na Carteira da Apple). HTML, CSS e JavaScript puro na interface.
