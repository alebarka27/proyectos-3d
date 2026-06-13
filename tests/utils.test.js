const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHTML, safeHref } = require('../public/utils.js');

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
