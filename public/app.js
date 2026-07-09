if (window.location.protocol === 'file:') {
    document.getElementById('app').innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
            <h2 style="color:#dc2626;">Modo incorrecto</h2>
            <p style="margin:16px 0;font-size:16px;">No abras el archivo directo. Ejecutá <strong>iniciar.bat</strong> o usá:</p>
            <code style="display:block;padding:12px;background:#1a1a2e;color:#fff;border-radius:6px;font-size:18px;">http://localhost:3000</code>
        </div>`;
    throw new Error('Modo incorrecto - usar localhost:3000');
}

// Reemplaza los <span data-icon="nombre"> del HTML por el SVG de icons.js,
// para no repetir el markup de cada icono en admin.html.
document.querySelectorAll('span[data-icon]').forEach(el => {
    const tpl = document.createElement('template');
    tpl.innerHTML = icon(el.dataset.icon, el.dataset.iconClass);
    el.replaceWith(tpl.content);
});

const API_PROY = '/api/proyectos';
const API_CAT = '/api/categorias';
let catActual = '';
let todosProyectos = [];
let catsGuardadas = [];
let authed = false;

async function apiFetch(url, options) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('No autenticado');
    }
    return res;
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

async function cargar() {
    const resMe = await fetch('/api/me');
    const me = await resMe.json();
    authed = me.authed;

    document.querySelectorAll('.tab-auth').forEach(t => t.classList.toggle('hidden', !authed));
    document.querySelectorAll('.sidebar-auth').forEach(el => el.classList.toggle('hidden', !authed));
    document.getElementById('btnIrTiendaSidebar').classList.toggle('hidden', !authed);
    document.getElementById('btnLogin').classList.toggle('hidden', authed);
    document.getElementById('btnLogout').classList.toggle('hidden', !authed);

    if (authed) {
        const [resP, resC, resV] = await Promise.all([apiFetch(API_PROY), apiFetch(API_CAT), apiFetch(API_VTA)]);
        todosProyectos = await resP.json();
        catsGuardadas = await resC.json();
        todasLasVentas = await resV.json();
        renderSidebar();
        renderTabla();
        checkMLStatus();
    }

    cambiarVista(authed ? 'dashboard' : 'tienda');
}

function renderSidebar() {
    const enUso = new Set(todosProyectos.map(p => p.categoria).filter(Boolean));
    const todas = [...new Set([...catsGuardadas, ...enUso])].sort();
    const container = document.getElementById('listaCarpetas');
    document.getElementById('count-todas').textContent = todosProyectos.length;
    const datalist = document.getElementById('catList');
    datalist.innerHTML = todas.map(c => `<option value="${escapeHTML(c)}">`).join('');
    container.innerHTML = todas.map(c => `
        <div class="carpeta ${catActual === c ? 'carpeta-activa' : ''}" data-cat="${escapeHTML(c)}">
            <span class="carpeta-icon">${icon('folder')}</span> ${escapeHTML(c)}
            <span class="carpeta-count">${todosProyectos.filter(p => p.categoria === c).length}</span>
        </div>
    `).join('');
    container.querySelectorAll('.carpeta').forEach(el => {
        el.addEventListener('click', () => filtrar(el.dataset.cat));
    });
}

function ganancia(p) {
    const venta = parseFloat(p.precioventa) || 0;
    const costo = parseFloat(p.costo) || 0;
    const cant = parseInt(p.vendidos) || 0;
    return (venta - costo) * cant;
}

/* extraerMLId, urlML y formatearPrecio viven en utils.js (cargado antes). */

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

// Muestra u oculta el contenido propio de la home (hero + categorias + "Más
// vendidos"). La barra de busqueda queda SIEMPRE visible, fuera de estos bloques.
function mostrarContenidoHome(visible) {
    document.getElementById('tiendaHero')?.classList.toggle('hidden', !visible);
    document.getElementById('tiendaHome')?.classList.toggle('hidden', !visible);
}

async function renderTienda() {
    if (busquedaAbortController) busquedaAbortController.abort();
    clearTimeout(busquedaTimeout);
    const estado = document.getElementById('tiendaEstado');
    estado.classList.add('hidden');
    const searchInput = document.getElementById('tiendaSearch');
    if (searchInput) searchInput.value = '';
    await renderHome();
}

async function renderHome() {
    mostrarContenidoHome(true);
    renderCategoriasTienda();

    const grid = document.getElementById('tiendaGrid');
    grid.innerHTML = skeletonCards(4);

    try {
        const res = await fetch('/api/destacados');
        const destacados = await res.json();
        if (!destacados.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    ${icon('inbox', 'icon-lg')}
                    <p class="empty-state-title">Todavía no hay productos</p>
                    <p class="empty-state-text">Pronto vamos a sumar diseños al catálogo.</p>
                </div>`;
            return;
        }
        grid.innerHTML = destacados.map(p => renderProductCard(p)).join('');
    } catch {
        grid.innerHTML = `
            <div class="empty-state">
                ${icon('warning', 'icon-lg')}
                <p class="empty-state-title">No se pudo cargar la tienda</p>
                <p class="empty-state-text">Recargá la página en unos segundos.</p>
            </div>`;
    }
}

async function renderCategoriasTienda() {
    const container = document.getElementById('tiendaCategorias');
    const res = await fetch('/api/eshop');
    const prods = await res.json();
    const cats = [...new Set(prods.map(p => p.categoria).filter(Boolean))].sort();
    if (!cats.length) { container.innerHTML = ''; return; }
    container.innerHTML = cats.map(c =>
        `<button class="home-cat-btn" onclick="filtrarCatTienda('${escapeHTML(c)}')">${escapeHTML(c)}</button>`
    ).join('');
}

