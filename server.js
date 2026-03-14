const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'TU_API_KEY_DE_TMDB'; // Pon tu key en Render como variable de entorno

app.use(cors());
app.use(express.json());

// ================= FUNCIÓN AUXILIAR: Obtener IMDb ID desde TMDB =================
async function getImdbId(tmdbId, type) {
  try {
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
    const { data } = await axios.get(url, { timeout: 5000 });
    return data.imdb_id;
  } catch (error) {
    console.error(`Error obteniendo IMDb ID para ${tmdbId}:`, error.message);
    return null;
  }
}

// ================= FUNCIÓN AUXILIAR: Consultar un addon de Stremio =================
async function fetchFromAddon(addonUrl, type, imdbId, season, episode) {
  try {
    // Construir el ID compuesto si es serie
    let fullId = imdbId;
    if (type === 'tv' && season && episode) {
      fullId = `${imdbId}:${season}:${episode}`;
    }

    const url = `${addonUrl}/stream/${type === 'movie' ? 'movie' : 'series'}/${fullId}.json`;
    const { data } = await axios.get(url, { timeout: 8000 }); // Timeout 8 segundos por addon

    // Si el addon devuelve streams en data.streams
    if (data && Array.isArray(data.streams)) {
      return data.streams;
    }
    return [];
  } catch (error) {
    console.error(`Error consultando addon ${addonUrl}:`, error.message);
    return []; // Fallo silencioso
  }
}

// ================= FILTRADO POR IDIOMA LATINO =================
function filterLatino(streams) {
  const keywords = ['latino', 'spanish', 'español', 'pp', 'pelisplus'];
  return streams.filter(stream => {
    const title = (stream.title || '').toLowerCase();
    const description = (stream.description || '').toLowerCase();
    return keywords.some(keyword => title.includes(keyword) || description.includes(keyword));
  });
}

// ================= EXTRACTOR DE URL Y HEADERS =================
function extractStreamInfo(stream) {
  let url = stream.url;
  let headers = {};

  // Si el addon provee headers en behaviorHints
  if (stream.behaviorHints && stream.behaviorHints.headers) {
    headers = stream.behaviorHints.headers;
  } else {
    // Headers por defecto para evitar bloqueos
    headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://torrentio.strem.fun/'
    };
  }

  return { url, title: stream.title, headers };
}

// ================= ENDPOINT PRINCIPAL =================
app.get('/api/stream', async (req, res) => {
  const { id, type, season, episode } = req.query;

  // Validaciones básicas
  if (!id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: id, type' });
  }

  console.log(`🔍 Procesando: ${type} ${id} S${season || ''}E${episode || ''}`);

  try {
    // 1. Obtener IMDb ID desde TMDB
    const imdbId = await getImdbId(id, type);
    if (!imdbId) {
      return res.status(404).json({ error: 'No se pudo obtener IMDb ID desde TMDB' });
    }
    console.log(`✅ IMDb ID: ${imdbId}`);

    // 2. Lista de addons a consultar (añade más según encuentres)
    const addons = [
      'https://torrentio.strem.fun',          // Torrentio (verificado)
      'https://superflixapi.strem.fun',       // SuperFlix (asumo dominio, verifica)
      // Puedes añadir más aquí, ej: 'https://pobreflix.strem.fun'
    ];

    // 3. Consultar todos los addons en paralelo
    const results = await Promise.allSettled(
      addons.map(addon => fetchFromAddon(addon, type, imdbId, season, episode))
    );

    // 4. Combinar todos los streams
    let allStreams = [];
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allStreams = allStreams.concat(result.value);
      }
    });

    if (allStreams.length === 0) {
      return res.status(404).json({ error: 'No se encontraron streams en ningún addon' });
    }

    // 5. Filtrar por idioma latino
    const latinoStreams = filterLatino(allStreams);

    // Si hay streams latinos, usar el primero; si no, usar el primero disponible
    const selectedStream = latinoStreams.length > 0 ? latinoStreams[0] : allStreams[0];

    // 6. Extraer información para el reproductor
    const streamInfo = extractStreamInfo(selectedStream);

    console.log(`✅ Stream encontrado: ${streamInfo.title || 'sin título'}`);
    res.json(streamInfo);

  } catch (error) {
    console.error('🔥 Error general:', error.message);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Rutas básicas
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Stremio Addon Resolver para Nivin',
    endpoints: ['/api/stream', '/health']
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});