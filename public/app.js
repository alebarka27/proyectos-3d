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
        const [resP, resC, resV, resE] = await Promise.all([apiFetch(API_PROY), apiFetch(API_CAT), apiFetch(API_VTA), apiFetch(API_ENC)]);
        todosProyectos = await resP.json();
        catsGuardadas = await resC.json();
        todasLasVentas = await resV.json();
        todosEncargos = await resE.json();
        renderSidebar();
        renderTabla();
        checkMLStatus();
        if (detalleId) renderDetalle();
    }

    // Tras una acción (guardar, vender, etc.) se recarga quedándose en la vista
    // actual; solo la primera carga elige la vista inicial.
    cambiarVista(vistaActual || (authed ? 'dashboard' : 'tienda'));
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

    // Modo "cola de impresión": mismas búsquedas/filtros, otra presentación
    const enCola = modoProyectos === 'cola';
    document.querySelector('#vistaProyectos .tabla-scroll').classList.toggle('hidden', enCola);
    document.getElementById('colaImpresion').classList.toggle('hidden', !enCola);
    if (enCola) {
        renderCola(filtrados);
        const countEl = document.getElementById('proyCount');
        if (countEl) countEl.textContent = `${filtrados.length} de ${todosProyectos.length} proyectos`;
        return;
    }

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
        const archivos = parseArchivos(p);
        return `
            <tr data-id="${p.id}" class="proy-row" title="Ver detalle del proyecto">
                <td data-label="Nombre">${escapeHTML(p.nombre)}</td>
                <td data-label="Código">${escapeHTML(p.codigo)}</td>
                <td data-label="Categoría">${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : '-'}</td>
                <td data-label="Archivos">${archivos.length ? `<span class="arch-count">${icon('link-external')} ${archivos.length}</span>` : '-'}</td>
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

/* --- Cola de impresión (proyectos como tablero por estado) --- */

let modoProyectos = 'tabla';

function toggleModoProyectos() {
    modoProyectos = modoProyectos === 'tabla' ? 'cola' : 'tabla';
    const btn = document.getElementById('btnModoProyectos');
    btn.textContent = modoProyectos === 'cola' ? 'Ver tabla' : 'Cola de impresión';
    btn.classList.toggle('btn-eshop-on', modoProyectos === 'cola');
    renderTabla();
}

function renderCola(filtrados) {
    const cont = document.getElementById('colaImpresion');
    cont.innerHTML = ESTADOS_VALIDOS.map(est => {
        const idx = ESTADOS_VALIDOS.indexOf(est);
        const grupo = filtrados.filter(p => (ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado') === est);
        return `
            <div class="cola-col">
                <div class="cola-col-header">
                    <span class="estado-badge estado-${est}">${est}</span>
                    <span class="carpeta-count">${grupo.length}</span>
                </div>
                ${grupo.map(p => {
                    const foto = mlGridImage(fotosArray(p.fotos)[0]);
                    const sub = [p.filamento, p.colores_usados].filter(Boolean).join(' · ');
                    return `
                    <div class="cola-card" data-id="${p.id}" title="Ver detalle">
                        ${foto && /^https?:\/\//i.test(foto)
                            ? `<img src="${escapeHTML(foto)}" alt="" loading="lazy" onerror="this.remove()">`
                            : `<div class="cola-card-ph">${icon('printer')}</div>`}
                        <div class="cola-card-info">
                            <div class="cola-card-nombre">${escapeHTML(p.nombre)}</div>
                            ${sub ? `<div class="cola-card-sub">${escapeHTML(sub)}</div>` : ''}
                        </div>
                        <div class="cola-card-btns">
                            ${idx > 0 ? `<button class="btn-sm" title="Volver a ${ESTADOS_VALIDOS[idx - 1]}" onclick="moverEstado('${p.id}', -1)">←</button>` : ''}
                            ${idx < ESTADOS_VALIDOS.length - 1 ? `<button class="btn-sm" title="Pasar a ${ESTADOS_VALIDOS[idx + 1]}" onclick="moverEstado('${p.id}', 1)">→</button>` : ''}
                        </div>
                    </div>`;
                }).join('') || '<p class="cola-vacia">Nada por acá</p>'}
            </div>`;
    }).join('');
    cont.querySelectorAll('.cola-card').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            abrirDetalle(el.dataset.id);
        });
    });
}

async function moverEstado(id, dir) {
    const p = todosProyectos.find(x => x.id === id);
    if (!p) return;
    const idx = ESTADOS_VALIDOS.indexOf(ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado');
    const nuevo = ESTADOS_VALIDOS[Math.min(ESTADOS_VALIDOS.length - 1, Math.max(0, idx + dir))];
    if (nuevo === p.estado) return;
    const res = await apiFetch(`${API_PROY}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bodyDesdeProyecto(p), estado: nuevo }),
    });
    if (!res.ok) { showToast('No se pudo cambiar el estado', 'error'); return; }
    const actualizado = await res.json();
    const i = todosProyectos.findIndex(x => x.id === id);
    if (i !== -1) todosProyectos[i] = actualizado;
    renderTabla();
    if (detalleId) renderDetalle();
}

// Desglose de la calculadora a adjuntar al crear un proyecto desde ahí
// (null = no tocar el desglose guardado del proyecto)
let formCalcDesglose = null;

