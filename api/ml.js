const { sql } = require('@vercel/postgres');

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
}

function getAuthURL() {
    return `${ML_AUTH}/authorization?response_type=code&client_id=${ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}`;
}

async function exchangeCode(code) {
    const res = await fetch(`${ML_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: ML_CLIENT_ID,
            client_secret: ML_CLIENT_SECRET,
            code,
            redirect_uri: ML_REDIRECT_URI,
        }),
    });
    if (!res.ok) throw new Error('Error al intercambiar código: ' + res.status);
    const data = await res.json();
    await sql`
        INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at, user_id)
        VALUES ('main', ${data.access_token}, ${data.refresh_token}, ${Date.now() + data.expires_in * 1000}, ${data.user_id || 0})
        ON CONFLICT (id) DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            user_id = EXCLUDED.user_id
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

async function getOrder(orderId) {
    const token = await getValidToken();
    if (!token) throw new Error('ML no conectado');
    const res = await fetch(`${ML_API}/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al obtener orden: ' + res.status);
    return await res.json();
}

module.exports = {
    initMLTokens,
    getAuthURL,
    exchangeCode,
    isConnected,
    updateItem,
    getOrder,
};