const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../api/index.js');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let server, baseUrl;

before(() => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
});

function login(ip) {
    return fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
}

test('GET /api/proyectos sin sesion devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/api/proyectos`);
    assert.strictEqual(res.status, 401);
});

test('GET / sin sesion redirige a login.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    assert.match(res.url, /login\.html$/);
});

test('GET /login.html es publico', async () => {
    const res = await fetch(`${baseUrl}/login.html`);
    assert.strictEqual(res.status, 200);
});

test('POST /api/login con password incorrecta devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1' },
        body: JSON.stringify({ password: 'incorrecta' }),
    });
    assert.strictEqual(res.status, 401);
});

test('POST /api/login con password correcta setea cookie de sesion', async () => {
    const res = await login('203.0.113.2');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('set-cookie')?.includes('session='));
});

test('rate limit en /api/login tras varios intentos fallidos', async () => {
    const ip = '203.0.113.3';
    let last;
    for (let i = 0; i < 6; i++) {
        last = await fetch(`${baseUrl}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
            body: JSON.stringify({ password: 'mal' }),
        });
    }
    assert.strictEqual(last.status, 429);
});

test('peticion autenticada con cookie valida pasa el auth gate', async () => {
    const loginRes = await login('203.0.113.4');
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${baseUrl}/api/proyectos`, { headers: { Cookie: cookie } });
    assert.notStrictEqual(res.status, 401);
});

test('POST /api/proyectos con Origin distinto al host es rechazado', async () => {
    const loginRes = await login('203.0.113.5');
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${baseUrl}/api/proyectos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example.com' },
        body: JSON.stringify({ nombre: 'Test' }),
    });
    assert.strictEqual(res.status, 403);
});
