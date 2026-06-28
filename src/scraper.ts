
import { client } from './network/httpClient';
import { extractViewState, extractDocuments, DocumentoJurisprudencia } from './parser/htmlParser';

export class JurisprudenciaScraper {
  private viewState: string = '';
  private documentosExtraidos: DocumentoJurisprudencia[] = [];

  public async iniciar() {
    try {
      console.log('[INFO] Iniciando conexión con el servidor...');

      // 1. Petición GET inicial para obtener las Cookies y el primer ViewState

      const urlInicial = '/jurisprudenciaweb/faces/page/jurisprudencia-comparada.xhtml';
      const response = await client.get(urlInicial);

      // 2. Extraer ViewState
      this.viewState = extractViewState(response.data);
      console.log(`[ÉXITO] ViewState capturado: ${this.viewState.substring(0, 15)}...`);

      // 3. Extraer documentos de la página 1
      const docsPagina1 = extractDocuments(response.data);
      this.documentosExtraidos.push(...docsPagina1);

      console.log(`[INFO] Se encontraron ${docsPagina1.length} documentos en la página 1.`);

      // Aquí entrará el bucle de paginación después...

    } catch (error: any) {
      console.error('[ERROR] Falló la ejecución del scraper:', error.message);
    }
  }
}