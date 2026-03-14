const express = require('express');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ruta raíz de prueba
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Nivin Scraper funcionando (modo optimizado)',
    endpoints: ['/api/stream', '/health']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

const SOURCES = {
  flixhq: {
    name: 'FlixHQ',
    movie: (id) => `https://flixhq.to/movie/${id}`,
    tv: (id, season, episode) => `https://flixhq.to/tv/${id}-${season}-${episode}`
  },
  sflix: {
    name: 'SFlix',
    movie: (id) => `https://sflix.to/movie/${id}`,
    tv: (id, season, episode) => `https://sflix.to/tv/${id}-${season}-${episode}`
  },
  moviebox: {
    name: 'MovieBox',
    movie: (id) => `https://moviebox.to/movie/${id}`,
    tv: (id, season, episode) => `https://moviebox.to/tv/${id}-${season}-${episode}`
  }
};

// Cache simple
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hora

// Endpoint principal de stream
app.get('/api/stream', async (req, res) => {
  console.log('🔍 Request params:', req.query);
  
  const { source, id, type, season, episode } = req.query;

  // Validaciones
  if (!source || !id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: source, id, type' });
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

  const sourceConfig = SOURCES[source];
  if (!sourceConfig) {
    return res.status(400).json({ 
      error: `Fuente '${source}' no válida`,
      availableSources: Object.keys(SOURCES)
    });
  }

  // Construir URL
  let url;
  try {
    if (type === 'movie') {
      url = sourceConfig.movie(id);
    } else if (type === 'tv') {
      if (!season || !episode) {
        return res.status(400).json({ error: 'Para TV se requieren season y episode' });
      }
      url = sourceConfig.tv(id, season, episode);
    } else {
      return res.status(400).json({ error: "type debe ser 'movie' o 'tv'" });
    }
  } catch (error) {
    return res.status(400).json({ error: 'Error construyendo URL', details: error.message });
  }

  console.log(`🌐 Scraping ${source} - ${url}`);

  let browser = null;
  try {
    // Lanzar Chromium usando @sparticuz/chromium (optimizado para entornos serverless)
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Configurar headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': new URL(url).origin,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Interceptar requests para capturar .m3u8
    let streamUrl = null;
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const reqUrl = request.url();
      if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('master.m3u8')) {
        streamUrl = reqUrl;
        console.log('🎬 Stream encontrado:', reqUrl);
        // No cancelamos la request, solo la registramos
      }
      request.continue();
    });

    // Navegar a la página
    console.log('⏳ Cargando página...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar un poco más por si el video tarda en cargar
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    if (browser) await browser.close();

    if (streamUrl) {
      const responseData = {
        url: streamUrl,
        headers: {
          'Referer': url,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': new URL(url).origin
        }
      };
      
      // Guardar en caché
      cache.set(cacheKey, {
        timestamp: Date.now(),
        data: responseData
      });

      console.log('✅ Stream encontrado, respondiendo');
      res.json(responseData);
    } else {
      console.log('❌ No se encontró stream');
      res.status(404).json({ error: 'No se encontró stream en la página' });
    }

  } catch (error) {
    console.error('🔥 Error en scraping:', error);
    if (browser) await browser.close();
    res.status(500).json({ 
      error: 'Error al procesar la solicitud',
      details: error.message 
    });
  }
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor scraper corriendo en http://localhost:${PORT}`);
  console.log(`📡 Endpoint principal: http://localhost:${PORT}/api/stream`);
});