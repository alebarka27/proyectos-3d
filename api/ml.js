const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI || 'http://localhost:3000/api/ml/callback';
const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.com';

async function initMLTokens() {
    await sql`
        CREATE TABLE IF NOT EXISTS ml_tokens (
            id TEXT PRIMARY KEY DEFAULT 'main',
            access_token TEXT NOT NULL DEFAULT '',
            refresh_token TEXT NOT NULL DEFAULT '',
            expires_at BIGINT DEFAULT 0,
            user_id BIGINT DEFAULT 0
        );
    `;
    await sql`
        ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS code_verifier TEXT DEFAULT ''
    `;
}

function base64URLEncode(buf) {
    return buf.toString('base64url');
}

function generateCodeVerifier() {
    return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier) {
    return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

async function getAuthURL() {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    await sql`
        INSERT INTO ml_tokens (id, code_verifier)
        VALUES ('main', ${verifier})
        ON CONFLICT (id) DO UPDATE SET code_verifier = EXCLUDED.code_verifier
    `;
    return `${ML_AUTH}/authorization?response_type=code&client_id=${ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256`;
}

async function exchangeCode(code) {
    const { rows } = await sql`SELECT code_verifier FROM ml_tokens WHERE id = 'main'`;
    const verifier = rows.length ? rows[0].code_verifier : '';
    const body = {
        grant_type: 'authorization_code',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        code,
        redirect_uri: ML_REDIRECT_URI,
    };
    if (verifier) body.code_verifier = verifier;
    const res = await fetch(`${ML_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
    });
    if (!res.ok) throw new Error('Error al intercambiar código: ' + res.status);
    const data = await res.json();
    await sql`
        INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at, user_id, code_verifier)
        VALUES ('main', ${data.access_token}, ${data.refresh_token}, ${Date.now() + data.expires_in * 1000}, ${data.user_id || 0}, '')
        ON CONFLICT (id) DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            user_id = EXCLUDED.user_id,
            code_verifier = ''
    `;
    return data;
}

async function refreshAccessToken() {
    const { rows } = await sql`SELECT refresh_token FROM ml_tokens WHERE id = 'main'`;
    if (!rows.length || !rows[0].refresh_token) throw new Error('No hay refresh token');
    const res = await fetch(`${ML_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: ML_CLIENT_ID,
            client_secret: ML_CLIENT_SECRET,
            refresh_token: rows[0].refresh_token,
        }),
    });
    if (!res.ok) throw new Error('Error al refrescar token: ' + res.status);
    const data = await res.json();
    await sql`
        UPDATE ml_tokens SET
            access_token = ${data.access_token},
            refresh_token = ${data.refresh_token || rows[0].refresh_token},
            expires_at = ${Date.now() + data.expires_in * 1000}
        WHERE id = 'main'
    `;
    return data.access_token;
}

async function getValidToken() {
    const { rows } = await sql`SELECT access_token, expires_at FROM ml_tokens WHERE id = 'main'`;
    if (!rows.length) return '';
    const { access_token, expires_at } = rows[0];
    if (!access_token) return '';
    if (Date.now() >= expires_at - 60000) {
        return await refreshAccessToken();
    }
    return access_token;
}

async function isConnected() {
    const { rows } = await sql`SELECT access_token FROM ml_tokens WHERE id = 'main'`;
    return rows.length > 0 && !!rows[0].access_token;
}

async function getUserId() {
    const { rows } = await sql`SELECT user_id FROM ml_tokens WHERE id = 'main'`;
    return rows.length ? rows[0].user_id : 0;
}

async function searchItems(userId) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const ids = [];
    const limit = 100;
    let offset = 0;
    while (true) {
        const res = await fetch(`${ML_API}/users/${userId}/items/search?offset=${offset}&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Error al buscar publicaciones: ' + res.status);
        const data = await res.json();
        ids.push(...(data.results || []));
        offset += limit;
        if (!data.results?.length || offset >= (data.paging?.total || 0)) break;
    }
    return ids;
}

async function getItemsDetails(itemIds) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const items = [];
    for (let i = 0; i < itemIds.length; i += 20) {
        const chunk = itemIds.slice(i, i + 20);
        const res = await fetch(`${ML_API}/items?ids=${chunk.join(',')}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Error al obtener detalle de publicaciones: ' + res.status);
        const data = await res.json();
        for (const entry of data) {
            if (entry.code === 200) items.push(entry.body);
        }
    }
    return items;
}

async function updateItem(itemId, data) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/items/${itemId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error ML API: ${res.status} - ${err}`);
    }
    return await res.json();
}

async function getItemDescription(itemId) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/items/${itemId}/description`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return ''; // 404 = sin descripcion
    const data = await res.json();
    return data.plain_text || data.text || '';
}

async function getOrder(orderId) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al obtener orden: ' + res.status);
    return await res.json();
}

// Predice la categoria de ML a partir del titulo del producto.
// Devuelve la prediccion mas probable (la primera) o null.
async function predictCategory(title) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/sites/MLA/domain_discovery/search?limit=3&q=${encodeURIComponent(title)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
}

// Crea una publicacion nueva en ML. Devuelve el item creado (incluye id y permalink).
async function createItem(body) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/items`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error ML API: ${res.status} - ${err}`);
    }
    return await res.json();
}

// Setea/crea la descripcion de un item (endpoint aparte de ML).
async function setItemDescription(itemId, text) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/items/${itemId}/description`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plain_text: text }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error al setear descripcion ML: ${res.status} - ${err}`);
    }
    return await res.json();
}

function parseMLId(valor) {
    if (!valor) return '';
    const match = valor.match(/MLA-?\d+/);
    if (match) return match[0].replace('-', '');
    if (/^\d+$/.test(valor.trim())) return 'MLA' + valor.trim();
    return valor;
}

module.exports = {
    initMLTokens,
    getAuthURL,
    exchangeCode,
    isConnected,
    getUserId,
    searchItems,
    getItemsDetails,
    getItemDescription,
    updateItem,
    getOrder,
    predictCategory,
    createItem,
    setItemDescription,
    parseMLId,
};