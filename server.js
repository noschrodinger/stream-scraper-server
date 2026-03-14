const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================= CONFIGURACIÓN DE FUENTES =================
// Cada fuente define:
// - name: nombre descriptivo
// - urlBuilder: función que construye la URL de la página a scrapear (recibe id, season, episode)
// - extractor: función que recibe el HTML y devuelve la URL del stream (o null)
const SOURCES = {
  cuevana: {
    name: 'Cuevana 3 (Latino)',
    urlBuilder: (id, type, season, episode) => {
      if (type === 'movie') return `https://cuevana3.nu/pelicula/${id}`;
      else return `https://cuevana3.nu/serie/${id}/${season}/${episode}`;
    },
    extractor: ($) => {
      // Buscar iframe con clase TPlayer (típico de Cuevana)
      const iframeSrc = $('iframe.TPlayer').attr('src');
      if (!iframeSrc) return null;

      // Extraer parámetro showEmbed
      const match = iframeSrc.match(/showEmbed=([^&]+)/);
      if (!match) return null;

      // Decodificar Base64
      const base64Code = match[1];
      const decodedUrl = Buffer.from(base64Code, 'base64').toString('utf-8');
      return decodedUrl;
    }
  },
  // Puedes agregar más fuentes con sus propios extractores
  // ej: gnula, repelis, etc.
};

// Cache simple (opcional, para no repetir peticiones)
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// ================= ENDPOINT PRINCIPAL =================
app.get('/api/stream', async (req, res) => {
  const { source, id, type, season, episode } = req.query;

  // Validaciones básicas
  if (!source || !id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: source, id, type' });
  }

  const sourceConfig = SOURCES[source];
  if (!sourceConfig) {
    return res.status(400).json({
      error: `Fuente '${source}' no válida`,
      availableSources: Object.keys(SOURCES)
    });
  }

  // Construir URL según el tipo
  let url;
  try {
    if (type === 'movie') {
      url = sourceConfig.urlBuilder(id, type);
    } else if (type === 'tv') {
      if (!season || !episode) {
        return res.status(400).json({ error: 'Para TV se requieren season y episode' });
      }
      url = sourceConfig.urlBuilder(id, type, season, episode);
    } else {
      return res.status(400).json({ error: "type debe ser 'movie' o 'tv'" });
    }
  } catch (error) {
    return res.status(400).json({ error: 'Error construyendo URL', details: error.message });
  }

  // Verificar caché
  const cacheKey = `${source}-${id}-${type}-${season || ''}-${episode || ''}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('📦 Cache hit:', cacheKey);
      return res.json(cached.data);
    }
  }

  console.log(`🌐 Scraping ${source} - ${url}`);

  try {
    // 1. Obtener HTML con Axios (ligero, sin navegador)
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': new URL(url).origin,
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      timeout: 10000 // 10 segundos máximo
    });

    // 2. Cargar HTML en Cheerio
    const $ = cheerio.load(html);

    // 3. Ejecutar el extractor específico de la fuente
    const streamUrl = sourceConfig.extractor($);

    if (!streamUrl) {
      return res.status(404).json({ error: 'No se encontró stream en la página' });
    }

    // 4. Preparar respuesta
    const responseData = {
      url: streamUrl,
      headers: {
        'Referer': new URL(url).origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    // Guardar en caché
    cache.set(cacheKey, { timestamp: Date.now(), data: responseData });

    console.log('✅ Stream encontrado:', streamUrl);
    res.json(responseData);

  } catch (error) {
    console.error('🔥 Error en scraping:', error.message);
    res.status(500).json({ error: 'Error al procesar la solicitud', details: error.message });
  }
});

// Ruta raíz y health check
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Nivin Scraper (Axios + Cheerio)',
    endpoints: ['/api/stream', '/health']
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});