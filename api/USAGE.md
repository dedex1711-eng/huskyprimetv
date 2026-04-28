# Como Usar o LicenseAuth no Web

## 🚀 Uso Básico

### 1. Importar o módulo
```html
<script src="api/licenseauth.js"></script>
```

### 2. Criar instância
```javascript
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",           // Nome da aplicação
  "Ob03SfvdAh",             // Owner ID
  "husky_xtream_dnsweb",    // Variable ID
  "1.0"                     // Versão
);
```

### 3. Inicializar
```javascript
const result = await licenseAuth.init();

if (result.success) {
  console.log("Servidores:", result.servers);
} else {
  console.error("Erro:", result.message);
}
```

## 📋 Métodos Disponíveis

### `init()`
Inicializa a conexão e busca os servidores DNS.

**Retorna:**
```javascript
{
  success: boolean,
  servers: string[],
  message: string
}
```

**Exemplo:**
```javascript
const result = await licenseAuth.init();
if (result.success) {
  console.log(`${result.servers.length} servidores encontrados`);
}
```

### `getServers()`
Retorna a lista de servidores DNS obtidos.

**Retorna:** `string[]`

**Exemplo:**
```javascript
const servers = licenseAuth.getServers();
servers.forEach(server => console.log(server));
```

### `getPrimaryServer()`
Retorna o primeiro servidor da lista.

**Retorna:** `string | null`

**Exemplo:**
```javascript
const primary = licenseAuth.getPrimaryServer();
if (primary) {
  console.log("Servidor principal:", primary);
}
```

### `getRandomServer()`
Retorna um servidor aleatório (útil para load balancing).

**Retorna:** `string | null`

**Exemplo:**
```javascript
const random = licenseAuth.getRandomServer();
if (random) {
  console.log("Servidor aleatório:", random);
}
```

## 💡 Exemplos Práticos

### Exemplo 1: Buscar e conectar
```javascript
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",
  "Ob03SfvdAh",
  "husky_xtream_dnsweb",
  "1.0"
);

const result = await licenseAuth.init();

if (result.success) {
  const servers = licenseAuth.getServers();
  
  for (const server of servers) {
    try {
      const response = await fetch(
        `${server}/player_api.php?username=user&password=pass`
      );
      
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

### Exemplo 2: Load balancing
```javascript
async function fetchFromServer(endpoint) {
  const licenseAuth = new LicenseAuthApp(
    "huskyplayweb",
    "Ob03SfvdAh",
    "husky_xtream_dnsweb",
    "1.0"
  );

  await licenseAuth.init();
  
  // Usa servidor aleatório para distribuir carga
  const server = licenseAuth.getRandomServer();
  
  if (!server) {
    throw new Error("Nenhum servidor disponível");
  }
  
  const response = await fetch(`${server}${endpoint}`);
  return response.json();
}

// Uso
const data = await fetchFromServer("/player_api.php?action=get_live_streams");
```

### Exemplo 3: Com fallback
```javascript
async function getServersWithFallback() {
  const licenseAuth = new LicenseAuthApp(
    "huskyplayweb",
    "Ob03SfvdAh",
    "husky_xtream_dnsweb",
    "1.0"
  );

  const result = await licenseAuth.init();
  
  if (result.success && result.servers.length > 0) {
    return result.servers;
  }
  
  // Fallback
  return [
    'http://fonteblack.sbs',
    'http://zeroum.blog:80',
    'http://pbkdiamond.site:80',
  ];
}

const servers = await getServersWithFallback();
```

### Exemplo 4: Cache de servidores
```javascript
class CachedLicenseAuth {
  constructor() {
    this.cache = null;
    this.cacheTime = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hora
  }

  async getServers() {
    // Verifica cache
    if (this.cache && Date.now() - this.cacheTime < this.cacheTTL) {
      console.log("Usando cache de servidores");
      return this.cache;
    }

    // Busca novos servidores
    const licenseAuth = new LicenseAuthApp(
      "huskyplayweb",
      "Ob03SfvdAh",
      "husky_xtream_dnsweb",
      "1.0"
    );

    const result = await licenseAuth.init();
    
    if (result.success) {
      this.cache = result.servers;
      this.cacheTime = Date.now();
      return this.cache;
    }

    return [];
  }
}

// Uso
const cached = new CachedLicenseAuth();
const servers = await cached.getServers();
```

## 🔍 Tratamento de Erros

### Erro: Falha ao obter sessionId
```javascript
const result = await licenseAuth.init();
if (!result.success && result.message.includes("sessionId")) {
  console.error("Problema com autenticação no LicenseAuth");
  // Usar fallback servers
}
```

### Erro: Nenhum servidor encontrado
```javascript
const result = await licenseAuth.init();
if (result.success && result.servers.length === 0) {
  console.warn("Nenhum servidor DNS encontrado");
  // Usar fallback servers
}
```

### Erro: Timeout
```javascript
try {
  const result = await Promise.race([
    licenseAuth.init(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Timeout")), 5000)
    )
  ]);
} catch (error) {
  console.error("Timeout ao buscar servidores:", error.message);
  // Usar fallback servers
}
```

## 📊 Monitoramento

### Logs no Console
```javascript
// Ativar logs detalhados
const licenseAuth = new LicenseAuthApp(...);
const result = await licenseAuth.init();

// Verificar logs
console.log("[LicenseAuth] Iniciando...");
console.log("[LicenseAuth] encKey gerada: ...");
console.log("[LicenseAuth] SessionId obtido: ...");
console.log("[LicenseAuth] DNS Servers encontrados: ...");
```

### Métricas
```javascript
const startTime = Date.now();
const result = await licenseAuth.init();
const duration = Date.now() - startTime;

console.log(`Tempo de resposta: ${duration}ms`);
console.log(`Servidores encontrados: ${result.servers.length}`);
```

## 🔐 Segurança

### ⚠️ Credenciais Públicas
As credenciais estão no código do cliente (visível no navegador).

**Recomendações:**
1. Considere usar um backend para fazer as requisições
2. Implemente rate limiting
3. Adicione validação de assinatura
4. Monitore uso anormal

### Exemplo: Backend Seguro
```javascript
// Frontend
async function getServersFromBackend() {
  const response = await fetch('/api/license-servers');
  return response.json();
}

// Backend (Node.js)
app.get('/api/license-servers', async (req, res) => {
  const licenseAuth = new LicenseAuthApp(...);
  const result = await licenseAuth.init();
  res.json(result);
});
```

## 🧪 Testando

### Teste Manual
1. Abra `test-licenseauth.html`
2. Clique em "Testar LicenseAuth"
3. Verifique os resultados

### Teste no Console
```javascript
// Copie e cole no console do navegador
const licenseAuth = new LicenseAuthApp(
  "huskyplayweb",
  "Ob03SfvdAh",
  "husky_xtream_dnsweb",
  "1.0"
);

const result = await licenseAuth.init();
console.log(result);
```

## 📞 Suporte

Se encontrar problemas:

1. **Verifique os logs** - Abra o console (F12) e procure por `[LicenseAuth]`
2. **Teste a página de teste** - `test-licenseauth.html`
3. **Verifique a conexão** - Teste a URL do LicenseAuth manualmente
4. **Use fallback** - Configure servidores fallback

## 📚 Referências

- [LicenseAuth API Documentation](https://licenseauth.help/api/)
- [README.md](README.md) - Documentação técnica
- [test-licenseauth.html](test-licenseauth.html) - Página de teste
