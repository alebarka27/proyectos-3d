// Integracion con Google Drive para entrega de archivos digitales (STL).
// Usa un service account: firma un JWT con la private key y lo cambia por
// un access token OAuth2. No requiere dependencias externas (solo crypto + fetch).

const crypto = require('crypto');

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
// La private key suele venir con los saltos de linea escapados (\n) en las env vars.
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let cachedToken = '';
let cachedExp = 0;

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

function isConfigured() {
    return !!(SA_EMAIL && SA_KEY);
}

// Acepta tanto un ID de archivo como un link completo de Drive y devuelve el ID.
function fileIdFrom(value) {
    if (!value) return '';
    const v = String(value).trim();
    let m = v.match(/\/d\/([a-zA-Z0-9_-]+)/);   // .../file/d/<ID>/view
    if (m) return m[1];
    m = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);      // ...?id=<ID>
    if (m) return m[1];
    return v;                                     // ya es un ID limpio
}

async function getAccessToken() {
    if (!isConfigured()) throw new Error('Google Drive no configurado (faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)');
    if (cachedToken && Date.now() < cachedExp - 60000) return cachedToken;

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
        iss: SA_EMAIL,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
    }));
    const signingInput = `${header}.${claim}`;
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(SA_KEY).toString('base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });
    if (!res.ok) throw new Error('Error al autenticar con Google: ' + res.status + ' ' + (await res.text()));
    const data = await res.json();
    cachedToken = data.access_token;
    cachedExp = Date.now() + (data.expires_in || 3600) * 1000;
    return cachedToken;
}

// Metadata del archivo (nombre, tamano, mimeType).
async function getFileMeta(fileId) {
    const token = await getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al leer metadata de Drive: ' + res.status);
    return await res.json();
}

// Devuelve la respuesta fetch cruda del contenido del archivo (para hacer stream).
async function getFileResponse(fileId) {
    const token = await getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al descargar archivo de Drive: ' + res.status);
    return res;
}

module.exports = {
    isConfigured,
    fileIdFrom,
    getFileMeta,
    getFileResponse,
};
