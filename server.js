const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================= CONFIGURACIÓN DE FUENTES =================
const SOURCES = {
  cuevana: {
    name: 'Cuevana 3 (Latino)',
    // Ahora el urlBuilder puede recibir un ID numérico y buscar el slug real
    urlBuilder: async (id, type, season, episode) => {
      // Si el ID es numérico (como 550), primero buscamos el slug en el sitio
      if (/^\d+$/.test(id)) {
        console.log(`🔍 ID numérico detectado (${id}), buscando slug...`);
        const slug = await resolveCuevanaSlug(id, type);
        if (!slug) {
          throw new Error(`No se pudo encontrar el slug para el ID ${id}`);
        }
        // Construir URL con el slug encontrado
        if (type === 'movie') {
          return `https://cuevana3.nu/${slug}`;
        } else {
          // Para series, asumimos que el slug es el nombre de la serie
          return `https://cuevana3.nu/serie/${slug}/${season}/${episode}`;
        }
      } else {
        // Si ya es un slug, lo usamos directamente
        if (type === 'movie') {
          return `https://cuevana3.nu/${id}`;
        } else {
          return `https://cuevana3.nu/serie/${id}/${season}/${episode}`;
        }
      }
    },
    // Extractor mejorado: busca el iframe específico
    extractor: ($) => {
      // Buscar el contenedor principal del reproductor
      const playerContainer = $('div.TPlayerCn');
      if (!playerContainer.length) return null;

      // Dentro del contenedor, buscar el iframe con la clase específica
      // Puede ser .TPlayer, .embed_div, o una combinación
      const iframe = playerContainer.find('iframe.TPlayer, iframe.embed_div').first();
      const iframeSrc = iframe.attr('src');
      
      if (!iframeSrc) return null;

      // Extraer parámetro showEmbed (puede estar como query param)
      const match = iframeSrc.match(/[?&]showEmbed=([^&]+)/);
      if (!match) return null;

      // Decodificar Base64
      const base64Code = match[1];
      try {
        const decodedUrl = Buffer.from(base64Code, 'base64').toString('utf-8');
        return decodedUrl;
      } catch (e) {
        console.error('Error decodificando Base64:', e.message);
        return null;
      }
    }
  }
  // Aquí puedes agregar más fuentes (gnula, repelis, etc.)
};

// ================= FUNCIÓN AUXILIAR: Resolver slug de Cuevana =================
async function resolveCuevanaSlug(tmdbId, type) {
  try {
    // Cuevana tiene un sistema de búsqueda. Intentamos con la URL de búsqueda
    const searchUrl = `https://cuevana3.nu/search?q=${tmdbId}`;
    const { data: html } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });

    const $ = cheerio.load(html);
    
    // Buscar el primer resultado que coincida con el tipo (película/serie)
    let selector = type === 'movie' ? 'article.item-pelicula a' : 'article.item-serie a';
    const firstResult = $(selector).first();
    const href = firstResult.attr('href');
    
    if (href) {
      // Extraer el slug de la URL (ej: /pelicula/el-rey-leon -> el-rey-leon)
      const slugMatch = href.match(/\/(?:pelicula|serie)\/([^\/]+)/);
      if (slugMatch) {
        return slugMatch[1];
      }
    }
    return null;
  } catch (error) {
    console.error('Error en búsqueda de slug:', error.message);
    return null;
  }
}

// Cache simple
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// ================= ENDPOINT PRINCIPAL =================
app.get('/api/stream', async (req, res) => {
  const { source, id, type, season, episode } = req.query;

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

  // Construir cache key (incluye todo)
  const cacheKey = `${source}-${id}-${type}-${season || ''}-${episode || ''}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('📦 Cache hit:', cacheKey);
      return res.json(cached.data);
    }
  }

  try {
    // 1. Obtener la URL real (puede requerir resolución de slug)
    const url = await sourceConfig.urlBuilder(id, type, season, episode);
    console.log(`🌐 URL construida: ${url}`);

    // 2. Obtener HTML con Axios
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://cuevana3.nu/',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      timeout: 10000
    });

    // 3. Cargar HTML en Cheerio
    const $ = cheerio.load(html);

    // 4. Ejecutar extractor específico
    const streamUrl = sourceConfig.extractor($);

    if (!streamUrl) {
      return res.status(404).json({ error: 'No se encontró stream en la página' });
    }

    // 5. Preparar respuesta
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
    console.error('🔥 Error:', error.message);
    res.status(500).json({ error: 'Error al procesar la solicitud', details: error.message });
  }
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Nivin Scraper (Axios + Cheerio + Resolución de slugs)',
    endpoints: ['/api/stream', '/health']
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});