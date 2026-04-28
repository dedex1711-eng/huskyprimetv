/**
 * LicenseAuth DNS Resolver
 * Busca dinamicamente os servidores DNS do LicenseAuth
 * Usa a mesma lógica do aplicativo Android
 */

class LicenseAuthApp {
  constructor(appName, ownerId, secretOrVarId, version = "1.0") {
    this.appName = appName;
    this.ownerId = ownerId;
    // Aceita tanto secret quanto varId
    this.varId = secretOrVarId;
    this.version = version;
    this.sessionId = null;
    this.dnsServers = [];
    this.initialized = false;
    this.baseUrl = "https://licenseauth.help/api/1.3/";
  }

  /**
   * Inicializa a conexão com LicenseAuth
   * Usa a mesma lógica do aplicativo Android
   */
  async init() {
    try {
      console.log("[LicenseAuth] Iniciando...");
      
      // Gera uma chave de encriptação aleatória (16 caracteres)
      const encKey = this.generateEncKey();
      console.log("[LicenseAuth] encKey gerada:", encKey);

      // Step 1: Init - Obter sessionId
      const initResponse = await this.request("init", {
        type: "init",
        ver: this.version,
        hash: "0",
        enckey: encKey,
        name: this.appName,
        ownerid: this.ownerId,
      });

      if (!initResponse) {
        throw new Error("Falha ao obter resposta do init");
      }

      console.log("[LicenseAuth] initResponse completa:", initResponse);

      // Extrai sessionId - tenta como objeto primeiro, depois como string
      let sessionId = null;
      if (typeof initResponse === 'object' && initResponse.sessionid) {
        sessionId = initResponse.sessionid;
      } else {
        const initStr = typeof initResponse === 'string' ? initResponse : JSON.stringify(initResponse);
        sessionId = this.extractJsonString(initStr, "sessionid");
      }
      
      console.log("[LicenseAuth] SessionId obtido:", sessionId);
      if (!sessionId) {
        throw new Error("Falha ao obter sessionId do LicenseAuth");
      }

      this.sessionId = sessionId;

      // Step 2: Var - Obter variável específica (husky_xtream_dnsweb)
      const varResponse = await this.request("var", {
        type: "var",
        varid: this.varId,
        sessionid: this.sessionId,
        name: this.appName,
        ownerid: this.ownerId,
      });

      if (!varResponse) {
        throw new Error("Falha ao obter resposta do var");
      }

      console.log("[LicenseAuth] varResponse completa:", varResponse);

      // Extrai message - tenta como objeto primeiro, depois como string
      let raw = null;
      if (typeof varResponse === 'object' && varResponse.message) {
        raw = varResponse.message;
      } else {
        const varStr = typeof varResponse === 'string' ? varResponse : JSON.stringify(varResponse);
        raw = this.extractJsonString(varStr, "message");
      }
      
      console.log("[LicenseAuth] raw message:", raw);
      
      if (!raw) {
        throw new Error(`Falha ao obter DNS do LicenseAuth (${this.varId})`);
      }

      // Parse URLs da mensagem
      this.dnsServers = this.parseUrls(raw);
      console.log("[LicenseAuth] DNS Servers encontrados:", this.dnsServers);

      if (this.dnsServers.length === 0) {
        throw new Error(`Nenhum servidor DNS encontrado na variável ${this.varId}`);
      }

      this.initialized = true;
      return {
        success: true,
        servers: this.dnsServers,
        message: `${this.dnsServers.length} servidores DNS obtidos com sucesso`,
      };
    } catch (error) {
      console.error("[LicenseAuth] Erro na inicialização:", error.message);
      return {
        success: false,
        servers: [],
        message: error.message,
      };
    }
  }

  /**
   * Gera uma chave de encriptação aleatória (16 caracteres)
   * Simula UUID.randomUUID().toString().replace("-", "").substring(0, 16)
   */
  generateEncKey() {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Faz uma requisição POST para o LicenseAuth
   */
  async request(type, data) {
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        formData.append(key, value);
      });

      console.log(`[LicenseAuth] Enviando ${type}:`, Object.fromEntries(formData));

