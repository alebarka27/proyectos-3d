const WHATSAPP_NUMERO = '5491100000000';

function formatearPrecio(n) {
    return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function extraerMLId(valor) {
    if (!valor) return '';
    const match = valor.match(/MLA-?\d+/);
    if (match) return match[0].replace('-', '');
    if (/^\d+$/.test(valor.trim())) return 'MLA' + valor.trim();
    return valor;
}

function urlML(id) {
    if (!id) return '';
    if (id.startsWith('http')) return id;
    return `https://articulo.mercadolibre.com.ar/${id}`;
}

let categoriasEshop = [];
let catSeleccionada = '';

async function cargarEshop() {
    const estado = document.getElementById('eshopEstado');
    const grid = document.getElementById('eshopGrid');
    try {
        const res = await fetch('/api/eshop');
        if (!res.ok) throw new Error('Error al cargar');
        const productos = await res.json();

        categoriasEshop = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();
        renderCategorias();

        if (!productos.length) {
            estado.textContent = 'Todavía no hay productos publicados en el catálogo.';
            return;
        }

        renderGrid(productos);
        estado.classList.add('hidden');
        grid.classList.remove('hidden');
    } catch {
        estado.textContent = 'No se pudo cargar el catálogo. Probá de nuevo en un momento.';
    }
}

function renderCategorias() {
    const container = document.getElementById('eshopCategorias');
    container.innerHTML = `
        <button class="home-cat-btn ${!catSeleccionada ? 'home-cat-btn-active' : ''}" style="${!catSeleccionada ? 'border-color:var(--border-strong);color:var(--text);background:var(--surface-2);' : ''}" onclick="filtrarCategoria('')">Todas</button>
        ${categoriasEshop.map(c => `
            <button class="home-cat-btn ${catSeleccionada === c ? 'home-cat-btn-active' : ''}" style="${catSeleccionada === c ? 'border-color:var(--border-strong);color:var(--text);background:var(--surface-2);' : ''}" onclick="filtrarCategoria('${escapeHTML(c)}')">${escapeHTML(c)}</button>
        `).join('')}
    `;
}

function filtrarCategoria(cat) {
    catSeleccionada = cat;
    buscarEshop();
}

async function buscarEshop() {
    const input = document.getElementById('eshopSearch');
    const q = input.value.trim();
    const estado = document.getElementById('eshopEstado');
    const grid = document.getElementById('eshopGrid');

    try {
        let url = q ? `/api/buscar?q=${encodeURIComponent(q)}` : '/api/eshop';
        if (catSeleccionada) url += (q ? '&' : '?') + `categoria=${encodeURIComponent(catSeleccionada)}`;

        const res = await fetch(url);
        const productos = await res.json();

        if (!productos.length) {
            estado.textContent = q ? `No encontramos "${q}" en esta categoría.` : 'No hay productos en esta categoría.';
            estado.classList.remove('hidden');
            grid.classList.add('hidden');
            return;
        }

        renderGrid(productos);
        estado.classList.add('hidden');
        grid.classList.remove('hidden');
    } catch {
        estado.textContent = 'Error al buscar.';
    }
}

function renderGrid(productos) {
    const grid = document.getElementById('eshopGrid');
    grid.innerHTML = productos.map(renderProducto).join('');
}

function renderProducto(p) {
    const foto = (p.fotos || '').split(',')[0]?.trim();
    const img = foto
        ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy">`
        : `<div class="product-img-placeholder">🖨️</div>`;
    const sinStock = !p.cantidad || p.cantidad <= 0;
    const precio = parseFloat(p.precioventa) || 0;
    const mensaje = encodeURIComponent(`Hola! Te escribo por "${p.nombre}" que vi en el catálogo.`);
    const mlUrl = urlML(p.ml_id);
    return `
        <article class="product-card">
            <a href="/producto.html?id=${encodeURIComponent(p.id)}" style="display:contents;color:inherit;text-decoration:none;">
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
                </div>
            </a>
            <div class="product-body" style="padding-top:0;">
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
