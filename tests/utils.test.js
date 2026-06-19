const { test } = require('node:test');
const assert = require('node:assert');
const {
    escapeHTML, safeHref, formatearPrecio, urlML,
    extraerMLId, mlHighResImage, fotosArray, whatsappHref,
} = require('../public/utils.js');

test('escapeHTML escapa caracteres especiales de HTML', () => {
    assert.strictEqual(escapeHTML('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(escapeHTML(`"'&`), '&quot;&#39;&amp;');
});

test('escapeHTML maneja null/undefined como string vacio', () => {
    assert.strictEqual(escapeHTML(null), '');
    assert.strictEqual(escapeHTML(undefined), '');
});

test('escapeHTML no modifica texto sin caracteres especiales', () => {
    assert.strictEqual(escapeHTML('Figura Goku'), 'Figura Goku');
});

test('safeHref permite URLs http y https', () => {
    assert.strictEqual(safeHref('https://example.com/archivo.stl'), 'https://example.com/archivo.stl');
    assert.strictEqual(safeHref('http://example.com'), 'http://example.com');
});

test('safeHref bloquea esquemas peligrosos y valores vacios', () => {
    assert.strictEqual(safeHref('javascript:alert(1)'), '#');
    assert.strictEqual(safeHref('data:text/html,<script>alert(1)</script>'), '#');
    assert.strictEqual(safeHref(''), '#');
    assert.strictEqual(safeHref(undefined), '#');
});

test('formatearPrecio agrupa miles con punto y maneja invalidos', () => {
    assert.strictEqual(formatearPrecio(1500), '1.500');
    assert.strictEqual(formatearPrecio(1234567), '1.234.567');
    assert.strictEqual(formatearPrecio(0), '0');
    assert.strictEqual(formatearPrecio(null), '0');
    assert.strictEqual(formatearPrecio(undefined), '0');
});

test('urlML arma el link correcto segun el formato del id', () => {
    assert.strictEqual(urlML('MLA123'), 'https://articulo.mercadolibre.com.ar/MLA-123');
    assert.strictEqual(urlML('https://articulo.mercadolibre.com.ar/MLA-9'), 'https://articulo.mercadolibre.com.ar/MLA-9');
    assert.strictEqual(urlML(''), '');
});

test('extraerMLId normaliza distintos formatos', () => {
    assert.strictEqual(extraerMLId('MLA-123'), 'MLA123');
    assert.strictEqual(extraerMLId('MLA123'), 'MLA123');
    assert.strictEqual(extraerMLId('123'), 'MLA123');
    assert.strictEqual(extraerMLId(''), '');
});

test('mlHighResImage convierte miniaturas de ML a alta resolucion', () => {
    assert.strictEqual(
        mlHighResImage('https://http2.mlstatic.com/D_NQ_NP_123-I.jpg'),
        'https://http2.mlstatic.com/D_NQ_NP_123-O.jpg'
    );
    // URLs que no son de ML quedan intactas
    assert.strictEqual(mlHighResImage('https://otro.com/foto-I.jpg'), 'https://otro.com/foto-I.jpg');
    assert.strictEqual(mlHighResImage(''), '');
});

test('fotosArray separa por comas y limpia vacios', () => {
    assert.deepStrictEqual(fotosArray('a.jpg, b.jpg ,, c.jpg'), ['a.jpg', 'b.jpg', 'c.jpg']);
    assert.deepStrictEqual(fotosArray(''), []);
    assert.deepStrictEqual(fotosArray(null), []);
});

test('whatsappHref arma el link con y sin mensaje', () => {
    assert.match(whatsappHref(), /^https:\/\/wa\.me\/\d+$/);
    assert.match(whatsappHref('Hola mundo'), /\?text=Hola%20mundo$/);
});