document.getElementById('btnNuevo').onclick = () => {
    document.getElementById('formTitle').textContent = 'Nuevo Proyecto';
    document.getElementById('projectForm').reset();
    document.getElementById('editId').value = '';
    formCalcDesglose = null;
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
        costo: document.getElementById('costo').value,
        precioVenta: document.getElementById('precioVenta').value,
        vendidos: document.getElementById('vendidos').value,
        cantidad: document.getElementById('cantidad').value,
        mlId: document.getElementById('mlId').value.trim(),
        fotos: document.getElementById('fotos').value,
        estado: document.getElementById('estado').value,
        descripcion: document.getElementById('descripcion').value,
        filamento: document.getElementById('filamento').value,
        coloresUsados: document.getElementById('coloresUsados').value,
        notasImpresion: document.getElementById('notasImpresion').value,
        destacado: document.getElementById('destacadoCheck').checked,
        publicarEshop: document.getElementById('publicarEshop').checked,
    };
    if (formCalcDesglose) data.calcDesglose = JSON.stringify(formCalcDesglose);
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
    document.getElementById('costo').value = p.costo || '';
    document.getElementById('precioVenta').value = p.precioventa || '';
    document.getElementById('vendidos').value = p.vendidos || '';
    document.getElementById('cantidad').value = p.cantidad || '';
    document.getElementById('mlId').value = p.ml_id || '';
    document.getElementById('fotos').value = p.fotos || '';
    document.getElementById('descripcion').value = p.descripcion || '';
    document.getElementById('filamento').value = p.filamento || '';
    document.getElementById('coloresUsados').value = p.colores_usados || '';
    document.getElementById('notasImpresion').value = p.notas_impresion || '';
    document.getElementById('destacadoCheck').checked = !!p.destacado;
    document.getElementById('estado').value = p.estado || 'Planificado';
    document.getElementById('publicarEshop').checked = !!p.publicareshop;
    formCalcDesglose = null;
    document.getElementById('formOverlay').classList.remove('hidden');
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

/* --- Detalle de proyecto (se abre al tocar una fila) ---
   Muestra toda la info del proyecto y permite administrar la lista de
   archivos para imprimir el modelo (links con nombre, p. ej. a Drive). */

let detalleId = null;

// La columna `archivos` guarda un JSON [{nombre, url}]; parse defensivo.
function parseArchivos(p) {
    try {
        const lista = JSON.parse(p.archivos || '[]');
        return Array.isArray(lista) ? lista.filter(a => a && a.url) : [];
    } catch { return []; }
}

// Body camelCase para PUT a partir de una fila de la DB (nombres en minúsculas).
function bodyDesdeProyecto(p) {
    return {
        nombre: p.nombre, codigo: p.codigo, categoria: p.categoria,
        costo: p.costo, precioVenta: p.precioventa, vendidos: p.vendidos,
        cantidad: p.cantidad, mlId: p.ml_id, fotos: p.fotos,
        estado: p.estado, descripcion: p.descripcion,
        destacado: !!p.destacado, publicarEshop: !!p.publicareshop,
        filamento: p.filamento || '', coloresUsados: p.colores_usados || '',
        notasImpresion: p.notas_impresion || '',
    };
}

function abrirDetalle(id) {
    detalleId = id;
    if (!renderDetalle()) return;
    document.getElementById('detalleOverlay').classList.remove('hidden');
}

function cerrarDetalle() {
    detalleId = null;
    document.getElementById('detalleOverlay').classList.add('hidden');
}

function renderDetalle() {
    const p = todosProyectos.find(x => x.id === detalleId);
    if (!p) { cerrarDetalle(); return false; }

    const fotos = fotosArray(p.fotos).map(mlHighResImage);
    const galeria = fotos.length ? `
        <div class="det-gallery-main"><img id="detFotoMain" src="${escapeHTML(safeHref(fotos[0]))}" alt="${escapeHTML(p.nombre)}" onerror="imgFallback(this)"></div>
        ${fotos.length > 1 ? `<div class="det-thumbs">${fotos.map((f, i) =>
            `<img src="${escapeHTML(safeHref(f))}" class="${i === 0 ? 'active' : ''}" alt="Foto ${i + 1}" onclick="detalleCambiarFoto(this, '${escapeHTML(safeHref(f))}')" onerror="this.remove()">`).join('')}</div>` : ''}`
        : `<div class="det-gallery-main"><div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div></div>`;

    const costo = parseFloat(p.costo) || 0;
    const pv = parseFloat(p.precioventa) || 0;
    const stock = parseInt(p.cantidad) || 0;
    const estadoClase = ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado';
    const mlUrl = urlML(p.ml_id);
    const archivos = parseArchivos(p);

    const dato = (label, valor) => `<div class="det-item"><span class="det-label">${label}</span><span class="det-value">${valor}</span></div>`;

    document.getElementById('detalleModal').innerHTML = `
        <div class="det-header">
            <div>
                <h2>${escapeHTML(p.nombre)}</h2>
                <div class="det-header-badges">
                    <span class="estado-badge estado-${estadoClase}">${escapeHTML(p.estado || 'Planificado')}</span>
                    ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                    ${p.destacado ? '<span class="cat-badge">★ Destacado</span>' : ''}
                </div>
            </div>
            <button class="btn-sm det-cerrar" onclick="cerrarDetalle()" title="Cerrar">${icon('close')}</button>
        </div>
        <div class="det-body">
            <div class="det-gallery">${galeria}</div>
            <div class="det-info">
                <div class="det-grid">
                    ${dato('Código', escapeHTML(p.codigo || '-'))}
                    ${dato('Fecha', escapeHTML(p.fecha || '-'))}
                    ${dato('Costo', costo ? '$' + formatearPrecio(costo) : '-')}
                    ${dato('Precio venta', pv ? '$' + formatearPrecio(pv) : '-')}
                    ${dato('Ganancia por unidad', pv || costo ? '$' + formatearPrecio(pv - costo) : '-')}
                    ${dato('Stock', stockPill(p))}
                    ${dato('Vendidos', parseInt(p.vendidos) || 0)}
                    ${dato('En la tienda', p.publicareshop ? '<span class="text-verde">Sí, publicado</span>' : 'No')}
                    ${dato('Mercado Libre', mlUrl ? `<a href="${mlUrl}" target="_blank" rel="noopener noreferrer">${icon('link-external')} Ver publicación</a>` : 'No publicado')}
                </div>
                ${p.descripcion ? `<div class="det-desc"><span class="det-label">Descripción</span><p>${escapeHTML(p.descripcion).replace(/\n/g, '<br>')}</p></div>` : ''}
            </div>
        </div>
        ${fichaImpresionHTML(p)}
        <div class="det-archivos">
            <h3>${icon('printer')} Archivos para imprimir <span class="proy-count">${archivos.length || 'ninguno'}</span></h3>
            ${archivos.length ? `<div class="arch-lista">${archivos.map((a, i) => `
                <div class="arch-item">
                    <a href="${escapeHTML(safeHref(a.url))}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(a.url)}">${icon('link-external')} ${escapeHTML(a.nombre || a.url)}</a>
                    <div class="arch-item-btns">
                        <button class="btn-sm" title="Copiar link" onclick="copiarLinkArchivo(${i})">${icon('clipboard')}</button>
                        <button class="btn-sm btn-peligro" title="Quitar de la lista" onclick="eliminarArchivo(${i})">${icon('trash')}</button>
                    </div>
                </div>`).join('')}</div>`
            : `<p class="muted">Guardá acá los links a los archivos del modelo (STL, 3MF, gcode) — por ejemplo los de tu Drive.</p>`}
            <div class="arch-add">
                <input type="text" id="archNombre" placeholder="Nombre (ej: STL base, gcode 0.2mm)">
                <input type="url" id="archUrl" placeholder="Link al archivo (Drive, etc.)">
                <button class="btn-primary" onclick="agregarArchivo()">${icon('plus')} Agregar</button>
            </div>
        </div>
        <div class="det-actions">
            <button class="btn-primary" onclick="cerrarDetalle(); editar('${p.id}')">${icon('pencil')} Editar</button>
            ${stock > 0 ? `<button class="btn-secondary" onclick="venderRapido('${p.id}')">${icon('cart')} Venta rápida</button>` : ''}
            <button class="btn-secondary" onclick="duplicarProyecto('${p.id}')">${icon('clipboard')} Duplicar</button>
            <button class="btn-secondary btn-peligro" onclick="eliminar('${p.id}')">${icon('trash')} Eliminar</button>
        </div>`;
    return true;
}

