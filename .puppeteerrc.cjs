// .puppeteerrc.cjs
const path = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Cambia el directorio de caché de Puppeteer a una carpeta local del proyecto
  cacheDirectory: path.join(__dirname, '.cache', 'puppeteer'),
};