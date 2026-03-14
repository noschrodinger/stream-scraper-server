const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Nivin Scraper funcionando',
    endpoints: ['/api/stream', '/health']
  });
});

// Health check (opcional pero recomendado)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Tu endpoint principal
app.get('/api/stream', async (req, res) => {
  // ... todo tu código existente ...
});

// Mapeo de fuentes a URLs base
const SOURCES = {
  flixhq: {
    name: 'FlixHQ',
    baseUrl: 'https://flixhq.to',
    moviePath: '/movie/{tmdbId}',
    tvPath: '/tv/{tmdbId}-{season}-{episode}'
  },
  sflix: {
    name: 'SFlix',
    baseUrl: 'https://sflix.to',
    moviePath: '/movie/{tmdbId}',
    tvPath: '/tv/{tmdbId}-{season}-{episode}'
  },
  moviebox: {
    name: 'MovieBox',
    baseUrl: 'https://moviebox.to',
    moviePath: '/movie/{tmdbId}',
    tvPath: '/tv/{tmdbId}-{season}-{episode}'
  },
  superstream: {
    name: 'SuperStream',
    baseUrl: 'https://superstream.to',
    moviePath: '/movie/{tmdbId}',
    tvPath: '/tv/{tmdbId}-{season}-{episode}'
  }
};

// Función para construir URL según la fuente y tipo
function buildUrl(sourceKey, type, tmdbId, season, episode) {
  const source = SOURCES[sourceKey];
  if (!source) return null;

  if (type === 'movie') {
    return source.baseUrl + source.moviePath.replace('{tmdbId}', tmdbId);
  } else if (type === 'tv') {
    if (!season || !episode) return null;
    return source.baseUrl + source.tvPath
      .replace('{tmdbId}', tmdbId)
      .replace('{season}', season)
      .replace('{episode}', episode);
  }
  return null;
}

// Endpoint principal
app.get('/api/stream', async (req, res) => {
  const { source, type, id, season, episode } = req.query;

  if (!source || !type || !id) {
    return res.status(400).json({ error: 'Faltan parámetros: source, type, id son obligatorios' });
  }

  const url = buildUrl(source, type, id, season, episode);
  if (!url) {
    return res.status(400).json({ error: 'Fuente o tipo no válido' });
  }

  console.log(`[${new Date().toISOString()}] Scraping ${source} - ${url}`);

  try {
    const browser = await puppeteer.launch({
  	executablePath: '/usr/bin/chromium-browser', // Ruta típica en entornos Linux
 	 headless: 'new',
 	 args: [
 	   '--no-sandbox',
 	   '--disable-setuid-sandbox',
  	  '--disable-dev-shm-usage',
  	  '--disable-gpu'
  	]
	});   
	const page = await browser.newPage();

    // Configurar headers para parecer un navegador real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Referer': SOURCES[source].baseUrl
    });

    // Interceptar requests para capturar .m3u8
    let streamUrl = null;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const requestUrl = request.url();
      if (requestUrl.includes('.m3u8') || requestUrl.includes('.mp4')) {
        streamUrl = requestUrl;
        console.log('Stream encontrado:', requestUrl);
      }
      request.continue();
    });

    // Navegar a la página
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()}`);
    }

    // Esperar un poco para que carguen los scripts
    await page.waitForTimeout(5000);

    // También buscar en elementos de video
    const videoSrc = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video && video.src) return video.src;
      const source = document.querySelector('source');
      if (source && source.src) return source.src;
      return null;
    });

    if (videoSrc && !streamUrl) {
      streamUrl = videoSrc;
    }

    await browser.close();

    if (streamUrl) {
      // Devolver la URL junto con headers recomendados
      res.json({
        url: streamUrl,
        headers: {
          Referer: SOURCES[source].baseUrl,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*'
        }
      });
    } else {
      res.status(404).json({ error: 'No se encontró stream en la página' });
    }

  } catch (error) {
    console.error('Error en scraping:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor scraper corriendo en http://localhost:${PORT}`);
});