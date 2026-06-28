// src/index.ts (añadir al final)
import { JurisprudenciaScraper } from './scraper';

// ... (tu código anterior de creación de carpetas)

console.log('[INFO] Directorios listos. Iniciando Scraper...');
const scraper = new JurisprudenciaScraper();
scraper.iniciar();