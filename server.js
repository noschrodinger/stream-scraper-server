const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Configuración
const TMDB_API_KEY = 'efeed9526bd765139b97d324e601ee0c'; // Tu API key de TMDB
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Lista de addons públicos de Stremio (priorizamos los que tienen latino)
const ADDONS = [
  {
    name: 'Torrentio',
    urlTemplate: 'https://torrentio.strem.fun/{type}/{imdbId}.json',
    priority: 1,
    languageFilter: (stream) => {
      const title = stream.title?.toLowerCase() || '';
      const description = stream.description?.toLowerCase() || '';
      return title.includes('latino') || description.includes('latino') ||
             title.includes('spanish') || description.includes('spanish') ||
             title.includes('pp') || description.includes('pp');
    }
  },
  {
    name: 'SuperFlix',
    urlTemplate: 'https://superflixapi.top/{type}/{imdbId}.json',
    priority: 2,
    languageFilter: (stream) => {
      const title = stream.title?.toLowerCase() || '';
      const description = stream.description?.toLowerCase() || '';
      return title.includes('latino') || description.includes('latino') ||
             title.includes('español') || description.includes('español');
    }
  },
  {
    name: 'PelisPlus',
    urlTemplate: 'https://pelisplus.strem.fun/{type}/{imdbId}.json',
    priority: 3,
    languageFilter: (stream) => {
      const title = stream.title?.toLowerCase() || '';
      const description = stream.description?.toLowerCase() || '';
      return title.includes('latino') || description.includes('latino') ||
             title.includes('es') || description.includes('es') ||
             title.includes('pp') || description.includes('pp');
    }
  }
];

// Cache simple en memoria (para no repetir llamadas a TMDB)
const tmdbCache = new Map();
const streamCache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// Función para obtener IMDb ID desde TMDB ID
async function getImdbId(tmdbId, type) {
  const cacheKey = `${type}-${tmdbId}`;
  if (tmdbCache.has(cacheKey)) {
    const cached = tmdbCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('📦 TMDB cache hit:', cacheKey);
      return cached.data;
    }
  }

  try {
    const url = `${TMDB_BASE_URL}/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 5000 });
    const imdbId = response.data.imdb_id;
    
    if (!imdbId) {
      throw new Error('No se encontró IMDb ID');
    }

    tmdbCache.set(cacheKey, { timestamp: Date.now(), data: imdbId });
    return imdbId;
  } catch (error) {
    console.error(`Error obteniendo IMDb ID para ${type} ${tmdbId}:`, error.message);
    return null;
  }
}

// Función para consultar un addon
async function fetchFromAddon(addon, type, imdbId, season, episode) {
  let formattedId = imdbId;
  if (type === 'tv' && season && episode) {
    formattedId = `${imdbId}:${season}:${episode}`;
  }

  const url = addon.urlTemplate
    .replace('{type}', type === 'movie' ? 'movie' : 'series')
    .replace('{imdbId}', formattedId);

  console.log(`🌐 Consultando ${addon.name}: ${url}`);

  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NivinApp/1.0; +https://tusitio.com)'
      }
    });

    const data = response.data;
    if (!data || !data.streams || !Array.isArray(data.streams)) {
      console.log(`⚠️ ${addon.name} no devolvió streams válidos`);
      return { addon: addon.name, streams: [] };
    }

    // Filtrar por idioma latino usando la función específica del addon
    const filteredStreams = data.streams.filter(addon.languageFilter);

    console.log(`✅ ${addon.name}: ${data.streams.length} total, ${filteredStreams.length} latinos`);
    
    // Enriquecer cada stream con el nombre del addon y headers si existen
    const enriched = filteredStreams.map(stream => ({
      ...stream,
      _addon: addon.name,
      _priority: addon.priority
    }));

    return { addon: addon.name, streams: enriched };
  } catch (error) {
    console.error(`❌ Error en ${addon.name}:`, error.message);
    return { addon: addon.name, streams: [] };
  }
}

// Endpoint principal
app.get('/api/stream', async (req, res) => {
  const { id, type, season, episode } = req.query;

  if (!id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: id, type' });
  }

  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const cacheKey = `${id}-${type}-${season || ''}-${episode || ''}`;

  // Verificar caché de streams
  if (streamCache.has(cacheKey)) {
    const cached = streamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('📦 Stream cache hit:', cacheKey);
      return res.json(cached.data);
    }
  }

  try {
    // 1. Obtener IMDb ID
    const imdbId = await getImdbId(id, mediaType);
    if (!imdbId) {
      return res.status(404).json({ error: 'No se pudo obtener IMDb ID' });
    }

    // 2. Consultar addons en paralelo
    const promises = ADDONS.map(addon => 
      fetchFromAddon(addon, mediaType, imdbId, season, episode)
    );
    const results = await Promise.allSettled(promises);

    // 3. Recolectar streams exitosos
    let allStreams = [];
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.streams.length > 0) {
        allStreams = allStreams.concat(result.value.streams);
      }
    });

    // 4. Ordenar por prioridad del addon y luego por calidad (si existe)
    allStreams.sort((a, b) => {
      if (a._priority !== b._priority) return a._priority - b._priority;
      // Intentar ordenar por calidad (1080p > 720p > ...)
      const qualityA = a.quality || '';
      const qualityB = b.quality || '';
      if (qualityA.includes('1080') && !qualityB.includes('1080')) return -1;
      if (!qualityA.includes('1080') && qualityB.includes('1080')) return 1;
      return 0;
    });

    if (allStreams.length === 0) {
      return res.status(404).json({ error: 'No se encontraron streams en latino' });
    }

    // 5. Tomar el primer stream (el mejor según criterios)
    const bestStream = allStreams[0];

    // Extraer URL directa
    let streamUrl = bestStream.url;
    if (!streamUrl && bestStream.externalUrl) {
      streamUrl = bestStream.externalUrl;
    }

    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream sin URL válida' });
    }

    // Construir respuesta con headers si existen
    const responseData = {
      url: streamUrl,
      title: bestStream.title || `${type} ${id}`,
      quality: bestStream.quality || 'unknown',
      addon: bestStream._addon,
      headers: bestStream.behaviorHints?.headers || {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://stremio.com/'
      }
    };

    // Guardar en caché
    streamCache.set(cacheKey, { timestamp: Date.now(), data: responseData });

    console.log('✅ Stream encontrado:', responseData.url);
    res.json(responseData);

  } catch (error) {
    console.error('🔥 Error general:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.get('/', (req, res) => {
  res.json({
    message: '🎬 Stremio Latino Resolver',
    endpoints: ['/api/stream', '/health'],
    usage: '/api/stream?id=550&type=movie'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});