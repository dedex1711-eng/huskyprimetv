# LicenseAuth DNS Resolver

Este módulo implementa a integração com o LicenseAuth para buscar dinamicamente os servidores DNS do HuskyPlay.
Usa a mesma lógica do aplicativo Android.

## Arquivos

- **licenseauth.js** - Classe `LicenseAuthApp` que gerencia a comunicação com o LicenseAuth
- **proxy.js** - Proxy para contornar CORS (já existente)

## Como Funciona

### 1. Inicialização

```javascript
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",           // Nome da aplicação
  "Ob03SfvdAh",             // Owner ID
  "husky_xtream_dnsweb",    // Variable ID
  "1.0"                     // Versão
);

const result = await licenseAuth.init();
if (result.success) {
  console.log("Servidores:", result.servers);
}
```

### 2. Fluxo de Autenticação

1. **Requisição `init`**: Gera uma chave de encriptação aleatória e obtém um `sessionId` do LicenseAuth
   - Parâmetros: `type`, `ver`, `hash`, `enckey`, `name`, `ownerid`
2. **Requisição `var`**: Usa o `sessionId` para obter a variável `husky_xtream_dnsweb`
   - Parâmetros: `type`, `varid`, `sessionid`, `name`, `ownerid`
3. **Parse de URLs**: Extrai as URLs dos servidores da resposta usando regex

### 3. Métodos Disponíveis

#### `init()`
Inicializa a conexão e busca os servidores DNS.

**Retorna:**
```javascript
{
  success: boolean,
  servers: string[],
  message: string
}
```

#### `getServers()`
Retorna a lista de servidores DNS obtidos.

```javascript
const servers = licenseAuth.getServers();
// ["http://servidor1.com", "http://servidor2.com", ...]
```

#### `getPrimaryServer()`
Retorna o primeiro servidor da lista.

```javascript
const primary = licenseAuth.getPrimaryServer();
// "http://servidor1.com"
```

#### `getRandomServer()`
Retorna um servidor aleatório (útil para load balancing).

```javascript
const random = licenseAuth.getRandomServer();
// "http://servidorX.com"
```

## Integração no Login

O arquivo `index.html` foi atualizado para:

1. **Carregar o módulo LicenseAuth**
   ```html
   <script src="api/licenseauth.js"></script>
   ```

2. **Buscar servidores dinamicamente no login**
   ```javascript
   const licenseServers = await fetchServersFromLicenseAuth();
   const serversToTry = licenseServers.length > 0 ? licenseServers : FALLBACK_SERVERS;
   ```

3. **Usar fallback se LicenseAuth falhar**
   - Se a requisição ao LicenseAuth falhar, usa a lista `FALLBACK_SERVERS`
   - Garante que o app sempre funcione mesmo sem acesso ao LicenseAuth

## Fluxo de Login Atualizado

```
┌─────────────────────────────────────────┐
│ Usuário clica em "Entrar"               │
└──────────────────┬──────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Buscar DNS do        │
        │ LicenseAuth          │
        └──────────┬───────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
    ✓ Sucesso          ✗ Falha
        │                     │
        ▼                     ▼
   Usar DNS do      Usar FALLBACK
   LicenseAuth      SERVERS
        │                     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Tentar conectar em   │
        │ cada servidor até    │
        │ conseguir autenticar │
        └──────────────────────┘
```

## Credenciais

As credenciais do LicenseAuth estão configuradas em `index.html`:

```javascript
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",           // appName
  "Ob03SfvdAh",             // ownerId
  "husky_xtream_dnsweb",    // varId
  "1.0"                     // version
);
```

**Nota:** Estas credenciais são públicas no código do cliente, assim como no aplicativo Android. Para maior segurança, considere:
- Usar um backend para fazer as requisições ao LicenseAuth
- Implementar rate limiting
- Adicionar validação de assinatura

## Tratamento de Erros

O módulo trata os seguintes erros:

1. **Falha ao obter sessionId**
   - Retorna `success: false`
   - Usa `FALLBACK_SERVERS`

2. **Falha ao obter DNS**
   - Retorna `success: false`
   - Usa `FALLBACK_SERVERS`

3. **Erro de rede**
   - Capturado e logado
   - Usa `FALLBACK_SERVERS`

## Logs

O módulo registra informações úteis no console:

```
[LicenseAuth] Iniciando...
[LicenseAuth] SessionId obtido: abc123...
[LicenseAuth] DNS Servers encontrados: ["http://...", "http://..."]
[Login] Servidores obtidos do LicenseAuth: [...]
[Login] Usando 5 servidores (license=5)
```

## Exemplo Completo

```javascript
// 1. Criar instância
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",
  "Ob03SfvdAh",
  "husky_xtream_dnsweb",
  "1.0"
);

// 2. Inicializar
const result = await licenseAuth.init();

if (result.success) {
  // 3. Usar servidores
  const servers = licenseAuth.getServers();
  console.log(`${servers.length} servidores disponíveis`);
  
  // 4. Tentar conectar
  for (const server of servers) {
    try {
      const response = await fetch(`${server}/player_api.php?...`);
      if (response.ok) {
        console.log(`Conectado em: ${server}`);
        break;
      }
    } catch (error) {
      console.error(`Falha em ${server}:`, error.message);
    }
  }
} else {
  console.error("Erro ao buscar servidores:", result.message);
}
```

## Compatibilidade

- ✅ Navegadores modernos (Chrome, Firefox, Safari, Edge)
- ✅ Electron
- ✅ Node.js (com polyfill de fetch)
- ✅ Suporta CORS via proxy Cloudflare Workers

## Referências

- [LicenseAuth API Documentation](https://licenseauth.help/api/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
