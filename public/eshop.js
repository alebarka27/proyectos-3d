/* Helpers compartidos (formatearPrecio, urlML, escapeHTML, safeHref,
   whatsappHref, renderProductoCard, skeletonCards) viven en utils.js. */

let todosProductos = [];
let categoriasEshop = [];
let catSeleccionada = '';
let busquedaTimeout = null;
let ordenActual = 'destacados';

// Lazy load: se renderiza de a lotes y un sentinel al final del grid pide más
const LOTE = 24;
let listaVisible = [];
let renderizados = 0;

// Ordena una copia de la lista segun el criterio elegido.
function ordenarProductos(arr) {
    const lista = arr.slice();
    const precio = p => parseFloat(p.precioventa) || 0;
    switch (ordenActual) {
        case 'precio-asc': lista.sort((a, b) => (precio(a) || Infinity) - (precio(b) || Infinity)); break;
        case 'precio-desc': lista.sort((a, b) => precio(b) - precio(a)); break;
        case 'nuevos': lista.sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0)); break;
        default: // destacados primero, despues por nombre
            lista.sort((a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || (a.nombre || '').localeCompare(b.nombre || ''));
    }
    return lista;
}

function cambiarOrden(v) {
    ordenActual = v;
    filtrarYMostrar();
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

        // La home linkea con /eshop?q=...&categoria=... — se aplican al entrar
        const params = new URLSearchParams(window.location.search);
        const q = (params.get('q') || '').trim();
        const cat = (params.get('categoria') || '').trim();
        if (q) document.getElementById('eshopSearch').value = q;
        if (cat && categoriasEshop.includes(cat)) catSeleccionada = cat;

        renderCategorias();
        filtrarYMostrar();
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
        <button class="home-cat-btn ${!catSeleccionada ? 'home-cat-btn-active' : ''}" style="${!catSeleccionada ? activoStyle : ''}" data-cat="">Todas</button>
        ${categoriasEshop.map(c => `
            <button class="home-cat-btn ${catSeleccionada === c ? 'home-cat-btn-active' : ''}" style="${catSeleccionada === c ? activoStyle : ''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>
        `).join('')}
    `;
}

// Delegacion: el contenedor persiste aunque se re-renderice su contenido.
document.getElementById('eshopCategorias').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (btn) filtrarCategoria(btn.dataset.cat);
});

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
    const min = parseFloat(document.getElementById('precioMin').value);
    const max = parseFloat(document.getElementById('precioMax').value);

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

    if (!isNaN(min) || !isNaN(max)) {
        resultado = resultado.filter(p => {
            const precio = parseFloat(p.precioventa) || 0;
            if (!isNaN(min) && precio < min) return false;
            if (!isNaN(max) && precio > max) return false;
            return true;
        });
    }

    mostrarProductos(resultado, q);
}

function mostrarProductos(productos, q) {
    const grid = document.getElementById('eshopGrid');

    if (!productos.length) {
        const msg = q
            ? `No encontramos coincidencias para "<strong>${escapeHTML(q)}</strong>".`
            : 'No hay productos con esos filtros.';
        grid.innerHTML = `<div class="empty-state">
            ${icon('inbox', 'icon-lg')}
            <p class="empty-state-title">Sin resultados</p>
            <p class="empty-state-text">${msg}</p>
        </div>`;
        listaVisible = [];
        return;
    }

    listaVisible = ordenarProductos(productos);
    renderizados = Math.min(LOTE, listaVisible.length);
    grid.innerHTML = listaVisible.slice(0, renderizados).map(renderProductoCard).join('');
}

function renderMasProductos() {
    if (renderizados >= listaVisible.length) return;
    const grid = document.getElementById('eshopGrid');
    const siguiente = Math.min(renderizados + LOTE, listaVisible.length);
    grid.insertAdjacentHTML('beforeend',
        listaVisible.slice(renderizados, siguiente).map((p, i) => renderProductoCard(p, renderizados + i)).join(''));
    renderizados = siguiente;
}

// Cuando el sentinel (despues del grid) entra en pantalla, se carga otro lote
new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderMasProductos();
}, { rootMargin: '600px' }).observe(document.getElementById('eshopSentinel'));

cargarEshop();
