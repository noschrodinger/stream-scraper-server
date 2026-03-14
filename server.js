// server.js (para Render)
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Tu API key de TMDB (debe estar en variables de entorno)
const TMDB_API_KEY = process.env.TMDB_API_KEY;

app.get('/api/get-imdb', async (req, res) => {
  const { id, type } = req.query;

  if (!id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: id y type' });
  }

  if (!TMDB_API_KEY) {
    console.error('TMDB_API_KEY no configurada');
    return res.status(500).json({ error: 'Error de configuración del servidor' });
  }

  try {
    const url = `https://api.themoviedb.org/3/${type}/${id}/external_ids?api_key=${TMDB_API_KEY}`;
    const { data } = await axios.get(url, { timeout: 5000 });

    if (!data || !data.imdb_id) {
      return res.status(404).json({ error: 'No se encontró IMDb ID para este contenido' });
    }

    res.json({ imdb_id: data.imdb_id });
  } catch (error) {
    console.error('Error consultando TMDB:', error.message);
    res.status(500).json({ error: 'Error al consultar TMDB' });
  }
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ message: 'Servidor Nivin - Obtén IMDb IDs' });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});