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

// ================= CONSULTAR TORRENTIO =================
async function fetchFromTorrentio(type, imdbId, season, episode) {
  try {
    let fullId = imdbId;
    if (type === 'tv' && season && episode) {
      fullId = `${imdbId}:${season}:${episode}`;
    }
    const url = `https://torrentio.strem.fun/stream/${type === 'movie' ? 'movie' : 'series'}/${fullId}.json`;
    console.log('🌐 Consultando Torrentio:', url);

    const { data } = await axios.get(url, { timeout: 8000 });
    console.log('📦 Respuesta Torrentio (primeros 200 chars):', JSON.stringify(data).slice(0, 200));

    // Verificar estructura de la respuesta
    if (data && Array.isArray(data.streams)) {
      console.log(`✅ Torrentio devolvió ${data.streams.length} streams`);
      return data.streams;
    } else {
      console.warn('⚠️ La respuesta de Torrentio no contiene un array "streams"');
      return [];
    }
  } catch (error) {
    console.error('🔥 Error en Torrentio:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
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

  console.log('🔍 Recibido:', { id, type, season, episode });

  try {
    // 1. Obtener IMDb ID
    const imdbId = await getImdbId(id, type);
    if (!imdbId) {
      return res.status(404).json({ error: 'No se pudo obtener IMDb ID desde TMDB' });
    }
    console.log('✅ IMDb ID:', imdbId);

    // 2. Consultar Torrentio
    const streams = await fetchFromTorrentio(type, imdbId, season, episode);

    if (streams.length === 0) {
      console.warn('❌ No se encontraron streams en Torrentio');
      return res.status(404).json({ error: 'No se encontraron streams' });
    }

    // 3. Filtrar latino
    const latino = filterLatino(streams);
    const selected = latino.length > 0 ? latino[0] : streams[0];

    // 4. Responder
    const streamInfo = extractStreamInfo(selected);
    console.log('✅ Stream seleccionado:', streamInfo.title);
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