// Seccion "Ficha de impresión" del detalle: filamento, colores usados,
// notas privadas y el desglose guardado de la calculadora (si existe).
function fichaImpresionHTML(p) {
    let desglose = null;
    try { desglose = p.calc_desglose ? JSON.parse(p.calc_desglose) : null; } catch { desglose = null; }
    const tieneAlgo = p.filamento || p.colores_usados || p.notas_impresion || desglose;

    const dato = (label, valor) => `<div class="det-item"><span class="det-label">${label}</span><span class="det-value">${valor}</span></div>`;
    let items = '';
    if (p.filamento) items += dato('Filamento', escapeHTML(p.filamento));
    if (p.colores_usados) items += dato('Colores usados', `${coloresChips(p.colores_usados)}<span class="ficha-colores-txt">${escapeHTML(p.colores_usados)}</span>`);
    if (desglose) {
        const extras = (Array.isArray(desglose.extras) ? desglose.extras : []);
        const partes = [];
        if (parseFloat(desglose.gramos)) partes.push(`${desglose.gramos} g`);
        if (parseFloat(desglose.horas)) partes.push(`${desglose.horas} h de impresión`);
        if (extras.length) partes.push(extras.map(e => escapeHTML(e.nombre)).join(', '));
        if (partes.length) items += dato('Cálculo guardado', partes.join(' · '));
    }

    return `
        <div class="det-ficha">
            <h3>${icon('sliders')} Ficha de impresión</h3>
            ${tieneAlgo ? `
                ${items ? `<div class="det-grid">${items}</div>` : ''}
                ${p.notas_impresion ? `<div class="det-desc"><span class="det-label">Detalles</span><p>${escapeHTML(p.notas_impresion).replace(/\n/g, '<br>')}</p></div>` : ''}`
            : `<p class="muted">Sin datos de impresión todavía — cargá filamento, colores y detalles desde "Editar".</p>`}
        </div>`;
}

