
// import * as cheerio from 'cheerio';

// export interface DocumentoJurisprudencia {
//     id: string;
//     titulo: string;
//     // Agregaremos más campos luego (fecha, expediente, etc.)
// }

// /**
//  * Extrae el token vital de JSF necesario para la paginación y descargas
//  */
// export function extractViewState(html: string): string {
//     const $ = cheerio.load(html);
//     const viewState = $('input[name="javax.faces.ViewState"]').val();

//     if (!viewState) {
//         throw new Error('❌ No se pudo encontrar el javax.faces.ViewState en el HTML.');
//     }

//     return viewState as string;
// }

// /**
//  * Extrae la información de los documentos listados en la página actual
//  */
// export function extractDocuments(html: string): DocumentoJurisprudencia[] {
//     const $ = cheerio.load(html);
//     const documentos: DocumentoJurisprudencia[] = [];

//     // TODO: Aquí debes inspeccionar la página web y cambiar el selector
//     // Ejemplo ficticio: supongamos que cada documento está en un <tr> con clase 'fila-doc'
//     $('table').each((index, element) => {
//         const id = $(element).attr('data-id') || `doc-${index}`;
//         const titulo = $(element).find('.titulo').text().trim();

//         documentos.push({ id, titulo });
//     });

//     return documentos;
// }


/**
 * htmlParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad única: extraer datos del HTML crudo devuelto por el servidor.
 * No realiza peticiones HTTP ni guarda estado externo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Representa un documento jurídico encontrado en la tabla de resultados. */
export interface DocumentoJurisprudencia {
  titulo: string;
  fecha: string;
  enlaceDescarga: string;
}

/**
 * Representa una sección navegable del header (cada <li> del menú principal).
 * `actionId` es el identificador JSF/PrimeFaces necesario para el POST de navegación.
 */
export interface SeccionHeader {
  label: string;      // Texto visible del elemento de menú
  actionId: string;   // Valor del atributo data-* o del <a> que dispara el POST
  href: string;       // href original del enlace (puede ser "#" o una ruta)
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Busca todas las ocurrencias de un patrón dentro de un bloque de HTML.
 * Devuelve un array de objetos con los grupos de captura nombrados.
 *
 * @param html    - HTML crudo como string
 * @param pattern - RegExp con flag `g` y grupos de captura
 */
function extraerCoincidencias(
  html: string,
  pattern: RegExp,
): RegExpExecArray[] {
  const resultados: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  // Usamos exec() en bucle para aprovechar grupos nombrados con flag /g
  while ((match = pattern.exec(html)) !== null) {
    resultados.push(match);
  }

  return resultados;
}

/**
 * Elimina etiquetas HTML y decodifica entidades HTML básicas de un string.
 *
 * @param raw - Fragmento HTML que puede contener tags y entidades
 */
function limpiarTexto(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')           // Eliminar etiquetas HTML
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, '')         // Entidades numéricas residuales
    .trim();
}

// ─── Funciones exportadas ─────────────────────────────────────────────────────

/**
 * Extrae el ViewState de JSF oculto en el formulario de la página.
 * El ViewState es imprescindible para cualquier POST posterior.
 *
 * @param html - HTML completo de la página
 * @returns    - Valor del ViewState o string vacío si no se encuentra
 */
export function extractViewState(html: string): string {
  // JSF serializa el ViewState en un <input type="hidden"> con este id/name
  const pattern = /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/;
  const match = html.match(pattern);

  if (!match) {
    console.warn('[PARSER] ViewState no encontrado en el HTML.');
    return '';
  }

  return match[1];
}

/**
 * Extrae todos los elementos <li> del header / menú de navegación principal.
 *
 * Busca la estructura típica de PrimeFaces/JSF:
 *   <ul id="...:menubar" ...>
 *     <li ...><a id="...:menuItem" href="...">Texto</a></li>
 *   </ul>
 *
 * @param html - HTML completo de la página
 * @returns    - Array de SeccionHeader (puede estar vacío si el menú no se encuentra)
 */