async function filtrarCatTienda(cat) {
    if (busquedaAbortController) busquedaAbortController.abort();
    clearTimeout(busquedaTimeout);
    mostrarContenidoHome(false);
    const searchInput = document.getElementById('tiendaSearch');
    if (searchInput) searchInput.value = '';
    const estado = document.getElementById('tiendaEstado');
    const grid = document.getElementById('tiendaGrid');
    grid.innerHTML = '<div class="loading-spinner">Cargando...</div>';
    try {
        const res = await fetch(`/api/eshop?categoria=${encodeURIComponent(cat)}`);
        const productos = await res.json();
        if (!productos.length) {
            estado.textContent = 'No hay productos en esta categoría.';
            estado.classList.remove('hidden');
            grid.innerHTML = '';
            return;
        }
        grid.innerHTML = productos.map(p => renderProductCard(p)).join('');
        estado.classList.add('hidden');
    } catch {
        grid.innerHTML = '';
        estado.textContent = 'Error al cargar.';
        estado.classList.remove('hidden');
    }
}

/* --- Busqueda unificada (sugerencias + grilla) --- */

let busquedaTimeout = null;
let busquedaAbortController = null;

function manejarBusqueda() {
    const q = document.getElementById('tiendaSearch').value.trim();
    const grid = document.getElementById('tiendaGrid');
    const estado = document.getElementById('tiendaEstado');

    clearTimeout(busquedaTimeout);

    // Sin texto: volver a la home (destacados + categorias)
    if (!q) {
        if (busquedaAbortController) busquedaAbortController.abort();
        estado.classList.add('hidden');
        renderHome();
        return;
    }

    // Con texto: ocultar solo el contenido de home, la barra queda visible
    mostrarContenidoHome(false);
    estado.classList.add('hidden');
    grid.innerHTML = '<div class="loading-spinner">Buscando...</div>';

    busquedaTimeout = setTimeout(() => ejecutarBusqueda(q), 200);
}

async function ejecutarBusqueda(q) {
    if (busquedaAbortController) busquedaAbortController.abort();
    busquedaAbortController = new AbortController();

    const grid = document.getElementById('tiendaGrid');

    try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`, {
            signal: busquedaAbortController.signal,
        });
        const productos = await res.json();

        if (!productos.length) {
            grid.innerHTML = `<div class="empty-state">
                ${icon('inbox', 'icon-lg')}
                <p class="empty-state-title">Sin resultados</p>
                <p class="empty-state-text">No encontramos "${escapeHTML(q)}".</p>
            </div>`;
            return;
        }
        grid.innerHTML = productos.map(p => renderProductCard(p)).join('');
    } catch (err) {
        if (err.name === 'AbortError') return;
        grid.innerHTML = `<div class="empty-state">
            ${icon('warning', 'icon-lg')}
            <p class="empty-state-title">Error al buscar</p>
            <p class="empty-state-text">Intentá de nuevo en un momento.</p>
        </div>`;
    }
}

function renderProductCard(p) {
    const foto = mlGridImage((p.fotos || '').split(',')[0]?.trim());
    const img = foto
        ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy" decoding="async">`
        : `<div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div>`;
    const sinStock = !p.cantidad || p.cantidad <= 0;
    const precio = parseFloat(p.precioventa) || 0;
    const waUrl = whatsappHref(`Hola! Te escribo por "${p.nombre}" que vi en la tienda.`);
    const mlUrl = urlML(p.ml_id);
    return `
        <article class="product-card">
            <a href="/producto.html?id=${encodeURIComponent(p.id)}" style="display:contents;color:inherit;text-decoration:none;">
                <div class="product-img">${img}</div>
                <div class="product-body">
                    ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                    <h3 class="product-title">${escapeHTML(p.nombre)}</h3>
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
                ${authed && !sinStock ? `<button class="btn-vender" onclick="marcarVendido('${p.id}')">${icon('check')} Marcar vendido</button>` : ''}
            </div>
        </article>`;
}

let tiendaTimeout = null;

const ESTADOS_VALIDOS = ['Planificado', 'Imprimiendo', 'Terminado'];

/* Ordenamiento de la tabla de proyectos */
let sortCol = '';
let sortDir = 1;

const SORT_GETTERS = {
    nombre: p => (p.nombre || '').toLowerCase(),
    codigo: p => (p.codigo || '').toLowerCase(),
    categoria: p => (p.categoria || '').toLowerCase(),
    costo: p => parseFloat(p.costo) || 0,
    precioventa: p => parseFloat(p.precioventa) || 0,
    vendidos: p => parseInt(p.vendidos) || 0,
    stock: p => parseInt(p.cantidad) || 0,
    ganancia: p => ganancia(p),
    estado: p => p.estado || '',
};

function ordenarPor(col) {
    if (sortCol === col) {
        sortDir = -sortDir;
    } else {
        sortCol = col;
        sortDir = 1;
    }
    document.querySelectorAll('#tabla th[data-sort]').forEach(th => {
        th.classList.toggle('th-sorted-asc', th.dataset.sort === sortCol && sortDir === 1);
        th.classList.toggle('th-sorted-desc', th.dataset.sort === sortCol && sortDir === -1);
    });
    renderTabla();
}

document.querySelectorAll('#tabla th[data-sort]').forEach(th => {
    th.addEventListener('click', () => ordenarPor(th.dataset.sort));
});

function proyectosFiltrados() {
    let filtrados = catActual ? todosProyectos.filter(p => p.categoria === catActual) : todosProyectos;
    if (proySearchTerm) {
        filtrados = filtrados.filter(p => {
            const hay = [p.nombre, p.codigo, p.categoria, p.estado, p.descripcion]
                .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(proySearchTerm);
        });
    }
    if (soloDigitales) filtrados = filtrados.filter(p => p.es_digital);
    if (sortCol && SORT_GETTERS[sortCol]) {
        const get = SORT_GETTERS[sortCol];
        filtrados = [...filtrados].sort((a, b) => {
            const va = get(a), vb = get(b);
            if (va < vb) return -sortDir;
            if (va > vb) return sortDir;
            return 0;
        });
    }
    return filtrados;
}