function detalleCambiarFoto(el, src) {
    const main = document.getElementById('detFotoMain');
    if (main) main.src = src;
    document.querySelectorAll('.det-thumbs img').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

// Guarda la lista de archivos vía PUT y actualiza la copia local del proyecto.
async function guardarArchivos(p, lista) {
    const body = { ...bodyDesdeProyecto(p), archivos: lista };
    const res = await apiFetch(`${API_PROY}/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'No se pudo guardar el archivo', 'error');
        return false;
    }
    const actualizado = await res.json();
    const idx = todosProyectos.findIndex(x => x.id === p.id);
    if (idx !== -1) todosProyectos[idx] = actualizado;
    renderDetalle();
    renderTabla();
    return true;
}

async function agregarArchivo() {
    const p = todosProyectos.find(x => x.id === detalleId);
    if (!p) return;
    const nombre = document.getElementById('archNombre').value.trim();
    const url = document.getElementById('archUrl').value.trim();
    if (!url) { showToast('Pegá el link al archivo', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) { showToast('El link tiene que empezar con http:// o https://', 'error'); return; }
    const lista = [...parseArchivos(p), { nombre: nombre || 'Archivo', url }];
    if (await guardarArchivos(p, lista)) showToast('Archivo agregado', 'success');
}

async function eliminarArchivo(i) {
    const p = todosProyectos.find(x => x.id === detalleId);
    if (!p) return;
    const lista = parseArchivos(p);
    const arch = lista[i];
    if (!arch) return;
    if (!(await showConfirm(`¿Quitar "${arch.nombre || arch.url}" de la lista? El archivo en sí no se borra, solo el link.`, { danger: true, confirmLabel: 'Quitar' }))) return;
    lista.splice(i, 1);
    if (await guardarArchivos(p, lista)) showToast('Link quitado', 'success');
}

function copiarLinkArchivo(i) {
    const p = todosProyectos.find(x => x.id === detalleId);
    const arch = p && parseArchivos(p)[i];
    if (!arch) return;
    navigator.clipboard.writeText(arch.url).then(
        () => showToast('Link copiado', 'success'),
        () => showToast('No se pudo copiar', 'error')
    );
}

// Toda la fila abre el detalle, salvo que el click sea en un botón o link.
document.getElementById('tbody').addEventListener('click', e => {
    if (e.target.closest('button, a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) abrirDetalle(tr.dataset.id);
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && detalleId) cerrarDetalle();
});

/* --- Publicar en ML / carga masiva --- */

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
const API_ENC = '/api/encargos';
let todosEncargos = [];

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
        .filter(p => p.publicareshop && (parseInt(p.cantidad) || 0) <= 2)
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

    renderDashEncargos();
    renderDashChart();

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

// Widget del dashboard: encargos activos ordenados por fecha de entrega
function renderDashEncargos() {
    const box = document.getElementById('dashEncargos');
    if (!box) return;
    const activos = todosEncargos.filter(esEncargoActivo)
        .sort((a, b) => (a.fecha_entrega || '9999') < (b.fecha_entrega || '9999') ? -1 : 1);
    if (!activos.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `
        <div class="dash-encargos-header">
            ${icon('box')} Encargos activos (${activos.length})
            <button class="btn-sm" onclick="cambiarVista('encargos')">Ver todos</button>
        </div>
        ${activos.slice(0, 5).map(e => {
            const items = parseItemsEncargo(e);
            const resumen = e.detalle || items.map(it => `${it.cantidad}× ${it.nombre}`).join(', ');
            return `
            <div class="dash-encargo-item">
                <span class="dash-encargo-nombre"><strong>${escapeHTML(e.cliente || 'Sin nombre')}</strong> — ${escapeHTML(resumen)}</span>
                ${chipEntrega(e)}
                ${badgeEncargo(e.estado)}
            </div>`;
        }).join('')}`;
}

/* --- Gráfico de ventas por mes (barras apiladas: costos + ganancia = ingresos) --- */

function renderDashChart() {
    const card = document.getElementById('dashChartCard');
    if (!card) return;
    if (!todasLasVentas.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    // Últimos 6 meses, incluidos los que no tuvieron ventas
    const meses = [];
    const hoy = new Date();
    for (let i = 5; i >= 0; i--) {
        const m = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
        meses.push({
            key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
            label: m.toLocaleDateString('es-AR', { month: 'short' }).replace('.', ''),
        });
    }
    const porMes = Object.fromEntries(meses.map(m => [m.key, { ingresos: 0, costos: 0 }]));
    for (const v of todasLasVentas) {
        const key = (v.fecha || '').slice(0, 7);
        if (porMes[key]) {
            porMes[key].ingresos += (v.cantidad || 0) * (v.precioventa || 0);
            porMes[key].costos += (v.cantidad || 0) * (v.costo || 0);
        }
    }

    const H = 140; // alto en px de la barra del mes más alto
    const max = Math.max(...meses.map(m => porMes[m.key].ingresos), 1);
    const ultimoConVentas = [...meses].reverse().find(m => porMes[m.key].ingresos > 0);

    document.getElementById('dashChart').innerHTML = meses.map(m => {
        const d = porMes[m.key];
        const ganReal = d.ingresos - d.costos;
        const gan = Math.max(0, ganReal);
        const hGan = Math.round((gan / max) * H);
        const hCos = Math.round((d.costos / max) * H);
        const esUltimo = ultimoConVentas && m.key === ultimoConVentas.key;
        return `
            <div class="dash-bar-col" tabindex="0">
                <div class="dash-bar-tip" role="tooltip">
                    <strong>${m.label} · $${formatearPrecio(d.ingresos)}</strong>
                    <span><span class="dash-legend-dot" style="background:#16a34a"></span>Ganancia $${formatearPrecio(ganReal)}</span>
                    <span><span class="dash-legend-dot" style="background:#3b82f6"></span>Costos $${formatearPrecio(d.costos)}</span>
                </div>
                ${esUltimo ? `<span class="dash-bar-total">$${formatearPrecio(d.ingresos)}</span>` : ''}
                <div class="dash-bar-stack" style="height:${H}px">
                    ${hGan ? `<div class="dash-bar-seg dash-bar-gan" style="height:${hGan}px"></div>` : ''}
                    ${hCos ? `<div class="dash-bar-seg dash-bar-cos" style="height:${hCos}px"></div>` : ''}
                </div>
                <span class="dash-bar-label">${m.label}</span>
            </div>`;
    }).join('');
}

/* --- Project search --- */

let proySearchTerm = '';

function filtrarProyectos() {
    proySearchTerm = (document.getElementById('proySearch')?.value || '').toLowerCase().trim();
    renderTabla();
}

let vistaActual = '';

function cambiarVista(vista) {
    const repetida = vista === vistaActual;
    vistaActual = vista;
    const etiquetas = { dashboard: 'Dashboard', tienda: 'Tienda', proyectos: 'Proyectos', encargos: 'Encargos', ventas: 'Ventas', calculadora: 'Calculadora' };
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('tab-activo', t.textContent.includes(etiquetas[vista]));
    });
    const vistas = ['Dashboard', 'Tienda', 'Proyectos', 'Encargos', 'Ventas', 'Calculadora'];
    vistas.forEach(v => {
        const el = document.getElementById('vista' + v);
        if (el) el.classList.toggle('hidden', v.toLowerCase() !== vista);
    });
    document.getElementById('btnNuevo').classList.toggle('hidden', vista !== 'proyectos');
    if (vista === 'dashboard') renderDashboard();
    if (vista === 'tienda') renderTienda();
    if (vista === 'encargos') renderEncargos();
    if (vista === 'ventas') renderVentas();
    if (vista === 'calculadora') calcularPrecio();
    if (vista === 'proyectos') renderTabla();
    
    // Animación de entrada solo al cambiar de vista (no al recargar la misma)
    const vistaEl = document.getElementById('vista' + vista.charAt(0).toUpperCase() + vista.slice(1));
    if (vistaEl && !repetida) {
        vistaEl.classList.remove('view-enter');
        void vistaEl.offsetWidth;
        vistaEl.classList.add('view-enter');
    }
}


/* --- Calculadora de costos --- */

let ultimoTotalCalculado = 0;
let ultimoPrecioCalculadora = 0;
let calcExtras = [];

// Los valores de configuración (material, kWh, desgaste) se recuerdan entre
// sesiones para no tener que recargarlos cada vez.
const CALC_CONFIG_KEY = 'calc-config';

function cargarConfigCalculadora() {
    try {
        const cfg = JSON.parse(localStorage.getItem(CALC_CONFIG_KEY) || '{}');
        if (cfg.costoMaterial) document.getElementById('calcCostoMaterial').value = cfg.costoMaterial;
        if (cfg.kwh) document.getElementById('calcKwh').value = cfg.kwh;
        if (cfg.desgaste) document.getElementById('calcDesgaste').value = cfg.desgaste;
    } catch { /* config rota: quedan los defaults del HTML */ }
}

function guardarConfigCalculadora() {
    try {
        localStorage.setItem(CALC_CONFIG_KEY, JSON.stringify({
            costoMaterial: document.getElementById('calcCostoMaterial').value,
            kwh: document.getElementById('calcKwh').value,
            desgaste: document.getElementById('calcDesgaste').value,
        }));
    } catch { /* localStorage lleno o bloqueado: no pasa nada */ }
}

function agregarExtra() {
    const nombreEl = document.getElementById('extraNombre');
    const costoEl = document.getElementById('extraCosto');
    const costo = parseFloat(costoEl.value);
    if (isNaN(costo) || costo < 0) { showToast('Poné el costo del extra', 'error'); costoEl.focus(); return; }
    calcExtras.push({ nombre: nombreEl.value.trim() || 'Extra', costo });
    nombreEl.value = '';
    costoEl.value = '';
    nombreEl.focus();
    renderExtras();
    calcularPrecio();
}

function quitarExtra(i) {
    calcExtras.splice(i, 1);
    renderExtras();
    calcularPrecio();
}

function renderExtras() {
    document.getElementById('calcExtrasLista').innerHTML = calcExtras.map((e, i) => `
        <div class="calc-extra-item">
            <span class="calc-extra-nombre">${escapeHTML(e.nombre)}</span>
            <span class="calc-extra-costo">$${formatearPrecio(e.costo)}</span>
            <button type="button" class="btn-sm btn-peligro" title="Quitar extra" onclick="quitarExtra(${i})">${icon('trash')}</button>
        </div>`).join('');
}

// Propone un precio a partir del costo total, redondeado a la centena
// para que quede un número "de vidriera".
function sugerirPrecio(mult) {
    if (!ultimoTotalCalculado) { showToast('Cargá primero los costos (gramos, horas...)', 'error'); return; }
    document.getElementById('calcPrecioVenta').value = Math.ceil((ultimoTotalCalculado * mult) / 100) * 100;
    calcularPrecio();
}

function calcularPrecio() {
    const costoMaterial = parseFloat(document.getElementById('calcCostoMaterial').value) || 0;
    const gramos = parseFloat(document.getElementById('calcGramos').value) || 0;
    const horas = parseFloat(document.getElementById('calcHoras').value) || 0;
    const kwh = parseFloat(document.getElementById('calcKwh').value) || 0;
    const desgastePorHora = parseFloat(document.getElementById('calcDesgaste').value) || 0;

    const energia = (90 / 1000) * kwh * horas;
    const material = (costoMaterial / 1000) * gramos * 1.1;
    const desgaste = horas * desgastePorHora;
    const extras = calcExtras.reduce((s, e) => s + e.costo, 0);
    const total = energia + material + desgaste + extras;
    ultimoTotalCalculado = total;

    document.getElementById('calc-energia').textContent = '$' + formatearPrecio(energia);
    document.getElementById('calc-material').textContent = '$' + formatearPrecio(material);
    document.getElementById('calc-desgaste').textContent = '$' + formatearPrecio(desgaste);
    document.getElementById('calc-extras').textContent = '$' + formatearPrecio(extras);
    document.getElementById('calc-total').textContent = '$' + formatearPrecio(total);

    // Ganancia = precio elegido - costo total
    const pv = parseFloat(document.getElementById('calcPrecioVenta').value) || 0;
    ultimoPrecioCalculadora = pv;
    const ganancia = pv - total;
    const box = document.getElementById('calcGananciaBox');
    const ganEl = document.getElementById('calc-ganancia');
    const margenEl = document.getElementById('calc-margen');
    if (!pv) {
        box.className = 'calc-ganancia';
        ganEl.textContent = '—';
        margenEl.textContent = 'Poné un precio (o tocá una sugerencia) para ver cuánto te queda';
    } else {
        box.className = 'calc-ganancia ' + (ganancia > 0 ? 'ganancia-ok' : 'ganancia-mal');
        ganEl.textContent = (ganancia < 0 ? '-$' : '$') + formatearPrecio(Math.abs(ganancia));
        margenEl.textContent = ganancia >= 0
            ? `Te queda el ${Math.round((ganancia / pv) * 100)}% del precio`
            : 'Estás vendiendo a pérdida';
    }

    guardarConfigCalculadora();
}

function usarComoCosto() {
    document.getElementById('formTitle').textContent = 'Nuevo Proyecto';
    document.getElementById('projectForm').reset();
    document.getElementById('editId').value = '';
    document.getElementById('costo').value = ultimoTotalCalculado.toFixed(2);
    if (ultimoPrecioCalculadora > 0) document.getElementById('precioVenta').value = ultimoPrecioCalculadora;
    const marca = document.getElementById('calcMarca').value.trim();
    if (marca) document.getElementById('filamento').value = marca;
    // El proyecto guarda el desglose del cálculo para poder recalcular el
    // costo más adelante cuando cambie el precio del filamento
    formCalcDesglose = {
        gramos: parseFloat(document.getElementById('calcGramos').value) || 0,
        horas: parseFloat(document.getElementById('calcHoras').value) || 0,
        extras: calcExtras.map(e => ({ nombre: e.nombre, costo: e.costo })),
    };
    cambiarVista('proyectos');
    document.getElementById('formOverlay').classList.remove('hidden');
}

// Recalcula el costo de todos los proyectos que guardaron desglose, usando
// los precios actuales de la calculadora (material, kWh, desgaste).
async function recalcularCostos() {
    const costoKg = parseFloat(document.getElementById('calcCostoMaterial').value) || 0;
    const kwh = parseFloat(document.getElementById('calcKwh').value) || 0;
    const desgaste = parseFloat(document.getElementById('calcDesgaste').value) || 0;
    const ok = await showConfirm(
        `Se recalcula el costo de todos los proyectos creados desde la calculadora con estos valores: material $${formatearPrecio(costoKg)}/kg, energía $${formatearPrecio(kwh)}/kWh, desgaste $${formatearPrecio(desgaste)}/h. ¿Seguir?`,
        { title: 'Recalcular costos', confirmLabel: 'Recalcular' }
    );
    if (!ok) return;
    const res = await apiFetch(`${API_PROY}/recalcular-costos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costoMaterialKg: costoKg, kwh, desgasteHora: desgaste }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'No se pudo recalcular', 'error'); return; }
    if (!data.conDesglose) {
        showToast('Ningún proyecto tiene desglose guardado todavía. Los que crees desde la calculadora lo van a guardar solos.', 'info', 7000);
        return;
    }
    showToast(data.actualizados
        ? `Costos actualizados: ${data.actualizados} de ${data.conDesglose} proyectos`
        : `Los ${data.conDesglose} proyectos con desglose ya estaban al día`, 'success', 6000);
    if (data.actualizados) cargar();
}

