# Sistalvo — Agendamento com Firebase, Firestore e Painel Admin

Sistema para agendamento de formatação, backup e otimização de computador a domicílio.

O cliente escolhe os serviços, informa data/horário, o sistema gera uma ordem de serviço com ID único e abre o WhatsApp com uma mensagem profissional pronta. O administrador acessa uma rota protegida, visualiza as ordens e marca atendimentos como concluídos.

---

## Funcionalidades

- Site público para agendamento.
- Seleção de serviços:
  - Formatação completa — R$50
  - Backup de arquivos — R$15
  - Otimização do sistema — R$25
- Cálculo automático do valor total.
- Agenda com horários pré-definidos:
  - 09:00
  - 11:00
  - 13:00
  - 15:00
  - 17:00
- Limite de 5 atendimentos por dia.
- Intervalo mínimo de 2 horas entre atendimentos.
- Último horário iniciando às 17:00, respeitando limite máximo até 19:00.
- Criação automática de ordem de serviço no Firestore.
- ID de pedido no formato `OS-AAAAMMDD-XXXXXX`.
- Mensagem formatada para WhatsApp usando negrito, tópicos e resumo profissional.
- Consulta pública de pedido pelo ID.
- Painel administrativo em `/admin`.
- Rota de criação/ativação do admin em `/admin/setup`.
- Login admin com Google ou e-mail/senha.
- Verificação de e-mail para conta criada por e-mail/senha.
- Setagem de admin com:
  - Firebase Custom Claim: `admin: true`
  - Documento no Firestore: `admins/{uid}` com `isAdmin: true`
- Administração das ordens de serviço.
- Marcação de pedido como concluído ou reabertura.

---

## Stack usada

- Next.js
- React
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Admin SDK
- Vercel

---

## Estrutura do projeto

```txt
pc-agendamento-firebase/
├─ firestore.rules
├─ package.json
├─ README.md
├─ .env.example
├─ src/
│  ├─ app/
│  │  ├─ page.tsx
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  ├─ consulta/
│  │  │  └─ page.tsx
│  │  ├─ admin/
│  │  │  ├─ page.tsx
│  │  │  └─ setup/
│  │  │     └─ page.tsx
│  │  └─ api/
│  │     ├─ availability/
│  │     │  └─ route.ts
│  │     ├─ orders/
│  │     │  ├─ route.ts
│  │     │  └─ status/
│  │     │     └─ route.ts
│  │     └─ admin/
│  │        ├─ bootstrap/
│  │        │  └─ route.ts
│  │        └─ orders/
│  │           ├─ route.ts
│  │           └─ [orderId]/
│  │              └─ route.ts
│  └─ lib/
│     ├─ adminGuard.ts
│     ├─ catalog.ts
│     ├─ firebaseAdmin.ts
│     ├─ firebaseClient.ts
│     └─ orders.ts
```

---

## Como rodar localmente

### 1. Instale as dependências

```bash
npm install
```

### 2. Crie o arquivo `.env.local`

Copie o arquivo de exemplo:

```bash
cp .env.example .env.local
```

Depois preencha os valores.

```env
NEXT_PUBLIC_FIREBASE_API_KEY=""
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=""
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=""
NEXT_PUBLIC_FIREBASE_APP_ID=""

NEXT_PUBLIC_WHATSAPP_NUMBER="5583987637335"

FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nSUA_CHAVE_AQUI\n-----END PRIVATE KEY-----\n"

OWNER_ADMIN_EMAIL="seuemail@gmail.com"
```

### 3. Rode o projeto

```bash
npm run dev
```

Abra no navegador:

```txt
http://localhost:3000
```

---

## Como configurar o Firebase

### 1. Criar projeto

1. Acesse o Firebase Console.
2. Crie um novo projeto.
3. Adicione um aplicativo Web.
4. Copie as credenciais do Firebase Client SDK para o `.env.local`.

As variáveis que você precisa copiar são:

```env
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

### 2. Ativar Authentication

No Firebase Console:

1. Abra **Authentication**.
2. Vá em **Sign-in method**.
3. Ative **Email/Password**.
4. Ative **Google**.

### 3. Criar o Firestore

1. Abra **Firestore Database**.
2. Crie o banco em modo produção.
3. Publique as rules do arquivo `firestore.rules`.

As rules do projeto bloqueiam acesso direto do cliente ao Firestore:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Isso é intencional. O site usa API Routes do Next.js com Firebase Admin SDK, então as operações sensíveis passam pelo servidor.

### 4. Gerar chave do Firebase Admin SDK

1. Firebase Console.
2. Project settings.
3. Service accounts.
4. Generate new private key.
5. Copie os dados para:

```env
FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""
```

A chave privada precisa manter `\n` nas quebras de linha quando for colocada no `.env.local` ou na Vercel.

---

## Como criar o admin

### Fluxo recomendado

1. Configure `OWNER_ADMIN_EMAIL` no `.env.local` com o seu e-mail.
2. Rode o projeto.
3. Acesse:

```txt
http://localhost:3000/admin/setup
```

4. Crie a conta com o mesmo e-mail configurado em `OWNER_ADMIN_EMAIL`.
5. O Firebase enviará uma verificação para seu e-mail.
6. Abra o e-mail e confirme.
7. Volte para `/admin/setup`.
8. Faça login.
9. Clique em **Ativar admin**.

Depois disso, o sistema grava no Firestore:

```txt
admins/{uid}
```

Com dados parecidos com:

```json
{
  "uid": "UID_DO_USUARIO",
  "email": "seuemail@gmail.com",
  "isAdmin": true
}
```

E também seta no Firebase Auth:

```json
{
  "admin": true
}
```

Esse claim é usado para proteger as rotas administrativas.

---

## Rotas do site

### Site público

```txt
/
```

Página de agendamento.

### Consulta de pedido

```txt
/consulta
```

O cliente informa o ID do pedido e vê o status.

### Painel admin

```txt
/admin
```

Lista ordens de serviço, status, dados do cliente, serviços e permite marcar como concluído.

### Configuração do admin

```txt
/admin/setup
```

Cria a conta, envia verificação de e-mail e ativa o admin.

---

## Como funciona a agenda

Os horários ficam definidos em:

```txt
src/lib/catalog.ts
```

```ts
export const SCHEDULE_SLOTS = ["09:00", "11:00", "13:00", "15:00", "17:00"] as const;
export const DAILY_LIMIT = 5;
```

Quando o cliente cria um pedido, o sistema cria/atualiza um documento:

```txt
availability/{AAAA-MM-DD}
```

Exemplo:

```json
{
  "date": "2026-05-07",
  "bookedCount": 2,
  "slots": {
    "09:00": "OS-20260507-ABC123",
    "11:00": "OS-20260507-Z9K7P2"
  }
}
```

Se o dia já tiver 5 pedidos, o sistema bloqueia novos agendamentos naquele dia.

Se o horário já estiver ocupado, o sistema bloqueia aquele horário.

---

## Como a mensagem do WhatsApp fica

O site monta uma mensagem parecida com esta:

```txt
*Novo pedido de atendimento a domicílio*

