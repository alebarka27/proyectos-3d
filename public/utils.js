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
        formatearPrecio, urlML, extraerMLId, mlHighResImage, fotosArray,
        colorHex, coloresChips,
    };
}
