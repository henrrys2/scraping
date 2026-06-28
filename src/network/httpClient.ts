
// import axios from 'axios';

// // Estado global para almacenar nuestras cookies de sesión
// let sessionCookies = '';

// export const client = axios.create({
//     baseURL: 'https://jurisprudencia.pj.gob.pe',
//     headers: {
//         // Fingimos ser Google Chrome en Windows
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
//         'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
//         'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
//         'Connection': 'keep-alive',
//     },
//     timeout: 15000, // 15 segundos de timeout
// });

// // Interceptor de RESPUESTA: Guarda las cookies que envía el servidor
// client.interceptors.response.use((response) => {
//     const setCookieHeaders = response.headers['set-cookie'];
//     if (setCookieHeaders) {
//         // Extraemos el JSESSIONID y otras cookies y las unimos
//         sessionCookies = setCookieHeaders.map(cookie => cookie.split(';')[0]).join('; ');
//     }
//     return response;
// }, (error) => {
//     return Promise.reject(error);
// });

// // Interceptor de PETICIÓN: Envía las cookies guardadas al servidor
// client.interceptors.request.use((config) => {
//     if (sessionCookies) {
//         config.headers['Cookie'] = sessionCookies;
//     }
//     return config;
// });


/**
 * httpClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cliente HTTP nativo (Node.js `https`/`http` built-ins) sin dependencias
 * externas tipo Puppeteer o Playwright.
 *
 * Responsabilidades:
 *  - Mantener el jar de cookies de sesión entre peticiones
 *  - Enviar los headers necesarios para imitar un navegador real
 *  - Exponer métodos get() y post() con tipado fuerte
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  data: string;                // Cuerpo de la respuesta como texto
}

export interface PostPayload {
  [key: string]: string;
}

// ─── Jar de cookies ───────────────────────────────────────────────────────────

/**
 * Almacenamiento simple de cookies en memoria.
 * Persiste durante toda la vida del proceso (no entre ejecuciones).
 */
const cookieJar: Map<string, string> = new Map();

/**
 * Parsea el valor de un header Set-Cookie y guarda cada cookie en el jar.
 *
 * @param setCookieHeaders - Uno o varios valores del header Set-Cookie
 */
function guardarCookies(setCookieHeaders: string | string[] | undefined): void {
  if (!setCookieHeaders) return;

  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];

  for (const header of headers) {
    // Formato: "nombre=valor; Path=/; HttpOnly; ..."
    const [par] = header.split(';');
    const [nombre, ...valorPartes] = par.split('=');
    cookieJar.set(nombre.trim(), valorPartes.join('=').trim());
  }
}

/**
 * Serializa el jar de cookies al formato del header Cookie.
 *
 * @returns - String listo para enviarse como valor de Cookie
 */
function serializarCookies(): string {
  return [...cookieJar.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ─── Función base de petición ─────────────────────────────────────────────────

/** URL base del sitio. Ajusta según el entorno (dev / prod). */
const BASE_URL = 'https://www.tcij.gob.pe'; // ← cambia según el sitio real

/**
 * Realiza una petición HTTP/HTTPS y devuelve una promesa con la respuesta.
 * Gestiona automáticamente cookies y redireccionamientos (hasta 5 saltos).
 *
 * @param urlPath  - Ruta relativa o URL absoluta
 * @param options  - Opciones de Node.js `https.request`
 * @param body     - Cuerpo a enviar (solo para POST)
 * @param saltos   - Contador interno de redireccionamientos
 */
function peticion(
  urlPath: string,
  options: https.RequestOptions,
  body?: string,
  saltos = 0,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    // Seguridad: evitar bucles de redirección infinitos
    if (saltos > 5) {
      reject(new Error('[HTTP] Demasiados redireccionamientos.'));
      return;
    }

    // Construir URL completa si se recibe una ruta relativa
    const urlCompleta = urlPath.startsWith('http')
      ? urlPath
      : `${BASE_URL}${urlPath}`;

    const parsed = new URL(urlCompleta);

    // Headers comunes que imitan un navegador real
    const headersBase: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',   // Pedimos sin compresión para simplificar
      'Connection': 'keep-alive',
      'Cookie': serializarCookies(),
    };

    const requestOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      method: options.method || 'GET',
      headers: { ...headersBase, ...options.headers },
    };

    // Seleccionar módulo HTTP o HTTPS
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.request(requestOptions, (res) => {
      // Guardar cookies de la respuesta
      guardarCookies(res.headers['set-cookie']);

      // Manejar redireccionamientos 301/302/303/307/308
      if (
        res.statusCode &&
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location
      ) {
        console.log(`[HTTP] Redirigiendo → ${res.headers.location}`);
        // En 303 siempre se convierte a GET
        const nuevoMetodo = res.statusCode === 303 ? 'GET' : options.method;
        return peticion(
          res.headers.location,
          { ...options, method: nuevoMetodo },
          nuevoMetodo === 'GET' ? undefined : body,
          saltos + 1,
        ).then(resolve).catch(reject);
      }

      // Acumular chunks de datos
      let datos = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => { datos += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[]>,
          data: datos,
        });
      });
    });

    req.on('error', reject);

    // Enviar cuerpo en POST
    if (body) req.write(body);
    req.end();
  });
}

// ─── API pública del cliente ──────────────────────────────────────────────────

export const client = {
  /**
   * Realiza un GET y devuelve la respuesta.
   *
   * @param urlPath - Ruta relativa o URL absoluta
   */
  get(urlPath: string): Promise<HttpResponse> {
    return peticion(urlPath, { method: 'GET' });
  },

  /**
   * Realiza un POST con cuerpo application/x-www-form-urlencoded.
   * Este es el formato que JSF / PrimeFaces espera para las peticiones AJAX.
   *
   * @param urlPath - Ruta relativa o URL absoluta
   * @param payload - Par clave-valor a codificar en el cuerpo
   */
  post(urlPath: string, payload: PostPayload): Promise<HttpResponse> {
    // Codificar el payload como form-urlencoded
    const body = Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    return peticion(urlPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body).toString(),
        // Header obligatorio para peticiones AJAX de JSF/PrimeFaces
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, body);
  },
};ß