      const response = await fetch(this.baseUrl, {
        method: "POST",
        body: formData,
        headers: {
          "User-Agent": "HuskyPlay/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      console.log(`[LicenseAuth] Response text (${type}):`, text);

      // Tenta parsear como JSON
      try {
        const json = JSON.parse(text);
        console.log(`[LicenseAuth] Response JSON (${type}):`, json);
        return json;
      } catch {
        // Se não for JSON, tenta extrair valores
        console.log(`[LicenseAuth] Response não é JSON, parseando como texto...`);
        return this.parseResponse(text);
      }
    } catch (error) {
      console.error(`[LicenseAuth] Erro na requisição (${type}):`, error.message);
      throw error;
    }
  }

  /**
   * Extrai string de uma resposta JSON
   * Usa a mesma regex do Android: /"key"\s*:\s*"([^"]*?)"/
   */
  extractJsonString(json, key) {
    // Tenta diferentes formatos de resposta
    
    // Formato 1: JSON puro com aspas duplas
    let regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*?)"`, 'i');
    let match = json.match(regex);
    if (match) {
      console.log(`[LicenseAuth] extractJsonString (${key}) - Formato JSON:`, match[1]);
      return match[1];
    }

    // Formato 2: key=value (sem aspas)
    regex = new RegExp(`${key}\\s*=\\s*([^\\n\\r]*)`);
    match = json.match(regex);
    if (match) {
      console.log(`[LicenseAuth] extractJsonString (${key}) - Formato key=value:`, match[1]);
      return match[1].trim();
    }

    // Formato 3: JSON com aspas simples
    regex = new RegExp(`'${key}'\\s*:\\s*'([^']*?)'`, 'i');
    match = json.match(regex);
    if (match) {
      console.log(`[LicenseAuth] extractJsonString (${key}) - Formato JSON simples:`, match[1]);
      return match[1];
    }

    console.log(`[LicenseAuth] extractJsonString (${key}) - Não encontrado`);
    return null;
  }

  /**
   * Parseia resposta em formato texto
   */
  parseResponse(text) {
    const result = {};
    const lines = text.split("\n");
    
    lines.forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        result[key.trim()] = valueParts.join("=").trim();
      }
    });

    return result;
  }

  /**
   * Extrai URLs da mensagem do LicenseAuth
   * Usa a mesma regex do Android
   */
  parseUrls(message) {
    if (!message) {
      console.log("[LicenseAuth] parseUrls: message vazia");
      return [];
    }

    console.log("[LicenseAuth] parseUrls input:", message);

    // Split por espaço e processa cada item
    const items = message.trim().split(/\s+/);
    console.log("[LicenseAuth] parseUrls items:", items);

    // Remove duplicatas e URLs inválidas
    const servers = [...new Set(items)]
      .filter((url) => {
        // Valida se é uma URL válida
        if (!url || url.length === 0) return false;
        
        try {
          // Se não tem protocolo, adiciona http://
          const fullUrl = url.startsWith("http") ? url : `http://${url}`;
          new URL(fullUrl);
          return true;
        } catch (e) {
          console.log("[LicenseAuth] URL inválida:", url, e.message);
          return false;
        }
      })
      .map((url) => {
        // Garante que tem protocolo HTTP
        if (!url.startsWith("http")) {
          return `http://${url}`;
        }
        return url.replace(/\/$/, ""); // Remove trailing slash
      });

    console.log("[LicenseAuth] parseUrls output:", servers);
    return servers;
  }

  /**
   * Retorna os servidores DNS
   */
  getServers() {
    if (!this.initialized) {
      console.warn("[LicenseAuth] Não inicializado. Execute init() primeiro.");
      return [];
    }
    return this.dnsServers;
  }

  /**
   * Retorna o primeiro servidor disponível
   */
  getPrimaryServer() {
    const servers = this.getServers();
    return servers.length > 0 ? servers[0] : null;
  }

  /**
   * Retorna um servidor aleatório (para load balancing)
   */
  getRandomServer() {
    const servers = this.getServers();
    if (servers.length === 0) return null;
    return servers[Math.floor(Math.random() * servers.length)];
  }
}

// Exporta para uso global
if (typeof window !== "undefined") {
  window.LicenseAuthApp = LicenseAuthApp;
}

// Exporta para Node.js/CommonJS
if (typeof module !== "undefined" && module.exports) {
  module.exports = LicenseAuthApp;
}
