/**
 * index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Punto de entrada del scraper.
 * Ejecutar con:  npx ts-node index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { JurisprudenciaScraper } from './JurisprudenciaScraper';

(async () => {
  const scraper = new JurisprudenciaScraper();
  await scraper.iniciar();

  // Una vez terminada la navegación, los documentos están disponibles
  const documentos = scraper.getDocumentos();
  console.log('\n[RESULTADO] Documentos recolectados:', documentos.length);

  // Fase siguiente: descargar archivos (se implementará en la siguiente iteración)
})();