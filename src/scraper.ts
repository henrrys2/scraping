/**
 * JurisprudenciaScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador principal del scraper.
 *
 * Flujo de trabajo:
 *   1. GET inicial  → obtener cookies de sesión + ViewState + secciones del header
 *   2. Iterar cada sección (<li>) del menú
 *      a. POST de navegación a la sección
 *      b. Extraer documentos de la página 1
 *      c. Bucle de paginación hasta agotar páginas
 *   3. (Fase 2) Descargar todos los documentos recolectados
 *
 * No usa Puppeteer ni librería HTTP externa; solo el módulo nativo de Node.js
 * encapsulado en `httpClient`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { client } from './network/httpClient';
import {
  extractViewState,
  extractSeccionesHeader,
  extractDocuments,
  hayPaginaSiguiente,
  SeccionHeader,
  DocumentoJurisprudencia,
} from './parser/htmlParser';

// ─── Constantes de configuración ──────────────────────────────────────────────

/** Ruta base del módulo JSF que sirve el contenido */
const URL_BASE = '/jurisprudenciaweb/faces/page/jurisprudencia-comparada.xhtml';

/**
 * ID del formulario principal de JSF.
 * Visible en el HTML como: <form id="FORM_ID" ...>
 * ⚠️  Ajustar según el DOM real del sitio.
 */
const FORM_ID = 'formPrincipal';

/** Pausa entre peticiones para no saturar el servidor (ms) */
const DELAY_MS = 800;

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Espera un número de milisegundos antes de continuar.
 * Evita que el scraper envíe peticiones demasiado rápido.
 *
 * @param ms - Milisegundos a esperar
 */
const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registra un mensaje con timestamp en la consola.
 *
 * @param nivel   - 'INFO' | 'ÉXITO' | 'WARN' | 'ERROR'
 * @param mensaje - Texto a mostrar
 */
function log(nivel: 'INFO' | 'ÉXITO' | 'WARN' | 'ERROR', mensaje: string): void {
  const ts = new Date().toISOString().substring(11, 19); // HH:MM:SS
  console.log(`[${ts}][${nivel.padEnd(5)}] ${mensaje}`);
}

// ─── Clase principal ──────────────────────────────────────────────────────────

export class JurisprudenciaScraper {
  /** ViewState actual de la sesión JSF (se actualiza en cada respuesta) */
  private viewState: string = '';

  /** Todos los documentos recolectados de todas las secciones y páginas */
  private documentosExtraidos: DocumentoJurisprudencia[] = [];

  /** Secciones encontradas en el header (un <li> por sección) */
  private secciones: SeccionHeader[] = [];

  // ─── Punto de entrada ────────────────────────────────────────────────────────

  /**
   * Inicia el proceso completo de scraping:
   *   1. Carga inicial
   *   2. Detección de secciones del header
   *   3. Navegación y extracción por cada sección
   */
  public async iniciar(): Promise<void> {
    log('INFO', '══════════════════════════════════════════');
    log('INFO', ' INICIANDO SCRAPER DE JURISPRUDENCIA');
    log('INFO', '══════════════════════════════════════════');

    try {
      // ── Fase 1: Carga inicial ────────────────────────────────────────────────
      await this.cargarPaginaInicial();

      if (this.secciones.length === 0) {
        log('WARN', 'No se encontraron secciones en el header. Abortando.');
        return;
      }

      // ── Fase 2: Navegar por cada sección del header ──────────────────────────
      for (let i = 0; i < this.secciones.length; i++) {
        const seccion = this.secciones[i];
        log('INFO', `──────────────────────────────────────────`);
        log('INFO', `Sección [${i + 1}/${this.secciones.length}]: "${seccion.label}"`);

        await this.procesarSeccion(seccion);
        await esperar(DELAY_MS);
      }

      // ── Resumen final ────────────────────────────────────────────────────────
      log('ÉXITO', '══════════════════════════════════════════');
      log('ÉXITO', `SCRAPING COMPLETO`);
      log('ÉXITO', `Total de documentos encontrados: ${this.documentosExtraidos.length}`);
      log('ÉXITO', '══════════════════════════════════════════');

      // TODO (Fase 3): llamar a this.descargarTodosLosDocumentos()

    } catch (error: any) {
      log('ERROR', `Fallo crítico: ${error.message}`);
      throw error;
    }
  }