// Enter en los campos de extra = agregarlo (más rápido que ir al botón)
['extraNombre', 'extraCosto'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); agregarExtra(); }
    });
});

cargarConfigCalculadora();

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

/* --- Encargos (pedidos de clientes con seña y fecha de entrega) --- */

const ESTADOS_ENCARGO = ['Pendiente', 'En proceso', 'Entregado', 'Cancelado'];
const esEncargoActivo = e => e.estado === 'Pendiente' || e.estado === 'En proceso';

function encargosFiltrados() {
    const f = document.getElementById('encargoFiltro')?.value || 'activos';
    let lista;
    if (f === 'todos') lista = [...todosEncargos];
    else if (f === 'activos') lista = todosEncargos.filter(esEncargoActivo);
    else lista = todosEncargos.filter(e => e.estado === f);
    // Activos: primero lo que hay que entregar antes (sin fecha al final)
    return lista.sort((a, b) => {
        if (esEncargoActivo(a) !== esEncargoActivo(b)) return esEncargoActivo(a) ? -1 : 1;
        const fa = a.fecha_entrega || '9999';
        const fb = b.fecha_entrega || '9999';
        return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
}

function badgeEncargo(estado) {
    return `<span class="enc-badge enc-badge-${estado.replace(/\s/g, '-')}">${escapeHTML(estado)}</span>`;
}

// Chip de fecha de entrega: avisa si es hoy o si ya pasó (solo encargos activos)
function chipEntrega(e) {
    if (!e.fecha_entrega) return '';
    if (!esEncargoActivo(e)) return `<span class="enc-fecha">${escapeHTML(e.fecha_entrega)}</span>`;
    const hoy = new Date().toISOString().split('T')[0];
    if (e.fecha_entrega < hoy) return `<span class="enc-fecha enc-fecha-vencida">${icon('warning')} Atrasado (${escapeHTML(e.fecha_entrega)})</span>`;
    if (e.fecha_entrega === hoy) return `<span class="enc-fecha enc-fecha-hoy">${icon('warning')} Se entrega HOY</span>`;
    return `<span class="enc-fecha">Entrega: ${escapeHTML(e.fecha_entrega)}</span>`;
}

// Link de WhatsApp al cliente a partir del contacto (si parece un teléfono)
function waCliente(contacto) {
    const digitos = String(contacto || '').replace(/\D/g, '').replace(/^0+/, '');
    if (digitos.length < 8) return '';
    return `https://wa.me/${digitos.startsWith('54') ? digitos : '549' + digitos}`;
}

function renderEncargos() {
    const activos = todosEncargos.filter(esEncargoActivo);
    const porCobrar = activos.reduce((s, e) => s + Math.max(0, (e.precio || 0) - (e.sena || 0)), 0);
    const senas = activos.reduce((s, e) => s + (e.sena || 0), 0);
    const entregados = todosEncargos.filter(e => e.estado === 'Entregado').length;

    document.getElementById('encargoStats').innerHTML = `
        <div class="stat-card">
            <span class="stat-label">Encargos activos</span>
            <span class="stat-value">${activos.length}</span>
        </div>
        <div class="stat-card stat-destacado">
            <span class="stat-label">Por cobrar</span>
            <span class="stat-value">$${formatearPrecio(porCobrar)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Señas recibidas</span>
            <span class="stat-value">$${formatearPrecio(senas)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Entregados</span>
            <span class="stat-value">${entregados}</span>
        </div>`;

    const lista = encargosFiltrados();
    const cont = document.getElementById('listaEncargos');
    if (!lista.length) {
        cont.innerHTML = `
            <div class="empty-state">
                ${icon('inbox', 'icon-lg')}
                <p class="empty-state-title">Sin encargos${document.getElementById('encargoFiltro')?.value !== 'todos' ? ' en este filtro' : ''}</p>
                <p class="empty-state-text">Cuando te pidan algo por WhatsApp, cargalo con "Nuevo Encargo" para no perderle el rastro.</p>
            </div>`;
        return;
    }

    cont.innerHTML = lista.map(e => {
        const resta = Math.max(0, (e.precio || 0) - (e.sena || 0));
        const wa = waCliente(e.contacto);
        const items = parseItemsEncargo(e);
        const itemsHTML = items.length ? `
            <div class="enc-card-items">
                ${items.map(it => {
                    const p = it.proyectoId ? todosProyectos.find(x => x.id === it.proyectoId) : null;
                    return `
                    <div class="enc-item-row">
                        <span class="enc-item-desc">${it.cantidad}× ${escapeHTML(it.nombre)}
                            ${p ? `<button type="button" class="enc-item-ref" title="Ver el proyecto" onclick="abrirDetalle('${p.id}')">${icon('link-external')} ver</button>` : ''}
                        </span>
                        <span class="enc-item-monto">$${formatearPrecio(it.precio * it.cantidad)}</span>
                    </div>`;
                }).join('')}
            </div>` : '';
        return `
            <div class="enc-card ${esEncargoActivo(e) ? '' : 'enc-card-cerrado'}">
                <div class="enc-card-top">
                    <div class="enc-card-cliente">
                        <strong>${escapeHTML(e.cliente || 'Sin nombre')}</strong>
                        ${badgeEncargo(e.estado)}
                    </div>
                    ${chipEntrega(e)}
                </div>
                ${itemsHTML}
                ${e.detalle ? `<div class="enc-card-detalle">${escapeHTML(e.detalle)}</div>` : (items.length ? '' : '<div class="enc-card-detalle">-</div>')}
                ${e.notas ? `<div class="enc-card-notas">${escapeHTML(e.notas)}</div>` : ''}
                <div class="enc-card-monto">
                    ${e.precio ? `<span>Total <strong>$${formatearPrecio(e.precio)}</strong></span>` : ''}
                    ${e.sena ? `<span>Seña <strong>$${formatearPrecio(e.sena)}</strong></span>` : ''}
                    ${e.precio ? `<span class="${resta ? 'text-rojo' : 'text-verde'}">${resta ? `Restan <strong>$${formatearPrecio(resta)}</strong>` : 'Pagado ✓'}</span>` : ''}
                </div>
                <div class="enc-card-acciones">
                    ${wa ? `<a class="btn-sm" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('chat')} WhatsApp</a>` : ''}
                    ${e.estado === 'Pendiente' ? `<button class="btn-sm" onclick="cambiarEstadoEncargo('${e.id}', 'En proceso')">${icon('printer')} Empezar</button>` : ''}
                    ${esEncargoActivo(e) ? `<button class="btn-sm btn-eshop-on" onclick="entregarEncargo('${e.id}')">${icon('check')} Entregar</button>` : ''}
                    ${e.estado === 'Cancelado' || e.estado === 'Entregado' ? `<button class="btn-sm" onclick="cambiarEstadoEncargo('${e.id}', 'Pendiente')">Reabrir</button>` : ''}
                    <button class="btn-sm" title="Editar" onclick="editarEncargo('${e.id}')">${icon('pencil')}</button>
                    ${esEncargoActivo(e) ? `<button class="btn-sm" title="Cancelar encargo" onclick="cambiarEstadoEncargo('${e.id}', 'Cancelado')">${icon('close')}</button>` : ''}
                    <button class="btn-sm btn-peligro" title="Eliminar" onclick="eliminarEncargo('${e.id}')">${icon('trash')}</button>
                </div>
            </div>`;
    }).join('');
}

/* Productos del encargo: mezcla items del catálogo (con proyectoId) e items
   libres. Se editan en memoria (encItems) y se guardan como JSON. */

let encItems = [];

function parseItemsEncargo(e) {
    try {
        const lista = JSON.parse(e.items || '[]');
        return Array.isArray(lista) ? lista.filter(i => i && i.nombre) : [];
    } catch { return []; }
}

function poblarSelectItemEncargo() {
    const sel = document.getElementById('encItemProyecto');
    const orden = [...todosProyectos].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    sel.innerHTML = '<option value="">Otro (fuera del catálogo)</option>' +
        orden.map(p => `<option value="${p.id}" data-precio="${parseFloat(p.precioventa) || 0}">${escapeHTML(p.nombre)}${p.codigo ? ` (${escapeHTML(p.codigo)})` : ''}</option>`).join('');
    encItemProyectoChange();
}

// Al elegir un producto del catálogo se precarga su precio y no hace falta nombre
function encItemProyectoChange() {
    const sel = document.getElementById('encItemProyecto');
    const esCatalogo = !!sel.value;
    document.getElementById('encItemNombre').classList.toggle('hidden', esCatalogo);
    if (esCatalogo) {
        const precio = parseFloat(sel.options[sel.selectedIndex].dataset.precio) || 0;
        if (precio) document.getElementById('encItemPrecio').value = precio;
    }
}

function agregarItemEncargo() {
    const sel = document.getElementById('encItemProyecto');
    const proyectoId = sel.value;
    const p = proyectoId ? todosProyectos.find(x => x.id === proyectoId) : null;
    const nombre = p ? p.nombre : document.getElementById('encItemNombre').value.trim();
    if (!nombre) { showToast('Elegí un producto o escribí qué es', 'error'); return; }
    const cantidad = Math.max(1, parseInt(document.getElementById('encItemCant').value) || 1);
    const precio = parseFloat(document.getElementById('encItemPrecio').value) || 0;
    encItems.push({ proyectoId: proyectoId || '', nombre, cantidad, precio });
    sel.value = '';
    document.getElementById('encItemNombre').value = '';
    document.getElementById('encItemCant').value = '1';
    document.getElementById('encItemPrecio').value = '';
    encItemProyectoChange();
    renderItemsEncargo();
}

function quitarItemEncargo(i) {
    encItems.splice(i, 1);
    renderItemsEncargo();
}

function renderItemsEncargo() {
    document.getElementById('encItemsLista').innerHTML = encItems.map((it, i) => `
        <div class="enc-item-row">
            <span class="enc-item-desc">${it.cantidad}× ${escapeHTML(it.nombre)}${it.proyectoId ? ` <span class="enc-item-badge">${icon('clipboard')} catálogo</span>` : ''}</span>
            <span class="enc-item-monto">$${formatearPrecio(it.precio)} c/u${it.cantidad > 1 ? ` = <strong>$${formatearPrecio(it.precio * it.cantidad)}</strong>` : ''}</span>
            <button type="button" class="btn-sm btn-peligro" title="Quitar" onclick="quitarItemEncargo(${i})">${icon('trash')}</button>
        </div>`).join('');
    // El precio total se recalcula desde los items (se puede pisar a mano después)
    if (encItems.length) {
        document.getElementById('encPrecio').value = encItems.reduce((s, it) => s + it.precio * it.cantidad, 0);
    }
}

function mostrarFormEncargo() {
    document.getElementById('encargoFormTitle').textContent = 'Nuevo Encargo';
    document.getElementById('encargoForm').reset();
    document.getElementById('encargoEditId').value = '';
    document.getElementById('encEstado').value = 'Pendiente';
    document.getElementById('encItemCant').value = '1';
    encItems = [];
    poblarSelectItemEncargo();
    renderItemsEncargo();
    document.getElementById('encargoOverlay').classList.remove('hidden');
}

function editarEncargo(id) {
    const e = todosEncargos.find(x => x.id === id);
    if (!e) return;
    document.getElementById('encargoFormTitle').textContent = 'Editar Encargo';
    document.getElementById('encargoEditId').value = e.id;
    document.getElementById('encCliente').value = e.cliente || '';
    document.getElementById('encContacto').value = e.contacto || '';
    document.getElementById('encDetalle').value = e.detalle || '';
    document.getElementById('encPrecio').value = e.precio || '';
    document.getElementById('encSena').value = e.sena || '';
    document.getElementById('encFechaEntrega').value = e.fecha_entrega || '';
    document.getElementById('encEstado').value = ESTADOS_ENCARGO.includes(e.estado) ? e.estado : 'Pendiente';
    document.getElementById('encNotas').value = e.notas || '';
    encItems = parseItemsEncargo(e);
    poblarSelectItemEncargo();
    renderItemsEncargo();
    // renderItemsEncargo pisa el total con la suma de items; restaurar el guardado
    document.getElementById('encPrecio').value = e.precio || '';
    document.getElementById('encargoOverlay').classList.remove('hidden');
}

function cerrarFormEncargo() {
    document.getElementById('encargoOverlay').classList.add('hidden');
}

document.getElementById('encargoForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const id = document.getElementById('encargoEditId').value;
    const data = {
        cliente: document.getElementById('encCliente').value,
        contacto: document.getElementById('encContacto').value,
        detalle: document.getElementById('encDetalle').value,
        precio: document.getElementById('encPrecio').value,
        sena: document.getElementById('encSena').value,
        fechaEntrega: document.getElementById('encFechaEntrega').value,
        estado: document.getElementById('encEstado').value,
        notas: document.getElementById('encNotas').value,
        items: encItems,
    };
    const res = await apiFetch(id ? `${API_ENC}/${id}` : API_ENC, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'No se pudo guardar el encargo', 'error');
        return;
    }
    const guardado = await res.json();
    const i = todosEncargos.findIndex(x => x.id === guardado.id);
    if (i !== -1) todosEncargos[i] = guardado; else todosEncargos.unshift(guardado);
    cerrarFormEncargo();
    renderEncargos();
    showToast('Encargo guardado', 'success');
};

