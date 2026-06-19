/* Helpers compartidos (formatearPrecio, urlML, mlHighResImage, escapeHTML,
   safeHref, whatsappHref) viven en utils.js, cargado antes que este archivo. */

let todosProductos = [];
let categoriasEshop = [];
let catSeleccionada = '';
let busquedaTimeout = null;

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
        todosProductos = await res.json();

        categoriasEshop = [...new Set(todosProductos.map(p => p.categoria).filter(Boolean))].sort();
        renderCategorias();
        mostrarProductos(todosProductos);
    } catch {
        grid.innerHTML = `<div class="empty-state">
            ${icon('warning', 'icon-lg')}
            <p class="empty-state-title">No se pudo cargar el catálogo</p>
            <p class="empty-state-text">Probá de nuevo en un momento.</p>
        </div>`;
    }
}

function renderCategorias() {
    const container = document.getElementById('eshopCategorias');
    const activoStyle = 'border-color:var(--border-strong);color:var(--text);background:var(--surface-2);';
    container.innerHTML = `
        <button class="home-cat-btn ${!catSeleccionada ? 'home-cat-btn-active' : ''}" style="${!catSeleccionada ? activoStyle : ''}" onclick="filtrarCategoria('')">Todas</button>
        ${categoriasEshop.map(c => `
            <button class="home-cat-btn ${catSeleccionada === c ? 'home-cat-btn-active' : ''}" style="${catSeleccionada === c ? activoStyle : ''}" onclick="filtrarCategoria('${escapeHTML(c)}')">${escapeHTML(c)}</button>
        `).join('')}
    `;
}

function filtrarCategoria(cat) {
    catSeleccionada = cat;
    renderCategorias();
    filtrarYMostrar();
}

function buscarEshop() {
    clearTimeout(busquedaTimeout);
    busquedaTimeout = setTimeout(filtrarYMostrar, 200);
}

function filtrarYMostrar() {
    const q = (document.getElementById('eshopSearch').value || '').trim().toLowerCase();

    let resultado = todosProductos;

    if (catSeleccionada) {
        resultado = resultado.filter(p => p.categoria === catSeleccionada);
    }

    if (q) {
        resultado = resultado.filter(p =>
            (p.nombre || '').toLowerCase().includes(q) ||
            (p.categoria || '').toLowerCase().includes(q)
        );
    }

    mostrarProductos(resultado, q);
}

function mostrarProductos(productos, q) {
    const grid = document.getElementById('eshopGrid');

    if (!productos.length) {
        const msg = q
            ? `No encontramos coincidencias para "<strong>${escapeHTML(q)}</strong>".`
            : 'No hay productos en esta categoría.';
        grid.innerHTML = `<div class="empty-state">
            ${icon('inbox', 'icon-lg')}
            <p class="empty-state-title">Sin resultados</p>
            <p class="empty-state-text">${msg}</p>
        </div>`;
        return;
    }

    grid.innerHTML = productos.map(renderProducto).join('');
}

function renderProducto(p) {
    const fotoRaw = (p.fotos || '').split(',')[0]?.trim();
    const foto = mlGridImage(fotoRaw);
    const img = foto
        ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy" decoding="async">`
        : `<div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div>`;
    const sinStock = !p.cantidad || p.cantidad <= 0;
    const precio = parseFloat(p.precioventa) || 0;
    const waUrl = whatsappHref(`Hola! Te escribo por "${p.nombre}" que vi en el catálogo.`);
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
                    ${coloresChips(p.colores)}
                    <div class="product-stock ${sinStock ? 'stock-agotado' : 'stock-disponible'}">
                        ${sinStock ? 'Sin stock' : `${p.cantidad} disponible${p.cantidad !== 1 ? 's' : ''}`}
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
            </div>
        </article>`;
}

cargarEshop();