function stockPill(p) {
    const stock = parseInt(p.cantidad) || 0;
    if (stock <= 0) return '<span class="stock-pill stock-pill-agotado">Agotado</span>';
    if (stock <= 2) return `<span class="stock-pill stock-pill-bajo">${stock}</span>`;
    return `<span class="stock-pill">${stock}</span>`;
}

function renderTabla() {
    const filtrados = proyectosFiltrados();
    const tbody = document.getElementById('tbody');
    if (!filtrados.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13">
                    <div class="empty-state">
                        ${icon('inbox', 'icon-lg')}
                        <p class="empty-state-title">No hay proyectos${catActual ? ` en "${escapeHTML(catActual)}"` : ''}</p>
                        <p class="empty-state-text">Creá uno nuevo con el botón "Nuevo Proyecto".</p>
                    </div>
                </td>
            </tr>`;
        const countEl = document.getElementById('proyCount');
        if (countEl) countEl.textContent = `0 de ${todosProyectos.length} proyectos`;
        return;
    }
    tbody.innerHTML = filtrados.map(p => {
        const g = ganancia(p);
        const costo = parseFloat(p.costo) || 0;
        const pv = parseFloat(p.precioventa) || 0;
        const vend = parseInt(p.vendidos) || 0;
        const stock = parseInt(p.cantidad) || 0;
        const estadoClase = ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado';
        return `
            <tr>
                <td data-label="Nombre">${escapeHTML(p.nombre)}${digitalBadges(p)}</td>
                <td data-label="Código">${escapeHTML(p.codigo)}</td>
                <td data-label="Categoría">${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : '-'}</td>
                <td data-label="Link Archivo">${[
                    p.linkarchivo ? `<a href="${escapeHTML(safeHref(p.linkarchivo))}" target="_blank" rel="noopener noreferrer">${icon('link-external')} Archivo</a>` : '',
                    p.drive_file_id ? `<a href="https://drive.google.com/file/d/${escapeHTML(p.drive_file_id)}/view" target="_blank" rel="noopener noreferrer" title="Abrir en Google Drive">${icon('link-external')} Drive</a>` : ''
                ].filter(Boolean).join(' ') || '-'}</td>
                <td data-label="Costo">${costo ? '$'+formatearPrecio(costo) : '-'}</td>
                <td data-label="Precio Vta">${pv ? '$'+formatearPrecio(pv) : '-'}</td>
                <td data-label="Vend.">${vend || '-'}</td>
                <td data-label="Stock">${stockPill(p)}</td>
                <td data-label="Ganancia" class="${g > 0 ? 'text-verde' : g < 0 ? 'text-rojo' : ''}">${g ? '$'+formatearPrecio(g) : '-'}</td>
                <td data-label="Estado"><span class="estado-badge estado-${estadoClase}">${escapeHTML(p.estado)}</span></td>
                <td data-label="ML">${p.ml_id ? `<a href="${urlML(p.ml_id)}" target="_blank" rel="noopener noreferrer" class="link-ml">${icon('link-external')} ML</a>` : `<button class="btn-sm" onclick="abrirPublicarML('${p.id}')">${icon('box')} Publicar</button>`}</td>
                <td data-label="Eshop"><button class="btn-sm ${p.publicareshop ? 'btn-eshop-on' : 'btn-eshop-off'}" onclick="toggleEshop('${p.id}', ${!!p.publicareshop})">${p.publicareshop ? `${icon('bag')} En tienda` : `${icon('box')} Publicar`}</button></td>
                <td data-label="Acciones">
                    ${stock > 0 ? `<button class="btn-sm" title="Venta rápida (1 unidad)" onclick="venderRapido('${p.id}')">${icon('cart')}</button>` : ''}
                    <button class="btn-sm" title="Editar" onclick="editar('${p.id}')">${icon('pencil')}</button>
                    <button class="btn-sm" title="Duplicar" onclick="duplicarProyecto('${p.id}')">${icon('clipboard')}</button>
                    <button class="btn-sm btn-peligro" title="Eliminar" onclick="eliminar('${p.id}')">${icon('trash')}</button>
                </td>
            </tr>`;
    }).join('');

    const countEl = document.getElementById('proyCount');
    if (countEl) countEl.textContent = `${filtrados.length} de ${todosProyectos.length} proyectos`;
}

async function venderRapido(id) {
    const p = todosProyectos.find(x => x.id === id);
    if (!p) return;
    const pv = parseFloat(p.precioventa) || 0;
    const ok = await showConfirm(
        `¿Registrar la venta de 1 × "${p.nombre}"${pv ? ` a $${formatearPrecio(pv)}` : ''}? Baja el stock en 1 y crea la venta.`,
        { title: 'Venta rápida', confirmLabel: 'Registrar venta' }
    );
    if (!ok) return;
    await apiFetch(`${API_PROY}/${id}/vender`, { method: 'PATCH' });
    showToast('Venta registrada', 'success');
    cargar();
}

function filtrar(cat) {
    catActual = cat;
    document.querySelectorAll('.carpeta').forEach(el => {
        el.classList.toggle('carpeta-activa', el.dataset.cat === cat);
    });
    renderTabla();
}

document.getElementById('btnNuevo').onclick = () => {
    document.getElementById('formTitle').textContent = 'Nuevo Proyecto';
    document.getElementById('projectForm').reset();
    document.getElementById('editId').value = '';
    document.getElementById('downloadCopyRow').classList.add('hidden');
    document.getElementById('formOverlay').classList.remove('hidden');
};

document.getElementById('btnCancelar').onclick = () => {
    document.getElementById('formOverlay').classList.add('hidden');
};

document.getElementById('projectForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editId').value;
    const data = {
        nombre: document.getElementById('nombre').value,
        codigo: document.getElementById('codigo').value,
        categoria: document.getElementById('categoria').value,
        linkArchivo: document.getElementById('linkArchivo').value,
        costo: document.getElementById('costo').value,
        precioVenta: document.getElementById('precioVenta').value,
        vendidos: document.getElementById('vendidos').value,
        cantidad: document.getElementById('cantidad').value,
        mlId: document.getElementById('mlId').value.trim(),
        fotos: document.getElementById('fotos').value,
        estado: document.getElementById('estado').value,
        descripcion: document.getElementById('descripcion').value,
        destacado: document.getElementById('destacadoCheck').checked,
        publicarEshop: document.getElementById('publicarEshop').checked,
        esDigital: document.getElementById('esDigitalCheck').checked,
        driveFileId: document.getElementById('driveFileId').value.trim(),
    };
    // Aviso de precio inconsistente (se puede guardar igual, pero a propósito)
    const costoNum = parseFloat(data.costo) || 0;
    const ventaNum = parseFloat(data.precioVenta) || 0;
    if (ventaNum > 0 && costoNum > ventaNum) {
        const seguir = await showConfirm(
            `El precio de venta ($${ventaNum}) es menor que el costo ($${costoNum}): venderías a pérdida. ¿Guardar igual?`,
            { title: 'Precio inconsistente', confirmLabel: 'Guardar igual' }
        );
        if (!seguir) return;
    }

    const url = id ? `${API_PROY}/${id}` : API_PROY;
    const method = id ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'No se pudo guardar el proyecto', 'error');
        return;
    }
    document.getElementById('formOverlay').classList.add('hidden');
    if (!id) catActual = data.categoria;
    cargar();
};

async function editar(id) {
    const p = todosProyectos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('formTitle').textContent = 'Editar Proyecto';
    document.getElementById('editId').value = p.id;
    document.getElementById('nombre').value = p.nombre;
    document.getElementById('codigo').value = p.codigo;
    document.getElementById('categoria').value = p.categoria || '';
    document.getElementById('linkArchivo').value = p.linkarchivo || '';
    document.getElementById('costo').value = p.costo || '';
    document.getElementById('precioVenta').value = p.precioventa || '';
    document.getElementById('vendidos').value = p.vendidos || '';
    document.getElementById('cantidad').value = p.cantidad || '';
    document.getElementById('mlId').value = p.ml_id || '';
    document.getElementById('fotos').value = p.fotos || '';
    document.getElementById('descripcion').value = p.descripcion || '';
    document.getElementById('destacadoCheck').checked = !!p.destacado;
    document.getElementById('esDigitalCheck').checked = !!p.es_digital;
    document.getElementById('driveFileId').value = p.drive_file_id || '';
    document.getElementById('estado').value = p.estado || 'Planificado';
    document.getElementById('publicarEshop').checked = !!p.publicareshop;
    actualizarCopyDescarga(p);
    document.getElementById('formOverlay').classList.remove('hidden');
}

// Trae (o crea) el link de descarga del producto y muestra el mensaje listo para copiar.
async function actualizarCopyDescarga(p) {
    const row = document.getElementById('downloadCopyRow');
    if (!p || !p.es_digital || !p.drive_file_id) { row.classList.add('hidden'); return; }
    try {
        const res = await apiFetch(`${API_PROY}/${p.id}/download-link`);
        const data = await res.json();
        if (data.disponible && data.mensaje) {
            document.getElementById('downloadMsg').value = data.mensaje;
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    } catch { row.classList.add('hidden'); }
}

function copiarMensajeDescarga() {
    const txt = document.getElementById('downloadMsg').value;
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(
        () => showToast('Mensaje + link copiado', 'success'),
        () => showToast('No se pudo copiar', 'error')
    );
}

async function eliminar(id) {
    if (await showConfirm('¿Eliminar este proyecto?', { danger: true })) {
        await apiFetch(`${API_PROY}/${id}`, { method: 'DELETE' });
        cargar();
    }
}

async function toggleEshop(id, actual) {
    await apiFetch(`${API_PROY}/${id}/eshop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicarEshop: !actual })
    });
    cargar();
}