// Enter en los campos de producto agrega el item (sin mandar el form entero)
['encItemNombre', 'encItemCant', 'encItemPrecio'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); agregarItemEncargo(); }
    });
});

async function cambiarEstadoEncargo(id, estado) {
    const res = await apiFetch(`${API_ENC}/${id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
    });
    if (!res.ok) { showToast('No se pudo cambiar el estado', 'error'); return null; }
    const actualizado = await res.json();
    const i = todosEncargos.findIndex(x => x.id === id);
    if (i !== -1) todosEncargos[i] = actualizado;
    renderEncargos();
    return actualizado;
}

// Entregar = marcar Entregado y ofrecer registrar las ventas. Si el encargo
// tiene productos del catálogo, cada venta lleva el costo real del proyecto
// y se descuenta el stock; los items libres van con costo 0.
async function entregarEncargo(id) {
    const e = todosEncargos.find(x => x.id === id);
    if (!e) return;
    if (!(await showConfirm(`¿Marcar como entregado el encargo de "${e.cliente || 'cliente'}"?`, { title: 'Entregar encargo', confirmLabel: 'Entregar' }))) return;
    const actualizado = await cambiarEstadoEncargo(id, 'Entregado');
    if (!actualizado) return;

    const items = parseItemsEncargo(e);

    // Encargo sin productos cargados: venta única por el precio total
    if (!items.length) {
        if ((e.precio || 0) <= 0) { showToast('Encargo entregado', 'success'); return; }
        const registrar = await showConfirm(
            `¿Registrar también la venta por $${formatearPrecio(e.precio)}? (el costo queda en 0, lo podés editar después en Ventas)`,
            { title: 'Registrar venta', confirmLabel: 'Registrar venta', cancelLabel: 'No, solo entregar' }
        );
        if (!registrar) { showToast('Encargo entregado', 'success'); return; }
        await apiFetch(API_VTA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proyectoNombre: `Encargo: ${e.detalle || ''}${e.cliente ? ` (${e.cliente})` : ''}`.slice(0, 120),
                cantidad: 1,
                precioVenta: e.precio,
                costo: 0,
            }),
        });
        await cargarVentas();
        showToast('Encargo entregado y venta registrada', 'success');
        return;
    }

    const delCatalogo = items.filter(it => it.proyectoId && todosProyectos.some(p => p.id === it.proyectoId));
    const registrar = await showConfirm(
        `¿Registrar la venta de ${items.length === 1 ? 'su producto' : `sus ${items.length} productos`}?` +
        (delCatalogo.length ? ` A los del catálogo se les descuenta el stock y llevan su costo real.` : ''),
        { title: 'Registrar ventas', confirmLabel: 'Registrar', cancelLabel: 'No, solo entregar' }
    );
    if (!registrar) { showToast('Encargo entregado', 'success'); return; }

    for (const it of items) {
        const p = it.proyectoId ? todosProyectos.find(x => x.id === it.proyectoId) : null;
        await apiFetch(API_VTA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proyectoId: p ? p.id : '',
                proyectoNombre: p ? p.nombre : `Encargo: ${it.nombre}${e.cliente ? ` (${e.cliente})` : ''}`.slice(0, 120),
                cantidad: it.cantidad,
                precioVenta: it.precio,
                costo: p ? (parseFloat(p.costo) || 0) : 0,
            }),
        });
        if (p) {
            const stock = Math.max(0, (parseInt(p.cantidad) || 0) - it.cantidad);
            await apiFetch(`${API_PROY}/${p.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyDesdeProyecto(p), cantidad: stock }),
            });
        }
    }
    showToast(`Encargo entregado: ${items.length} venta${items.length !== 1 ? 's' : ''} registrada${items.length !== 1 ? 's' : ''}`, 'success');
    cargar();
}

async function eliminarEncargo(id) {
    if (!(await showConfirm('¿Eliminar este encargo? Se pierde el registro (si ya lo entregaste, conviene dejarlo).', { danger: true }))) return;
    await apiFetch(`${API_ENC}/${id}`, { method: 'DELETE' });
    todosEncargos = todosEncargos.filter(x => x.id !== id);
    renderEncargos();
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