  // ─── Carga inicial ───────────────────────────────────────────────────────────

  /**
   * Realiza el GET inicial para:
   *   - Obtener las cookies de sesión del servidor
   *   - Capturar el ViewState de JSF
   *   - Detectar todas las secciones del menú del header
   *   - Extraer los documentos de la primera página visible
   */
  private async cargarPaginaInicial(): Promise<void> {
    log('INFO', `GET inicial → ${URL_BASE}`);
    const response = await client.get(URL_BASE);

    if (response.status !== 200) {
      throw new Error(`El servidor respondió con status ${response.status}`);
    }

    // Capturar ViewState (requerido para todos los POST subsecuentes)
    this.viewState = extractViewState(response.data);
    if (!this.viewState) {
      throw new Error('No se pudo extraer el ViewState. Verifica la URL o el selector.');
    }
    log('ÉXITO', `ViewState capturado: ${this.viewState.substring(0, 20)}...`);

    // Detectar secciones del header
    this.secciones = extractSeccionesHeader(response.data);
    log('ÉXITO', `Secciones detectadas en el header: ${this.secciones.length}`);
    this.secciones.forEach((s, idx) => {
      log('INFO', `  [${idx + 1}] "${s.label}" → actionId: ${s.actionId}`);
    });

    // Extraer documentos visibles en la página de inicio
    const docsIniciales = extractDocuments(response.data);
    this.documentosExtraidos.push(...docsIniciales);
    log('INFO', `Documentos en página inicial: ${docsIniciales.length}`);
  }

  // ─── Navegación a una sección ────────────────────────────────────────────────

  /**
   * Navega a una sección concreta del menú y procesa todas sus páginas.
   *
   * Para sitios JSF/PrimeFaces la navegación de menú dispara un POST AJAX
   * (partial/ajax) con el actionId del ítem seleccionado.
   *
   * @param seccion - Metadatos del ítem <li> a visitar
   */
  private async procesarSeccion(seccion: SeccionHeader): Promise<void> {
    // Construir el payload JSF para activar el ítem de menú
    // La estructura exacta depende del componente que use el sitio:
    //   - p:menuitem → usa el atributo `action` o `onclick` con commandLink
    //   - h:commandLink / p:commandLink → dispara un submit con su id
    const payload = this.construirPayloadNavegacion(seccion.actionId);

    log('INFO', `POST de navegación → sección "${seccion.label}"`);
    const response = await client.post(URL_BASE, payload);

    // Actualizar el ViewState con el devuelto por la respuesta AJAX
    const nuevoViewState = extractViewState(response.data);
    if (nuevoViewState) {
      this.viewState = nuevoViewState;
    }

    // Extraer documentos de la página 1 de esta sección
    const docsP1 = extractDocuments(response.data);
    this.documentosExtraidos.push(...docsP1);
    log('INFO', `  Página 1 → ${docsP1.length} documentos`);

    // Si hay más páginas, iterar el paginador
    if (hayPaginaSiguiente(response.data)) {
      await this.paginarSeccion(seccion, 2);
    }
  }

  // ─── Paginación dentro de una sección ───────────────────────────────────────