async function marcarVendido(id) {
    await apiFetch(`${API_PROY}/${id}/vender`, { method: 'PATCH' });
    cargar();
}

/* --- Productos digitales / publicar en ML / carga masiva --- */

let soloDigitales = false;

function toggleSoloDigitales() {
    soloDigitales = !soloDigitales;
    const btn = document.getElementById('btnFiltroDigital');
    if (btn) btn.classList.toggle('btn-eshop-on', soloDigitales);
    renderTabla();
}

// Badges de estado para productos digitales (Archivo en Drive / linkeado a ML / listo)
function digitalBadges(p) {
    if (!p.es_digital) return '';
    const archOk = !!p.drive_file_id, mlOk = !!p.ml_id;
    const listo = archOk && mlOk;
    return `<div class="badges-digital">
        <span class="dbadge badge-digital">Digital</span>
        <span class="dbadge ${archOk ? 'badge-ok' : 'badge-no'}">Archivo ${archOk ? '✓' : '✗'}</span>
        <span class="dbadge ${mlOk ? 'badge-ok' : 'badge-no'}">ML ${mlOk ? '✓' : '✗'}</span>
        ${listo ? '<span class="dbadge badge-listo">Listo ✓</span>' : ''}
    </div>`;
}

let publicarMLId = null;

function abrirPublicarML(id) {
    const p = todosProyectos.find(x => x.id === id);
    if (!p) return;
    publicarMLId = id;
    document.getElementById('mlPublishProd').textContent = p.nombre;
    document.getElementById('mlPublishCat').value = '';
    document.getElementById('mlPublishTipo').value = 'gold_special';
    document.getElementById('mlPublishCant').value = p.cantidad > 0 ? p.cantidad : 100;
    document.getElementById('mlPublishPausar').checked = true;
    document.getElementById('mlPublishMsg').textContent = '';
    document.getElementById('btnMlPublishConfirm').disabled = false;
    document.getElementById('mlPublishOverlay').classList.remove('hidden');
}

