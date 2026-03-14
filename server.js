const express = require('express');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rutas básicas
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Nivin Scraper optimizado para Render (512MB)',
    endpoints: ['/api/stream', '/health']
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Fuentes disponibles
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

// Cache simple (1 hora)
const cache = new Map();
const CACHE_TTL = 3600000;

// Endpoint principal de stream
app.get('/api/stream', async (req, res) => {
  console.log('🔍 Request params:', req.query);
  
  const { source, id, type, season, episode } = req.query;

  // Validaciones básicas
  if (!source || !id || !type) {
    return res.status(400).json({ error: 'Faltan parámetros: source, id, type' });
  }

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
  let page = null;
  let streamUrl = null;
  let timeoutId = null;

  try {
    // Lanzar Chromium con configuración de bajo consumo
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',      // Crítico para poca RAM
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',              // Reduce procesos (experimental)
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',        // Opcional, a veces necesario
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    page = await browser.newPage();

    // Interceptar requests para bloquear recursos pesados
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // Detectar stream inmediatamente
      if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.m3u8')) {
        streamUrl = url;
        console.log('🎬 Stream detectado:', url);
        // Cancelar todas las demás requests y cerrar pronto
        request.abort(); // No necesitamos cargar más
        // Forzar cierre del navegador (se hará en el cleanup)
        if (timeoutId) clearTimeout(timeoutId);
        (async () => {
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
        })();
        return;
      }

      // Bloquear recursos no esenciales
      const blockedTypes = ['image', 'stylesheet', 'font', 'media', 'other'];
      if (blockedTypes.includes(resourceType)) {
        request.abort();
        return;
      }

      // Bloquear dominios de terceros conocidos (publicidad)
      const blockedDomains = ['googleads', 'doubleclick', 'facebook', 'analytics', 'tracking'];
      if (blockedDomains.some(domain => url.includes(domain))) {
        request.abort();
        return;
      }

      // Permitir solo lo esencial (HTML, scripts, xhr)
      request.continue();
    });

    // Configurar headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': new URL(url).origin,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Navegar con timeout de 30 segundos
    await Promise.race([
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }), // No esperar a networkidle para ahorrar tiempo
      new Promise((_, reject) => 
        timeoutId = setTimeout(() => reject(new Error('Timeout 30s')), 30000)
      )
    ]);

    // Si ya encontramos el stream en la intercepción, no necesitamos esperar más
    if (!streamUrl) {
      // Esperar un poco más por si aparece en requests tardías (máx 5s)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

  } catch (error) {
    console.error('🔥 Error durante scraping:', error.message);
  } finally {
    // Limpiar timeout y cerrar navegador
    if (timeoutId) clearTimeout(timeoutId);
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  // Si encontramos stream, responder y cachear
  if (streamUrl) {
    const responseData = {
      url: streamUrl,
      headers: {
        'Referer': url,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': new URL(url).origin
      }
    };
    cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
    console.log('✅ Stream devuelto');
    return res.json(responseData);
  }

  // No se encontró stream
  console.log('❌ No se encontró stream');
  res.status(404).json({ error: 'No se encontró stream en la página' });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor optimizado corriendo en http://localhost:${PORT}`);
});