  /**
   * Itera el paginador de una sección hasta que no haya más páginas.
   *
   * @param seccion     - Sección actual (para contexto en los logs)
   * @param numeroPagina - Número de la próxima página a cargar
   */
  private async paginarSeccion(
    seccion: SeccionHeader,
    numeroPagina: number,
  ): Promise<void> {
    let pagina = numeroPagina;

    while (true) {
      await esperar(DELAY_MS);

      // El paginador de PrimeFaces envía un POST con el id del botón "siguiente"
      // Ajusta el componentId según lo que muestre el inspector del sitio
      const payloadPaginador = this.construirPayloadPaginacion(pagina);

      log('INFO', `  POST paginación → página ${pagina}`);
      const response = await client.post(URL_BASE, payloadPaginador);

      // Actualizar ViewState
      const nuevoViewState = extractViewState(response.data);
      if (nuevoViewState) this.viewState = nuevoViewState;

      // Extraer documentos de esta página
      const docs = extractDocuments(response.data);
      this.documentosExtraidos.push(...docs);
      log('INFO', `  Página ${pagina} → ${docs.length} documentos`);

      // Si ya no hay página siguiente, salir del bucle
      if (!hayPaginaSiguiente(response.data) || docs.length === 0) {
        log('INFO', `  Fin de paginación en página ${pagina}`);
        break;
      }

      pagina++;
    }
  }

  // ─── Constructores de payload ─────────────────────────────────────────────────

  /**
   * Construye el payload para un POST de navegación a una sección del menú.
   *
   * En JSF el formato es:
   *   javax.faces.ViewState = <valor actual>
   *   javax.faces.source    = <id del componente que dispara el evento>
   *   javax.faces.partial.ajax = true
   *   javax.faces.partial.execute = @all
   *   javax.faces.partial.render  = <id del panel a refrescar>
   *   <id del componente> = <id del componente>  ← JSF lo necesita para identificar la acción
   *
   * ⚠️  Ajusta los valores según lo que capture el Network Tab del navegador.
   *
   * @param actionId - ID del <a> / commandLink del ítem de menú
   */
  private construirPayloadNavegacion(actionId: string): Record<string, string> {
    return {
      // ── Parámetros estándar de JSF AJAX ──────────────────────────────────
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': actionId,
      'javax.faces.partial.execute': '@all',
      'javax.faces.partial.render': `${FORM_ID}:panelContenido`, // Panel a refrescar
      'javax.faces.behavior.event': 'action',

      // ── Identificadores del formulario ────────────────────────────────────
      [FORM_ID]: FORM_ID,           // El formulario debe incluirse a sí mismo
      [actionId]: actionId,         // El componente que dispara la acción

      // ── ViewState de sesión ───────────────────────────────────────────────
      'javax.faces.ViewState': this.viewState,
    };
  }

  /**
   * Construye el payload para avanzar a una página concreta del paginador.
   *
   * PrimeFaces DataTable emite un evento `page` con el índice de la página.
   *
   * ⚠️  Ajusta `paginadorId` e `idTabla` según el DOM real del sitio.
   *
   * @param numeroPagina - Número de página destino (base 1)
   */
  private construirPayloadPaginacion(numeroPagina: number): Record<string, string> {
    /**
     * En PrimeFaces, el paginador envía:
     *   javax.faces.source = <id_tabla>
     *   javax.faces.behavior.event = page
     *   <id_tabla>_pagination = true
     *   <id_tabla>_first = <(pagina-1) * filasPorPagina>
     *   <id_tabla>_rows  = <filasPorPagina>
     */
    const ID_TABLA = `${FORM_ID}:tablaResultados`; // ← ajustar
    const FILAS_POR_PAGINA = 10;                   // ← ajustar según el sitio
    const primeraFila = (numeroPagina - 1) * FILAS_POR_PAGINA;

    return {
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': ID_TABLA,
      'javax.faces.partial.execute': ID_TABLA,
      'javax.faces.partial.render': ID_TABLA,
      'javax.faces.behavior.event': 'page',

      [`${ID_TABLA}_pagination`]: 'true',
      [`${ID_TABLA}_first`]: String(primeraFila),
      [`${ID_TABLA}_rows`]: String(FILAS_POR_PAGINA),

      [FORM_ID]: FORM_ID,
      'javax.faces.ViewState': this.viewState,
    };
  }

  // ─── Acceso a resultados ─────────────────────────────────────────────────────

  /**
   * Devuelve todos los documentos recolectados hasta el momento.
   * Útil para invocar desde el script de entrada antes de descargar.
   */
  public getDocumentos(): DocumentoJurisprudencia[] {
    return [...this.documentosExtraidos];
  }
}