function cerrarPublicarML() {
    document.getElementById('mlPublishOverlay').classList.add('hidden');
}

async function confirmarPublicarML() {
    const btn = document.getElementById('btnMlPublishConfirm');
    const msg = document.getElementById('mlPublishMsg');
    btn.disabled = true;
    msg.textContent = 'Publicando en Mercado Libre...';
    try {
        const res = await apiFetch(`${API_PROY}/${publicarMLId}/ml-publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId: document.getElementById('mlPublishCat').value.trim() || undefined,
                listingType: document.getElementById('mlPublishTipo').value,
                cantidad: document.getElementById('mlPublishCant').value,
                pausar: document.getElementById('mlPublishPausar').checked,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            msg.textContent = 'Mercado Libre rechazó la publicación: ' + (data.error || 'error desconocido');
            btn.disabled = false;
            return;
        }
        showToast('Publicado en ML' + (data.status === 'paused' ? ' (pausada para revisar)' : ''), 'success');
        cerrarPublicarML();
        cargar();
    } catch (e) {
        msg.textContent = 'Error: ' + e.message;
        btn.disabled = false;
    }
}

async function duplicarProyecto(id) {
    await apiFetch(`${API_PROY}/${id}/duplicar`, { method: 'POST' });
    showToast('Producto duplicado', 'success');
    cargar();
}

function abrirCargaMasiva() {
    document.getElementById('bulkText').value = '';
    document.getElementById('bulkMsg').textContent = '';
    document.getElementById('bulkOverlay').classList.remove('hidden');
}

function cerrarCargaMasiva() {
    document.getElementById('bulkOverlay').classList.add('hidden');
}

async function confirmarCargaMasiva() {
    const txt = document.getElementById('bulkText').value.trim();
    const msg = document.getElementById('bulkMsg');
    if (!txt) { msg.textContent = 'Pegá al menos una línea.'; return; }
    const items = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [nombre, precioVenta, categoria] = l.split(';').map(s => (s || '').trim());
        return { nombre, precioVenta, categoria };
    }).filter(it => it.nombre);
    if (!items.length) { msg.textContent = 'No se reconoció ningún producto.'; return; }
    const res = await apiFetch(`${API_PROY}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = 'Error: ' + (data.error || 'no se pudo'); return; }
    showToast(`${data.creados} productos creados`, 'success');
    cerrarCargaMasiva();
    cargar();
}

/* --- Gestion de carpetas --- */

async function mostrarGestionCarpetas() {
    document.getElementById('catOverlay').classList.remove('hidden');
    await renderCatsAdmin();
}

function cerrarGestionCarpetas() {
    document.getElementById('catOverlay').classList.add('hidden');
}

async function renderCatsAdmin() {
    await cargarCatsGuardadas();
    const container = document.getElementById('listaCatsAdmin');
    container.innerHTML = catsGuardadas.map(c => `
        <div class="cat-admin-item" data-cat="${escapeHTML(c)}">
            <span class="cat-admin-name">${icon('folder')} ${escapeHTML(c)}</span>
            <div>
                <button class="btn-sm btn-renombrar">${icon('pencil')}</button>
                <button class="btn-sm btn-peligro btn-eliminar-cat">${icon('trash')}</button>
            </div>
        </div>
    `).join('');
    container.querySelectorAll('.cat-admin-item').forEach(el => {
        const cat = el.dataset.cat;
        el.querySelector('.btn-renombrar').addEventListener('click', () => renombrarCarpeta(cat));
        el.querySelector('.btn-eliminar-cat').addEventListener('click', () => eliminarCarpeta(cat));
    });
}

async function cargarCatsGuardadas() {
    const res = await apiFetch(API_CAT);
    catsGuardadas = await res.json();
}

async function crearCarpeta() {
    const input = document.getElementById('nuevaCat');
    const nombre = input.value.trim();
    if (!nombre) return;
    const res = await apiFetch(API_CAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre })
    });
    if (!res.ok) { showToast('Ya existe o nombre inválido', 'error'); return; }
    input.value = '';
    await renderCatsAdmin();
    cargar();
}

