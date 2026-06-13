// TODO: reemplazar por tu numero real de WhatsApp (formato internacional, sin + ni espacios)
const WHATSAPP_NUMERO = '5491100000000';

async function cargarEshop() {
    const estado = document.getElementById('eshopEstado');
    const grid = document.getElementById('eshopGrid');
    try {
        const res = await fetch('/api/eshop');
        if (!res.ok) throw new Error('Error al cargar');
        const productos = await res.json();

        if (!productos.length) {
            estado.textContent = 'Todavía no hay productos publicados en el catálogo.';
            return;
        }

        grid.innerHTML = productos.map(renderProducto).join('');
        estado.classList.add('hidden');
        grid.classList.remove('hidden');
    } catch {
        estado.textContent = 'No se pudo cargar el catálogo. Probá de nuevo en un momento.';
    }
}

function renderProducto(p) {
    const foto = (p.fotos || '').split(',')[0]?.trim();
    const img = foto
        ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy">`
        : `<div class="product-img-placeholder">🖨️</div>`;
    const mensaje = encodeURIComponent(`Hola! Te escribo por "${p.nombre}" que vi en el catálogo.`);
    return `
        <article class="product-card">
            <div class="product-img">${img}</div>
            <div class="product-body">
                ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                <h2 class="product-title">${escapeHTML(p.nombre)}</h2>
                <a class="btn-whatsapp" href="https://wa.me/${WHATSAPP_NUMERO}?text=${mensaje}" target="_blank" rel="noopener noreferrer">
                    💬 Consultar por WhatsApp
                </a>
            </div>
        </article>`;
}

cargarEshop();
