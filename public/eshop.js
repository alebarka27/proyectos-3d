const WHATSAPP_NUMERO = '5491100000000';

function formatearPrecio(n) {
    return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function extraerMLId(valor) {
    if (!valor) return '';
    const match = valor.match(/MLA\d+/);
    return match ? match[0] : valor;
}

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
    const sinStock = !p.cantidad || p.cantidad <= 0;
    const precio = parseFloat(p.precioventa) || 0;
    const mensaje = encodeURIComponent(`Hola! Te escribo por "${p.nombre}" que vi en el catálogo.`);
    const mlUrl = p.ml_id ? `https://mercadolibre.com.ar/item/${extraerMLId(p.ml_id)}` : '';
    return `
        <article class="product-card">
            <div class="product-img">${img}</div>
            <div class="product-body">
                ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                <h2 class="product-title">${escapeHTML(p.nombre)}</h2>
                ${precio ? `
                <div class="precio-section">
                    <span class="precio-simbolo">$</span>
                    <span class="precio-monto">${formatearPrecio(precio)}</span>
                </div>` : ''}
                <div class="product-stock ${sinStock ? 'stock-agotado' : 'stock-disponible'}">
                    ${sinStock ? 'Sin stock' : `${p.cantidad} disponible${p.cantidad !== 1 ? 's' : ''}`}
                </div>
                <div class="product-botones">
                    <a class="btn-whatsapp ${sinStock ? 'btn-whatsapp-disabled' : ''}" ${sinStock ? '' : `href="https://wa.me/${WHATSAPP_NUMERO}?text=${mensaje}" target="_blank" rel="noopener noreferrer"`}>
                        💬 WhatsApp
                    </a>
                    ${mlUrl ? `<a class="btn-ml" href="${mlUrl}" target="_blank" rel="noopener noreferrer">🛒 ML</a>` : ''}
                </div>
            </div>
        </article>`;
}

cargarEshop();