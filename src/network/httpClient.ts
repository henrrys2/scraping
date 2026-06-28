
import axios from 'axios';

// Estado global para almacenar nuestras cookies de sesión
let sessionCookies = '';

export const client = axios.create({
    baseURL: 'https://jurisprudencia.pj.gob.pe',
    headers: {
        // Fingimos ser Google Chrome en Windows
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Connection': 'keep-alive',
    },
    timeout: 15000, // 15 segundos de timeout
});

// Interceptor de RESPUESTA: Guarda las cookies que envía el servidor
client.interceptors.response.use((response) => {
    const setCookieHeaders = response.headers['set-cookie'];
    if (setCookieHeaders) {
        // Extraemos el JSESSIONID y otras cookies y las unimos
        sessionCookies = setCookieHeaders.map(cookie => cookie.split(';')[0]).join('; ');
    }
    return response;
}, (error) => {
    return Promise.reject(error);
});

// Interceptor de PETICIÓN: Envía las cookies guardadas al servidor
client.interceptors.request.use((config) => {
    if (sessionCookies) {
        config.headers['Cookie'] = sessionCookies;
    }
    return config;
});