*ID do pedido:* OS-20260507-ABC123

*Serviços selecionados:*
• Formatação completa — R$50,00
• Backup de arquivos — R$15,00

*Total estimado:* R$65,00

*Agendamento:*
• Data: 07/05/2026
• Horário: 09:00

*Dados do cliente:*
• Nome: João Silva
• WhatsApp: (83) 99999-9999
• Cidade/Bairro: Patos - Centro
• Equipamento: Computador de mesa
• Observação: PC lento e travando

Pode confirmar a disponibilidade desse atendimento?
```

O WhatsApp interpreta `*texto*` como negrito, deixando a mensagem mais organizada.

---

## Como subir para o GitHub

### 1. Inicie o repositório local

Se ainda não tiver iniciado o Git na pasta do projeto:

```bash
git init
```

### 2. Adicione os arquivos e crie o primeiro commit

```bash
git add .
git commit -m "primeira versão do sistema de agendamento"
```

### 3. Defina a branch principal como `main`

```bash
git branch -M main
```

### 4. Conecte com o repositório do GitHub

Crie um repositório novo no GitHub e depois rode:

```bash
git remote add origin URL_DO_SEU_REPOSITORIO
```

Exemplo:

```bash
git remote add origin https://github.com/seuusuario/pc-agendamento-firebase.git
```

### 5. Envie o projeto para o GitHub

```bash
git push -u origin main
```

### 6. Para atualizações futuras

Depois da primeira vez, sempre que fizer mudanças:

```bash
git add .
git commit -m "descreva aqui a alteração feita"
git push
```

---

## Como hospedar na Vercel

### 1. Importe na Vercel

1. Acesse a Vercel.
2. Clique em **Add New Project**.
3. Selecione o repositório.
4. Framework detectado: **Next.js**.
5. Configure as variáveis de ambiente.
6. Clique em **Deploy**.

### 2. Variáveis na Vercel

Cadastre as mesmas variáveis do `.env.local`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_WHATSAPP_NUMBER
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
OWNER_ADMIN_EMAIL
```

Depois de alterar variáveis na Vercel, faça um novo deploy.

---

## Checklist final antes de divulgar

- [ ] Firebase Authentication com Email/Password ativado.
- [ ] Firebase Authentication com Google ativado.
- [ ] Firestore criado.
- [ ] `firestore.rules` publicado.
- [ ] `.env.local` preenchido.
- [ ] `OWNER_ADMIN_EMAIL` definido com seu e-mail real.
- [ ] Conta admin criada e e-mail verificado.
- [ ] Botão **Ativar admin** executado com sucesso.
- [ ] Pedido de teste criado.
- [ ] WhatsApp abrindo com a mensagem correta.
- [ ] Pedido aparecendo no painel `/admin`.
- [ ] Pedido marcando como concluído.
- [ ] Deploy feito na Vercel.

---

## Observações de design

O layout foi pensado para não ficar com cara de template genérico:

- Poucas cores principais.
- Fundo escuro discreto.
- Cards com bastante respiro.
- Tipografia forte, mas sem exagero.
- Poucos efeitos visuais.
- Fluxo direto: escolher serviço, data, horário e enviar.
- Admin limpo, com tabela simples e ações óbvias.

Se quiser personalizar mais, comece por:

```txt
src/app/globals.css
```

Principais variáveis:

```css
:root {
  --bg: #08111f;
  --primary: #55c7ff;
  --primary-strong: #78f0d4;
}
```

---

## Observação importante de segurança

Não é seguro deixar qualquer pessoa criar uma conta e marcar `isAdmin: true` diretamente pelo navegador.

Por isso, este projeto faz a ativação pelo servidor:

1. O usuário faz login.
2. A API valida se o e-mail é igual a `OWNER_ADMIN_EMAIL`.
3. A API confirma se o e-mail foi verificado.
4. A API grava `isAdmin: true` no Firestore.
5. A API seta o custom claim `admin: true` no Firebase Auth.

Assim, mesmo que alguém acesse `/admin/setup`, não conseguirá virar administrador sem usar o e-mail definido por você.
