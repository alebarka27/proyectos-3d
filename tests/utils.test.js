const { test } = require('node:test');
const assert = require('node:assert');
const {
    escapeHTML, safeHref, formatearPrecio, urlML,
    extraerMLId, mlHighResImage, mlGridImage, fotosArray, whatsappHref,
    colorHex, coloresChips, recortarBlanco,
} = require('../public/utils.js');

// Arma un ImageData sintetico (solo necesita .data) de w*h relleno con un color
function imagenDe(w, h, [r, g, b]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return { data };
}

function pintar(img, w, x, y, [r, g, b]) {
    const i = (y * w + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
}

function alphaEn(img, w, x, y) {
    return img.data[(y * w + x) * 4 + 3];
}

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
    // distintos sufijos de tamaño (-V, -N, -S, ...) tambien se elevan a -O
    assert.strictEqual(
        mlHighResImage('https://http2.mlstatic.com/D_NQ_NP_2X_686-MLA69_122023-V.webp'),
        'https://http2.mlstatic.com/D_NQ_NP_2X_686-MLA69_122023-O.webp'
    );
    // ya en alta resolucion: queda igual
    assert.strictEqual(
        mlHighResImage('https://http2.mlstatic.com/D_NQ_NP_123-O.jpg'),
        'https://http2.mlstatic.com/D_NQ_NP_123-O.jpg'
    );
    // URLs que no son de ML quedan intactas
    assert.strictEqual(mlHighResImage('https://otro.com/foto-I.jpg'), 'https://otro.com/foto-I.jpg');
    assert.strictEqual(mlHighResImage(''), '');
});

test('mlGridImage baja la resolucion 2x a 1x para grillas', () => {
    assert.strictEqual(
        mlGridImage('https://http2.mlstatic.com/D_NQ_NP_2X_859-MLA-O.webp'),
        'https://http2.mlstatic.com/D_NQ_NP_859-MLA-O.webp'
    );
    // sin 2x: solo eleva a -O
    assert.strictEqual(
        mlGridImage('https://http2.mlstatic.com/D_NQ_NP_777-MLA-I.jpg'),
        'https://http2.mlstatic.com/D_NQ_NP_777-MLA-O.jpg'
    );
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

test('colorHex resuelve colores (ignora acentos y mayusculas) y null si no existe', () => {
    assert.strictEqual(colorHex('Negro'), '#1a1a1a');
    assert.strictEqual(colorHex('marrón'), '#8b5a2b');
    assert.strictEqual(colorHex('Transparente'), 'transparent');
    assert.strictEqual(colorHex('ColorRaro'), null);
});

test('coloresChips genera swatches y respeta el maximo', () => {
    assert.strictEqual(coloresChips(''), '');
    assert.strictEqual(coloresChips(null), '');
    const html = coloresChips('Negro,Rojo');
    assert.match(html, /class="color-swatches"/);
    assert.match(html, /background:#1a1a1a/);
    // mas colores que el maximo -> muestra el contador "+N"
    assert.match(coloresChips('Negro,Rojo,Azul', 2), /\+1/);
});

test('recortarBlanco vuelve transparente el fondo blanco conectado al borde', () => {
    const w = 10, h = 10;
    const img = imagenDe(w, h, [255, 255, 255]);
    // producto rojo en el centro con un "agujero" blanco adentro (no conectado al borde)
    for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) pintar(img, w, x, y, [200, 30, 30]);
    pintar(img, w, 5, 5, [255, 255, 255]);

    assert.strictEqual(recortarBlanco(img, w, h), true);
    assert.strictEqual(alphaEn(img, w, 0, 0), 0, 'esquina transparente');
    assert.strictEqual(alphaEn(img, w, 9, 5), 0, 'borde transparente');
    assert.strictEqual(alphaEn(img, w, 4, 4), 255, 'producto queda opaco');
    assert.strictEqual(alphaEn(img, w, 5, 5), 255, 'blanco DENTRO del producto no se recorta');
});

test('recortarBlanco deja un degrade en las sombras claras del borde', () => {
    const w = 8, h = 8;
    const img = imagenDe(w, h, [255, 255, 255]);
    pintar(img, w, 4, 4, [230, 230, 230]); // sombra suave conectada al fondo

    assert.strictEqual(recortarBlanco(img, w, h), true);
    const a = alphaEn(img, w, 4, 4);
    assert.ok(a > 0 && a < 255, `sombra semi-transparente (alpha=${a})`);
});

test('recortarBlanco no toca fotos que no tienen fondo blanco', () => {
    const w = 6, h = 6;
    const img = imagenDe(w, h, [40, 20, 60]);
    assert.strictEqual(recortarBlanco(img, w, h), false);
    assert.strictEqual(alphaEn(img, w, 0, 0), 255);
});