export function extractSeccionesHeader(html: string): SeccionHeader[] {
  const secciones: SeccionHeader[] = [];

  /**
   * Paso 1 – Aislar el bloque del menú de navegación.
   * Buscamos el <ul> que actúa como barra de menú. Ajusta el selector
   * según el id real que tenga el sitio (inspecciona el DOM).
   */
  const menuPattern = /<ul[^>]*(?:id="[^"]*(?:menu|nav|header)[^"]*"|role="menubar")[^>]*>([\s\S]*?)<\/ul>/i;
  const menuMatch = html.match(menuPattern);

  if (!menuMatch) {
    console.warn('[PARSER] No se encontró el bloque <ul> del menú principal.');
    return secciones;
  }

  const menuHtml = menuMatch[1];

  /**
   * Paso 2 – Extraer cada <li> con su <a> interior.
   * Capturamos:
   *   - El atributo id del <a> → usado como actionId para el POST
   *   - El atributo href del <a>
   *   - El contenido de texto del <a>
   */
  const liPattern = /<li[^>]*>[\s\S]*?<a[^>]*id="([^"]*)"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
  const coincidencias = extraerCoincidencias(menuHtml, liPattern);

  for (const match of coincidencias) {
    const [, actionId, href, textoRaw] = match;
    const label = limpiarTexto(textoRaw);

    // Ignorar ítems sin texto visible (separadores, iconos puros, etc.)
    if (!label) continue;

    secciones.push({ label, actionId, href });
  }

  console.log(`[PARSER] Secciones del header encontradas: ${secciones.length}`);
  return secciones;
}

/**
 * Extrae los documentos jurídicos listados en la tabla de resultados.
 *
 * Asume una estructura de tabla HTML estándar:
 *   <table ...>
 *     <tbody>
 *       <tr>
 *         <td>Título</td>
 *         <td>Fecha</td>
 *         <td><a href="/descargar/...">Descargar</a></td>
 *       </tr>
 *     </tbody>
 *   </table>
 *
 * ⚠️  Ajusta los índices de columna según la estructura real del sitio.
 *
 * @param html - HTML completo de la página de resultados
 * @returns    - Array de DocumentoJurisprudencia
 */
export function extractDocuments(html: string): DocumentoJurisprudencia[] {
  const documentos: DocumentoJurisprudencia[] = [];

  // Paso 1 – Aislar el <tbody> de la tabla de resultados
  const tbodyPattern = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i;
  const tbodyMatch = html.match(tbodyPattern);

  if (!tbodyMatch) {
    console.warn('[PARSER] No se encontró <tbody> en la página.');
    return documentos;
  }

  // Paso 2 – Extraer cada <tr>
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const filas = extraerCoincidencias(tbodyMatch[1], trPattern);

  for (const fila of filas) {
    const filaHtml = fila[1];

    // Paso 3 – Extraer las <td> de cada fila
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const celdas = extraerCoincidencias(filaHtml, tdPattern);

    if (celdas.length < 3) continue; // Fila incompleta o encabezado

    const titulo          = limpiarTexto(celdas[0][1]);
    const fecha           = limpiarTexto(celdas[1][1]);
    const celdaDescarga   = celdas[2][1];

    // Extraer href del enlace de descarga
    const hrefMatch = celdaDescarga.match(/href="([^"]+)"/);
    const enlaceDescarga = hrefMatch ? hrefMatch[1] : '';

    if (!titulo || !enlaceDescarga) continue;

    documentos.push({ titulo, fecha, enlaceDescarga });
  }

  return documentos;
}

/**
 * Detecta si hay una página siguiente disponible en el paginador.
 *
 * @param html - HTML completo de la página actual
 * @returns    - true si existe el botón/enlace "siguiente" habilitado
 */
export function hayPaginaSiguiente(html: string): boolean {
  /**
   * PrimeFaces usa una clase CSS en el paginador. Ajusta el selector
   * según lo que muestre el inspector del navegador en el sitio real.
   * Ejemplos comunes: "ui-paginator-next", "next", "page-next"
   */
  const patronSiguiente = /class="[^"]*ui-paginator-next[^"]*"[^>]*(?!disabled)/i;
  return patronSiguiente.test(html);
}ß