async function renombrarCarpeta(viejo) {
    const nuevo = await showPrompt('Nuevo nombre:', viejo);
    if (!nuevo || nuevo === viejo) return;
    const res = await apiFetch(`${API_CAT}/${encodeURIComponent(viejo)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nuevo })
    });
    if (!res.ok) { showToast('Error al renombrar', 'error'); return; }
    await renderCatsAdmin();
    if (catActual === viejo) catActual = nuevo;
    cargar();
}

/* --- Ventas --- */

const API_VTA = '/api/ventas';
let todasLasVentas = [];

async function cargarVentas() {
    const res = await apiFetch(API_VTA);
    todasLasVentas = await res.json();
}

/* Filtro por período de la vista Ventas */
let ventasPeriodo = 'todo';

function cambiarPeriodoVentas() {
    ventasPeriodo = document.getElementById('ventaPeriodo').value;
    renderVentas();
}

function ventasFiltradas() {
    if (ventasPeriodo === 'todo') return todasLasVentas;
    const hoy = new Date();
    let desde = '';
    if (ventasPeriodo === 'mes') {
        desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (ventasPeriodo === '30dias') {
        desde = new Date(hoy.getTime() - 30 * 86400000).toISOString().split('T')[0];
    } else if (ventasPeriodo === 'anio') {
        desde = `${hoy.getFullYear()}-01-01`;
    }
    // Las fechas son strings YYYY-MM-DD: se pueden comparar alfabéticamente
    return todasLasVentas.filter(v => (v.fecha || '') >= desde);
}

function renderVentas() {
    const ventas = ventasFiltradas();
    const totalVendidos = ventas.reduce((s, v) => s + (v.cantidad || 0), 0);
    const totalIngresos = ventas.reduce((s, v) => s + (v.cantidad || 0) * (v.precioventa || 0), 0);
    const totalCostos = ventas.reduce((s, v) => s + (v.cantidad || 0) * (v.costo || 0), 0);
    const totalGanancia = totalIngresos - totalCostos;

    document.getElementById('stat-vendidos').textContent = totalVendidos + ' uds';
    document.getElementById('stat-ingresos').textContent = '$' + formatearPrecio(totalIngresos);
    document.getElementById('stat-costos').textContent = '$' + formatearPrecio(totalCostos);
    document.getElementById('stat-ganancia').textContent = '$' + formatearPrecio(totalGanancia);

    const tbody = document.getElementById('tbodyVentas');
    const ordenadas = [...ventas].reverse();
    tbody.innerHTML = ordenadas.map(v => {
        const gan = ((v.precioventa || 0) - (v.costo || 0)) * (v.cantidad || 0);
        return `
            <tr>
                <td data-label="Proyecto">${escapeHTML(v.proyectonombre || 'Sin proyecto')}</td>
                <td data-label="Cant.">${v.cantidad}</td>
                <td data-label="Precio Venta">$${formatearPrecio(v.precioventa || 0)}</td>
                <td data-label="Costo">$${formatearPrecio(v.costo || 0)}</td>
                <td data-label="Ganancia" class="${gan > 0 ? 'text-verde' : gan < 0 ? 'text-rojo' : ''}">$${formatearPrecio(gan)}</td>
                <td data-label="Fecha">${escapeHTML(v.fecha)}</td>
                <td data-label="Acciones"><button class="btn-sm btn-peligro" onclick="eliminarVenta('${v.id}')">${icon('trash')}</button></td>
            </tr>`;
    }).join('') || `
        <tr>
            <td colspan="7">
                <div class="empty-state">
                    ${icon('inbox', 'icon-lg')}
                    <p class="empty-state-title">Sin ventas${ventasPeriodo !== 'todo' ? ' en este período' : ' registradas'}</p>
                    <p class="empty-state-text">${ventasPeriodo !== 'todo' ? 'Probá con otro período.' : 'Presioná "Registrar Venta" para agregar la primera.'}</p>
                </div>
            </td>
        </tr>`;

    document.getElementById('tfootVentas').innerHTML = ventas.length ? `
        <tr class="total-row">
            <td data-label="Proyecto"><strong>TOTAL</strong></td>
            <td data-label="Cant."><strong>${totalVendidos}</strong></td>
            <td data-label="Precio Venta"></td>
            <td data-label="Costo"><strong>$${formatearPrecio(totalCostos)}</strong></td>
            <td data-label="Ganancia" class="${totalGanancia > 0 ? 'text-verde' : totalGanancia < 0 ? 'text-rojo' : ''}"><strong>$${formatearPrecio(totalGanancia)}</strong></td>
            <td data-label="Fecha"></td><td data-label="Acciones"></td>
        </tr>` : '';
}

/* --- Exportar a CSV --- */

function descargarCSV(nombreArchivo, encabezados, filas) {
    const esc = v => {
        const s = String(v == null ? '' : v);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [encabezados, ...filas].map(f => f.map(esc).join(';')).join('\r\n');
    // BOM para que Excel abra bien los acentos
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(a.href);
}

function exportarProyectosCSV() {
    const filas = proyectosFiltrados().map(p => [
        p.nombre, p.codigo, p.categoria, p.estado,
        parseFloat(p.costo) || 0, parseFloat(p.precioventa) || 0,
        parseInt(p.vendidos) || 0, parseInt(p.cantidad) || 0,
        ganancia(p), p.publicareshop ? 'Sí' : 'No', p.ml_id || '', p.fecha || '',
    ]);
    if (!filas.length) { showToast('No hay proyectos para exportar', 'error'); return; }
    descargarCSV(`proyectos-${new Date().toISOString().split('T')[0]}.csv`,
        ['Nombre', 'Código', 'Categoría', 'Estado', 'Costo', 'Precio venta', 'Vendidos', 'Stock', 'Ganancia', 'En tienda', 'ID ML', 'Fecha'], filas);
    showToast(`${filas.length} proyectos exportados`, 'success');
}

function exportarVentasCSV() {
    const filas = ventasFiltradas().map(v => [
        v.proyectonombre || 'Sin proyecto', v.cantidad || 0,
        v.precioventa || 0, v.costo || 0,
        ((v.precioventa || 0) - (v.costo || 0)) * (v.cantidad || 0), v.fecha || '',
    ]);
    if (!filas.length) { showToast('No hay ventas para exportar', 'error'); return; }
    descargarCSV(`ventas-${new Date().toISOString().split('T')[0]}.csv`,
        ['Proyecto', 'Cantidad', 'Precio venta', 'Costo', 'Ganancia', 'Fecha'], filas);
    showToast(`${filas.length} ventas exportadas`, 'success');
}

/* --- Dashboard --- */

function renderDashboard() {
    const totalProyectos = todosProyectos.length;
    const enTienda = todosProyectos.filter(p => p.publicareshop).length;
    const totalVendidos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0), 0);
    const totalIngresos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0) * (v.precioventa || 0), 0);
    const totalCostos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0) * (v.costo || 0), 0);
    const totalGanancia = totalIngresos - totalCostos;
    const cats = [...new Set(todosProyectos.map(p => p.categoria).filter(Boolean))];

    const container = document.getElementById('dashCards');
    if (container) {
        container.innerHTML = `
            <div class="dash-card dash-card-productos">
                <div class="dash-card-icon">${icon('box')}</div>
                <div class="dash-card-label">Productos</div>
                <div class="dash-card-value">${totalProyectos}</div>
                <div class="dash-card-sub">${enTienda} publicados · ${cats.length} categorías</div>
            </div>
            <div class="dash-card dash-card-ventas">
                <div class="dash-card-icon">${icon('check')}</div>
                <div class="dash-card-label">Vendidos</div>
                <div class="dash-card-value">${totalVendidos} uds</div>
                <div class="dash-card-sub">${todasLasVentas.length} ventas registradas</div>
            </div>
            <div class="dash-card dash-card-ingresos">
                <div class="dash-card-icon">${icon('wallet')}</div>
                <div class="dash-card-label">Ingresos</div>
                <div class="dash-card-value">$${formatearPrecio(totalIngresos)}</div>
                <div class="dash-card-sub">Costos: $${formatearPrecio(totalCostos)}</div>
            </div>
            <div class="dash-card dash-card-ganancia">
                <div class="dash-card-icon">${icon('trending-up') || icon('bag')}</div>
                <div class="dash-card-label">Ganancia neta</div>
                <div class="dash-card-value" style="color: ${totalGanancia >= 0 ? 'var(--success)' : 'var(--danger)'}">$${formatearPrecio(Math.abs(totalGanancia))}</div>
                <div class="dash-card-sub">Margen: ${totalIngresos > 0 ? ((totalGanancia / totalIngresos) * 100).toFixed(1) : '0'}%</div>
            </div>
        `;
    }

    // Alertas de stock: publicados en la tienda con stock agotado o bajo (≤ 2)
    const alertas = todosProyectos
        .filter(p => p.publicareshop && !p.es_digital && (parseInt(p.cantidad) || 0) <= 2)
        .sort((a, b) => (parseInt(a.cantidad) || 0) - (parseInt(b.cantidad) || 0));
    const alertBox = document.getElementById('dashAlertas');
    if (alertBox) {
        if (!alertas.length) {
            alertBox.classList.add('hidden');
            alertBox.innerHTML = '';
        } else {
            alertBox.classList.remove('hidden');
            alertBox.innerHTML = `
                <div class="dash-alertas-header">${icon('warning')} Stock bajo en la tienda (${alertas.length})</div>
                ${alertas.map(p => `
                    <div class="dash-alerta-item">
                        <span class="dash-alerta-nombre">${escapeHTML(p.nombre)}</span>
                        ${stockPill(p)}
                        <button class="btn-sm" onclick="editar('${p.id}')">${icon('pencil')} Reponer</button>
                    </div>`).join('')}`;
        }
    }

    // Recent projects (last 5)
    const recent = [...todosProyectos].slice(-5).reverse();
    const body = document.getElementById('dashRecentBody');
    if (body) {
        if (!recent.length) {
            body.innerHTML = `<tr><td colspan="5"><div class="empty-state">${icon('inbox', 'icon-lg')}<p class="empty-state-title">Sin proyectos</p></div></td></tr>`;
        } else {
            body.innerHTML = recent.map(p => {
                const pv = parseFloat(p.precioventa) || 0;
                const estadoClase = ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado';
                return `<tr>
                    <td data-label="Nombre">${escapeHTML(p.nombre)}</td>
                    <td data-label="Categoría">${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : '-'}</td>
                    <td data-label="Precio Vta">${pv ? '$' + formatearPrecio(pv) : '-'}</td>
                    <td data-label="Estado"><span class="estado-badge estado-${estadoClase}">${escapeHTML(p.estado || 'Planificado')}</span></td>
                    <td data-label="Eshop">${p.publicareshop ? '<span style="color:var(--success)">✓ Publicado</span>' : '<span style="color:var(--text-faint)">No</span>'}</td>
                </tr>`;
            }).join('');
        }
    }
}

/* --- Project search --- */

let proySearchTerm = '';

function filtrarProyectos() {
    proySearchTerm = (document.getElementById('proySearch')?.value || '').toLowerCase().trim();
    renderTabla();
}

function cambiarVista(vista) {
    const etiquetas = { dashboard: 'Dashboard', tienda: 'Tienda', proyectos: 'Proyectos', ventas: 'Ventas', calculadora: 'Calculadora' };
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('tab-activo', t.textContent.includes(etiquetas[vista]));
    });
    const vistas = ['Dashboard', 'Tienda', 'Proyectos', 'Ventas', 'Calculadora'];
    vistas.forEach(v => {
        const el = document.getElementById('vista' + v);
        if (el) el.classList.toggle('hidden', v.toLowerCase() !== vista);
    });
    document.getElementById('btnNuevo').classList.toggle('hidden', vista !== 'proyectos');
    if (vista === 'dashboard') renderDashboard();
    if (vista === 'tienda') renderTienda();
    if (vista === 'ventas') renderVentas();
    if (vista === 'calculadora') calcularPrecio();
    if (vista === 'proyectos') renderTabla();
    
    // Add animation
    const vistaEl = document.getElementById('vista' + vista.charAt(0).toUpperCase() + vista.slice(1));
    if (vistaEl) {
        vistaEl.classList.remove('view-enter');
        void vistaEl.offsetWidth;
        vistaEl.classList.add('view-enter');
    }
}


/* --- Calculadora de costos --- */

let ultimoTotalCalculado = 0;

function calcularPrecio() {
    const costoMaterial = parseFloat(document.getElementById('calcCostoMaterial').value) || 0;
    const gramos = parseFloat(document.getElementById('calcGramos').value) || 0;
    const horas = parseFloat(document.getElementById('calcHoras').value) || 0;
    const kwh = parseFloat(document.getElementById('calcKwh').value) || 0;
    const desgastePorHora = parseFloat(document.getElementById('calcDesgaste').value) || 0;

    const energia = (90 / 1000) * kwh * horas;
    const material = (costoMaterial / 1000) * gramos * 1.1;
    const desgaste = horas * desgastePorHora;
    const total = energia + material + desgaste;
    ultimoTotalCalculado = total;

    document.getElementById('calc-energia').textContent = '$' + energia.toFixed(2);
    document.getElementById('calc-material').textContent = '$' + material.toFixed(2);
    document.getElementById('calc-desgaste').textContent = '$' + desgaste.toFixed(2);
    document.getElementById('calc-total').textContent = '$' + total.toFixed(2);
}

function usarComoCosto() {
    document.getElementById('formTitle').textContent = 'Nuevo Proyecto';
    document.getElementById('projectForm').reset();
    document.getElementById('editId').value = '';
    document.getElementById('costo').value = ultimoTotalCalculado.toFixed(2);
    const marca = document.getElementById('calcMarca').value.trim();
    if (marca) document.getElementById('nombre').value = marca;
    cambiarVista('proyectos');
    document.getElementById('formOverlay').classList.remove('hidden');
}

/* --- Formulario de ventas --- */

function mostrarFormVenta() {
    const select = document.getElementById('ventaProyecto');
    select.innerHTML = '<option value="">-- Seleccionar --</option>' +
        todosProyectos.map(p => `<option value="${p.id}" data-costo="${p.costo || 0}" data-precio="${p.precioventa || 0}" data-nombre="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.codigo)})</option>`).join('');
    document.getElementById('ventaCantidad').value = '1';
    document.getElementById('ventaPrecio').value = '';
    document.getElementById('ventaCosto').value = '';
    document.getElementById('ventaGananciaPreview').textContent = '$0';
    document.getElementById('ventaOverlay').classList.remove('hidden');
}

function cerrarFormVenta() {
    document.getElementById('ventaOverlay').classList.add('hidden');
}

function cargarCostoVenta() {
    const sel = document.getElementById('ventaProyecto');
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.costo) {
        document.getElementById('ventaCosto').value = opt.dataset.costo;
    }
    if (opt && parseFloat(opt.dataset.precio) > 0) {
        document.getElementById('ventaPrecio').value = opt.dataset.precio;
    }
    calcGananciaVenta();
}

