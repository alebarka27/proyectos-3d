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
    const match = id.match(/^([A-Z]{3})(\d+)$/);
    return match ? `https://articulo.mercadolibre.com.ar/${match[1]}-${match[2]}` : `https://articulo.mercadolibre.com.ar/${id}`;
}

let categoriasEshop = [];
let catSeleccionada = '';
let busquedaTimeout = null;
let busquedaController = null;

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

async function cargarEshop() {
    const estado = document.getElementById('eshopEstado');
    const grid = document.getElementById('eshopGrid');
    estado.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = skeletonCards(6);
    try {
        const res = await fetch('/api/eshop');
        if (!res.ok) throw new Error('Error al cargar');
        const productos = await res.json();

        categoriasEshop = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();
        renderCategorias();

        if (!productos.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    ${icon('inbox', 'icon-lg')}
                    <p class="empty-state-title">Todavía no hay productos</p>
                    <p class="empty-state-text">Pronto vamos a sumar diseños al catálogo.</p>
                </div>`;
            return;
        }

        renderGrid(productos);
    } catch {
        grid.innerHTML = `
            <div class="empty-state">
                ${icon('warning', 'icon-lg')}
                <p class="empty-state-title">No se pudo cargar el catálogo</p>
                <p class="empty-state-text">Probá de nuevo en un momento.</p>
            </div>`;
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
    renderCategorias();
    _ejecutarBusqueda();
}

function buscarEshop() {
    clearTimeout(busquedaTimeout);
    busquedaTimeout = setTimeout(_ejecutarBusqueda, 300);
}

async function _ejecutarBusqueda() {
    if (busquedaController) busquedaController.abort();
    busquedaController = new AbortController();

    const input = document.getElementById('eshopSearch');
    const q = input.value.trim();
    const estado = document.getElementById('eshopEstado');
    const grid = document.getElementById('eshopGrid');

    estado.classList.add('hidden');
    grid.classList.remove('hidden');

    try {
        let url = q ? `/api/buscar?q=${encodeURIComponent(q)}` : '/api/eshop';
        if (catSeleccionada) url += (q ? '&' : '?') + `categoria=${encodeURIComponent(catSeleccionada)}`;

        const res = await fetch(url, { signal: busquedaController.signal });
        const productos = await res.json();

        if (!productos.length) {
            grid.innerHTML = `<div class="empty-state">
                ${icon('inbox', 'icon-lg')}
                <p class="empty-state-title">Sin resultados</p>
                <p class="empty-state-text">${q ? `No encontramos "${escapeHTML(q)}".` : 'No hay productos en esta categoría.'}</p>
            </div>`;
            return;
        }

        renderGrid(productos);
    } catch (err) {
        if (err.name === 'AbortError') return;
        grid.innerHTML = `<div class="empty-state">
            ${icon('warning', 'icon-lg')}
            <p class="empty-state-title">Error al buscar</p>
            <p class="empty-state-text">Intentá de nuevo en un momento.</p>
        </div>`;
    }
}

function renderGrid(productos) {
    const grid = document.getElementById('eshopGrid');
    grid.innerHTML = productos.map(renderProducto).join('');
}

function mlHighResImage(url) {
    if (!url || !url.includes('mlstatic.com')) return url;
    return url.replace(/-(I|F)(\.(jpe?g|png|webp))$/i, '-O$2');
}

function renderProducto(p) {
    const fotoRaw = (p.fotos || '').split(',')[0]?.trim();
    const foto = mlHighResImage(fotoRaw);
    const img = foto
        ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy">`
        : `<div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div>`;
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
                        ${icon('chat')} WhatsApp
                    </a>
                    ${mlUrl ? `<a class="btn-ml" href="${mlUrl}" target="_blank" rel="noopener noreferrer">${icon('cart')} ML</a>` : ''}
                </div>
            </div>
        </article>`;
}

cargarEshop();
