const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../api/index.js');

let server, baseUrl;

before(() => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
});

test('GET /robots.txt es publico y apunta al sitemap', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /User-agent: \*/);
    assert.match(text, /Sitemap: https:\/\/.+\/sitemap\.xml/);
});

test('GET /producto.html sin id sirve el HTML base', async () => {
    const res = await fetch(`${baseUrl}/producto.html`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Cargando producto\.\.\.<\/title>/);
    assert.match(html, /id="ogTitle"/);
});

test('setMetaById reemplaza el content del meta correcto', () => {
    const { setMetaById } = app._seo;
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'producto.html'), 'utf-8');
    const out = setMetaById(html, 'ogTitle', 'Lámpara Lúmina — 3D by Aurora');
    assert.match(out, /id="ogTitle" content="Lámpara Lúmina — 3D by Aurora"/);
    // los demas metas no cambian
    assert.match(out, /id="ogDescription" content="Producto impreso en 3D\."/);
});

test('escapeAttr escapa comillas y angulares para atributos HTML', () => {
    const { escapeAttr } = app._seo;
    assert.strictEqual(app._seo.escapeAttr('a"b<c>&d'), 'a&quot;b&lt;c&gt;&amp;d');
    assert.strictEqual(escapeAttr('texto normal'), 'texto normal');
});