function calcGananciaVenta() {
    const cant = parseInt(document.getElementById('ventaCantidad').value) || 0;
    const pv = parseFloat(document.getElementById('ventaPrecio').value) || 0;
    const costo = parseFloat(document.getElementById('ventaCosto').value) || 0;
    const gan = (pv - costo) * cant;
    document.getElementById('ventaGananciaPreview').textContent = '$' + gan.toFixed(2);
}

document.getElementById('ventaForm').onsubmit = async (e) => {
    e.preventDefault();
    const sel = document.getElementById('ventaProyecto');
    const opt = sel.options[sel.selectedIndex];
    const data = {
        proyectoId: sel.value,
        proyectoNombre: opt && opt.dataset.nombre ? opt.dataset.nombre : 'Venta directa',
        cantidad: document.getElementById('ventaCantidad').value,
        precioVenta: document.getElementById('ventaPrecio').value,
        costo: document.getElementById('ventaCosto').value,
    };
    await apiFetch(API_VTA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    cerrarFormVenta();
    await cargarVentas();
    renderVentas();
};

async function eliminarVenta(id) {
    if (await showConfirm('¿Eliminar esta venta?', { danger: true })) {
        await apiFetch(`${API_VTA}/${id}`, { method: 'DELETE' });
        await cargarVentas();
        renderVentas();
    }
}

async function eliminarCarpeta(nombre) {
    if (!(await showConfirm(`¿Eliminar carpeta "${nombre}"? Los proyectos perderán esta categoría.`, { danger: true }))) return;
    await apiFetch(`${API_CAT}/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
    if (catActual === nombre) catActual = '';
    await renderCatsAdmin();
    cargar();
}

/* --- Mercado Libre --- */

async function checkMLStatus() {
    const mlStatus = document.getElementById('mlStatus');
    if (!mlStatus) return;
    try {
        const res = await fetch('/api/ml/status');
        const data = await res.json();
        const dot = mlStatus.querySelector('.ml-dot');
        const label = document.getElementById('mlLabel');
        const btnConectar = document.getElementById('btnConectarML');
        const btnImportar = document.getElementById('btnImportarML');
        const btnDesconectar = document.getElementById('btnDesconectarML');
        if (data.connected) {
            dot.className = 'ml-dot ml-connected';
            label.textContent = 'ML conectado';
            btnConectar.classList.add('hidden');
            btnImportar.classList.remove('hidden');
            btnDesconectar.classList.remove('hidden');
        } else {
            dot.className = 'ml-dot ml-disconnected';
            label.textContent = 'ML desconectado';
            btnConectar.classList.remove('hidden');
            btnImportar.classList.add('hidden');
            btnDesconectar.classList.add('hidden');
        }
    } catch {
        // ignore
    }
}

function conectarML() {
    window.location.href = '/api/ml/auth';
}

async function desconectarML() {
    if (!(await showConfirm('¿Desconectar Mercado Libre?'))) return;
    try {
        await apiFetch('/api/ml/disconnect', { method: 'POST' });
        checkMLStatus();
    } catch {
        // ignore
    }
}

async function importarML() {
    const btn = document.getElementById('btnImportarML');
    btn.disabled = true;
    btn.textContent = 'Importando...';
    try {
        const res = await apiFetch('/api/ml/import', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al importar');
        const partes = [];
        if (data.importados > 0) partes.push(`${data.importados} nuevas importadas`);
        if (data.actualizados > 0) partes.push(`${data.actualizados} existentes actualizadas`);
        const msg = partes.length ? partes.join(', ') + '. Las activas en ML se publicaron en la tienda.' : 'No hay publicaciones nuevas para importar.';
        showToast(msg, 'success');
        const resP = await apiFetch(API_PROY);
        todosProyectos = await resP.json();
        renderSidebar();
        renderTabla();
    } catch (err) {
        showToast('Error al importar: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Importar publicaciones';
    }
}

cargar();
