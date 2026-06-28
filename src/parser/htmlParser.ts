
import * as cheerio from 'cheerio';

export interface DocumentoJurisprudencia {
    id: string;
    titulo: string;
    // Agregaremos más campos luego (fecha, expediente, etc.)
}

/**
 * Extrae el token vital de JSF necesario para la paginación y descargas
 */
export function extractViewState(html: string): string {
    const $ = cheerio.load(html);
    const viewState = $('input[name="javax.faces.ViewState"]').val();

    if (!viewState) {
        throw new Error('❌ No se pudo encontrar el javax.faces.ViewState en el HTML.');
    }

    return viewState as string;
}

/**
 * Extrae la información de los documentos listados en la página actual
 */
export function extractDocuments(html: string): DocumentoJurisprudencia[] {
    const $ = cheerio.load(html);
    const documentos: DocumentoJurisprudencia[] = [];

    // TODO: Aquí debes inspeccionar la página web y cambiar el selector
    // Ejemplo ficticio: supongamos que cada documento está en un <tr> con clase 'fila-doc'
    $('table').each((index, element) => {
        const id = $(element).attr('data-id') || `doc-${index}`;
        const titulo = $(element).find('.titulo').text().trim();

        documentos.push({ id, titulo });
    });

    return documentos;
}