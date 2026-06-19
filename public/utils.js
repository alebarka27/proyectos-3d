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

// Convierte miniaturas de ML (-I / -F) a la imagen original (-O) en alta resolucion
function mlHighResImage(url) {
    if (!url || !url.includes('mlstatic.com')) return url;
    return url.replace(/-(I|F)(\.(jpe?g|png|webp))$/i, '-O$2');
}

function fotosArray(fotos) {
    return (fotos || '').split(',').map(s => s.trim()).filter(Boolean);
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
    };
}
