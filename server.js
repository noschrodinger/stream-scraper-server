const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================= OBTENER IMDb ID DESDE TMDB =================
async function getImdbId(tmdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error('❌ TMDB_API_KEY no está definida');
    return null;
  }
  try {
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${apiKey}`;
    console.log('📡 Consultando TMDB:', url);
    const { data } = await axios.get(url, { timeout: 5000 });
    console.log('📦 Respuesta TMDB:', data);
    return data?.imdb_id || null;
  } catch (error) {
    console.error('🔥 Error en TMDB:', error.response?.data || error.message);
    return null;
  }
}

// ================= CONSULTAR ADDON =================
async function fetchFromAddon(addonUrl, type, imdbId, season, episode) {
  try {
    let fullId = imdbId;
    if (type === 'tv' && season && episode) {
      fullId = `${imdbId}:${season}:${episode}`;
    }
    const url = `${addonUrl}/stream/${type === 'movie' ? 'movie' : 'series'}/${fullId}.json`;
    console.log(`🌐 Consultando addon: ${url}`);
    const { data } = await axios.get(url, { timeout: 8000 });
    return data?.streams || [];
  } catch (error) {
    console.error(`⚠️ Error en addon ${addonUrl}:`, error.message);
    return [];
  }
}

// ================= FILTRAR LATINO =================
function filterLatino(streams) {
  const keywords = ['latino', 'spanish', 'español', 'pp', 'pelisplus'];
  return streams.filter(stream => {
    const title = (stream.title || '').toLowerCase();
    const description = (stream.description || '').toLowerCase();
    return keywords.some(k => title.includes(k) || description.includes(k));
  });
}

// ================= EXTRAER INFO =================
function extractStreamInfo(stream) {
  const headers = stream.behaviorHints?.headers || {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://torrentio.strem.fun/'
  };
  return {
    url: stream.url,
    title: stream.title,
    headers
  };
}

// ================= ENDPOINT PRINCIPAL =================
app.get('/api/stream', async (req, res) => {
  const { id, type, season, episode } = req.query;

  if (!id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: id, type' });
  }

  console.log(`🔍 Recibido: ${type} ${id} S${season || ''}E${episode || ''}`);

  try {
    // 1. Obtener IMDb ID
    const imdbId = await getImdbId(id, type);
    if (!imdbId) {
      return res.status(404).json({ error: 'No se pudo obtener IMDb ID desde TMDB' });
    }
    console.log('✅ IMDb ID:', imdbId);

    // 2. Addons a consultar
    const addons = [
      'https://torrentio.strem.fun',
      // 'https://superflixapi.strem.fun', // descomenta si sabes que funciona
    ];

    // 3. Consultar en paralelo
    const results = await Promise.allSettled(
      addons.map(a => fetchFromAddon(a, type, imdbId, season, episode))
    );

    // 4. Unir streams
    let allStreams = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') allStreams.push(...r.value);
    });

    if (allStreams.length === 0) {
      return res.status(404).json({ error: 'No se encontraron streams' });
    }

    // 5. Filtrar latino
    const latino = filterLatino(allStreams);
    const selected = latino.length > 0 ? latino[0] : allStreams[0];

    // 6. Responder
    const streamInfo = extractStreamInfo(selected);
    console.log('✅ Stream listo:', streamInfo.title);
    res.json(streamInfo);

  } catch (error) {
    console.error('🔥 Error general:', error.message);
    res.status(500).json({ error: 'Error interno', details: error.message });
  }
});

// ================= RUTAS =================
app.get('/', (req, res) => {
  res.json({ message: '🚀 Stremio Resolver para Nivin', endpoints: ['/api/stream', '/health'] });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});