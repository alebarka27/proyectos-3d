/* Helpers compartidos por todas las paginas (admin + tienda publica).
   Cargar SIEMPRE antes que app.js / eshop.js / producto.js. */

function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function safeHref(url) {
    return /^https?:\/\//i.test(String(url || '').trim()) ? url : '#';
}

/* --- Numero de WhatsApp: UNICA fuente de verdad de todo el sitio --- */
const WHATSAPP_NUMERO = '5491127192970';

function whatsappHref(text) {
    const base = `https://wa.me/${WHATSAPP_NUMERO}`;
    return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/* --- Formato y helpers de Mercado Libre --- */

function formatearPrecio(n) {
    return (Number(n) || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function urlML(id) {
    if (!id) return '';
    if (id.startsWith('http')) return id;
    const match = id.match(/^([A-Z]{3})(\d+)$/);
    return match ? `https://articulo.mercadolibre.com.ar/${match[1]}-${match[2]}` : `https://articulo.mercadolibre.com.ar/${id}`;
}

function extraerMLId(valor) {
    if (!valor) return '';
    const match = valor.match(/MLA-?\d+/);
    if (match) return match[0].replace('-', '');
    if (/^\d+$/.test(valor.trim())) return 'MLA' + valor.trim();
    return valor;
}

// Convierte miniaturas de ML a la imagen original (-O) en alta resolucion.
// ML codifica el tamaño con un sufijo de una letra antes de la extension
// (-I, -V, -N, -S, -F, -W, etc.); -O es la original.
function mlHighResImage(url) {
    if (!url || !url.includes('mlstatic.com')) return url;
    return url.replace(/-[A-Z](\.(?:jpe?g|png|webp))$/i, '-O$1');
}

// Version liviana para grillas: baja la resolucion 2x de ML a 1x (~500px),
// suficiente para tarjetas. La ficha de producto sigue usando -O (full).
function mlGridImage(url) {
    return mlHighResImage(url).replace('_2X_', '_');
}

function fotosArray(fotos) {
    return (fotos || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* --- Colores disponibles (de Mercado Libre) --- */

const COLOR_MAP = {
    negro: '#1a1a1a', blanco: '#f5f5f5', gris: '#9a9a9a', plata: '#c8c8c8', plateado: '#c8c8c8',
    rojo: '#e23b3b', bordo: '#7b1e2b', bordeaux: '#7b1e2b', naranja: '#f08a24', amarillo: '#f5c518',
    dorado: '#d4af37', oro: '#d4af37', verde: '#3fb950', 'verde agua': '#4fd1c5', oliva: '#808000',
    celeste: '#5bc0eb', azul: '#2f6fed', 'azul marino': '#1e2a5a', turquesa: '#1abc9c',
    violeta: '#8b5cf6', morado: '#8b5cf6', lila: '#c3a6e8', rosa: '#f06fb0', fucsia: '#e0218a',
    marron: '#8b5a2b', beige: '#e3d2b3', crema: '#f0e6d2', cobre: '#b87333', transparente: 'transparent',
};

function colorHex(name) {
    const k = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    return COLOR_MAP[k] || null;
}

// Devuelve el HTML de los swatches de color para una lista "Negro,Rojo,Azul"
function coloresChips(coloresStr, max = 6) {
    const cols = fotosArray(coloresStr);
    if (!cols.length) return '';
    const visibles = cols.slice(0, max);
    const swatches = visibles.map(c => {
        const hex = colorHex(c);
        if (hex === 'transparent') {
            return `<span class="swatch swatch-transparente" title="${escapeHTML(c)}" aria-label="${escapeHTML(c)}"></span>`;
        }
        if (hex) {
            return `<span class="swatch" style="background:${hex}" title="${escapeHTML(c)}" aria-label="${escapeHTML(c)}"></span>`;
        }
        return `<span class="swatch swatch-otro" title="${escapeHTML(c)}" aria-label="${escapeHTML(c)}"></span>`;
    }).join('');
    const extra = cols.length > max ? `<span class="swatch-more">+${cols.length - max}</span>` : '';
    return `<div class="color-swatches" title="Colores: ${escapeHTML(cols.join(', '))}">${swatches}${extra}</div>`;
}

/* --- Card de producto para grillas publicas (home + eshop) --- */

function skeletonCards(n) {
    return Array(n).fill(`
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-body">
                <div class="skeleton-line w-40"></div>
                <div class="skeleton-line w-60"></div>
                <div class="skeleton-line h-lg"></div>
            </div>
        </div>`).join('');
}

function renderProductoCard(p, i) {
    const fotoRaw = (p.fotos || '').split(',')[0]?.trim();
    const foto = mlGridImage(fotoRaw);
    const fotoOk = foto && /^https?:\/\//i.test(foto);
    const eager = i < 4; // las primeras imagenes cargan sin lazy (mejora el LCP)
    const img = fotoOk
        ? `<img src="${escapeHTML(foto)}" alt="${escapeHTML(p.nombre)}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async" onerror="imgFallback(this)">`
        : `<div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div>`;
    const badgeDigital = p.es_digital ? '<span class="badge-stl-card">Archivo digital</span>' : '';
    const cant = parseInt(p.cantidad) || 0;
    const sinStock = !p.es_digital && cant <= 0;
    const precio = parseFloat(p.precioventa) || 0;
    const waUrl = whatsappHref(`Hola! Te escribo por "${p.nombre}" que vi en el catálogo.`);
    const mlUrl = urlML(p.ml_id);
    return `
        <article class="product-card">
            <a href="/producto.html?id=${encodeURIComponent(p.id)}" style="display:contents;color:inherit;text-decoration:none;">
                <div class="product-img">${badgeDigital}${img}</div>
                <div class="product-body">
                    ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                    <h2 class="product-title">${escapeHTML(p.nombre)}</h2>
                    ${precio ? `
                    <div class="precio-section">
                        <span class="precio-simbolo">$</span>
                        <span class="precio-monto">${formatearPrecio(precio)}</span>
                    </div>` : ''}
                    ${coloresChips(p.colores)}
                    <div class="product-stock ${sinStock ? 'stock-agotado' : 'stock-disponible'}">
                        ${p.es_digital ? 'Entrega digital' : sinStock ? 'Sin stock' : `${cant} disponible${cant !== 1 ? 's' : ''}`}
                    </div>
                </div>
            </a>
            <div class="product-body" style="padding-top:0;">
                <div class="product-botones">
                    <a class="btn-whatsapp ${sinStock ? 'btn-whatsapp-disabled' : ''}" ${sinStock ? '' : `href="${waUrl}" target="_blank" rel="noopener noreferrer"`}>
                        ${icon('chat')} WhatsApp
                    </a>
                    ${mlUrl ? `<a class="btn-ml" href="${mlUrl}" target="_blank" rel="noopener noreferrer">${icon('cart')} ML</a>` : ''}
                </div>
                ${sinStock ? '' : `<button type="button" class="btn-add-carrito" data-id="${escapeHTML(p.id)}" data-nombre="${escapeHTML(p.nombre)}" data-precio="${precio}">＋ Agregar al pedido</button>`}
            </div>
        </article>`;
}

// Reemplaza una <img> que no carga (URL caida, foto borrada) por un placeholder.
function imgFallback(el) {
    el.onerror = null;
    const ph = document.createElement('div');
    ph.className = 'product-img-placeholder';
    if (typeof icon === 'function') ph.innerHTML = icon('printer', 'icon-lg');
    el.replaceWith(ph);
}

/* --- Setea los botones flotantes de WhatsApp en cualquier pagina ---
   Los <a class="whatsapp-float"> y cualquier [data-wa] toman el href de aca,
   asi el numero vive en un solo lugar. (solo navegador) */
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.whatsapp-float, [data-wa]').forEach(el => {
            el.setAttribute('href', whatsappHref(el.getAttribute('data-wa') || ''));
        });
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHTML, safeHref, WHATSAPP_NUMERO, whatsappHref,
        formatearPrecio, urlML, extraerMLId, mlHighResImage, mlGridImage, fotosArray,
        colorHex, coloresChips,
    };
}
