if (window.location.protocol === 'file:') {
    document.getElementById('app').innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
            <h2 style="color:#dc2626;">Modo incorrecto</h2>
            <p style="margin:16px 0;font-size:16px;">No abras el archivo directo. Ejecutá <strong>iniciar.bat</strong> o usá:</p>
            <code style="display:block;padding:12px;background:#1a1a2e;color:#fff;border-radius:6px;font-size:18px;">http://localhost:3000</code>
        </div>`;
    throw new Error('Modo incorrecto - usar localhost:3000');
}

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

    cambiarVista('tienda');
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
            <span class="carpeta-icon">📂</span> ${escapeHTML(c)}
            <span class="carpeta-count">${todosProyectos.filter(p => p.categoria === c).length}</span>
        </div>
    `).join('');
    container.querySelectorAll('.carpeta').forEach(el => {
        el.addEventListener('click', () => filtrar(el.dataset.cat));
    });
}

function ganancia(p) {
    const venta = parseFloat(p.precioVenta) || 0;
    const costo = parseFloat(p.costo) || 0;
    const cant = parseInt(p.vendidos) || 0;
    return (venta - costo) * cant;
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

async function renderTienda() {
    const estado = document.getElementById('tiendaEstado');
    const grid = document.getElementById('tiendaGrid');
    try {
        const res = await fetch('/api/eshop');
        const productos = await res.json();
        if (!productos.length) {
            estado.textContent = 'Todavía no hay productos en la tienda.';
            estado.classList.remove('hidden');
            grid.classList.add('hidden');
            return;
        }
        grid.innerHTML = productos.map(p => {
            const foto = (p.fotos || '').split(',')[0]?.trim();
            const img = foto
                ? `<img src="${escapeHTML(safeHref(foto))}" alt="${escapeHTML(p.nombre)}" loading="lazy">`
                : `<div class="product-img-placeholder">🖨️</div>`;
            const sinStock = !p.cantidad || p.cantidad <= 0;
            const precio = parseFloat(p.precioventa) || 0;
            const mensaje = encodeURIComponent(`Hola! Te escribo por "${p.nombre}" que vi en la tienda.`);
            const mlUrl = urlML(p.ml_id);
            return `
                <article class="product-card">
                    <div class="product-img">${img}</div>
                    <div class="product-body">
                        ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                        <h3 class="product-title">${escapeHTML(p.nombre)}</h3>
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
                        ${authed && !sinStock ? `<button class="btn-vender" onclick="marcarVendido('${p.id}')">✅ Marcar vendido</button>` : ''}
                    </div>
                </article>`;
        }).join('');
        estado.classList.add('hidden');
        grid.classList.remove('hidden');
    } catch {
        estado.textContent = 'No se pudo cargar la tienda.';
    }
}

function formatearPrecio(n) {
    return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function getWhatsAppNumero() {
    return '5491100000000';
}

const WHATSAPP_NUMERO = getWhatsAppNumero();

const ESTADOS_VALIDOS = ['Planificado', 'Imprimiendo', 'Terminado'];

function renderTabla() {
    const filtrados = catActual ? todosProyectos.filter(p => p.categoria === catActual) : todosProyectos;
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = filtrados.map(p => {
        const g = ganancia(p);
        const costo = parseFloat(p.costo) || 0;
        const pv = parseFloat(p.precioVenta) || 0;
        const vend = parseInt(p.vendidos) || 0;
        const estadoClase = ESTADOS_VALIDOS.includes(p.estado) ? p.estado : 'Planificado';
        return `
            <tr>
                <td data-label="Nombre">${escapeHTML(p.nombre)}</td>
                <td data-label="Código">${escapeHTML(p.codigo)}</td>
                <td data-label="Categoría">${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : '-'}</td>
                <td data-label="Link Archivo">${p.linkArchivo ? `<a href="${escapeHTML(safeHref(p.linkArchivo))}" target="_blank" rel="noopener noreferrer">🔗 Archivo</a>` : '-'}</td>
                <td data-label="Costo">${costo ? '$'+costo : '-'}</td>
                <td data-label="Precio Vta">${pv ? '$'+pv : '-'}</td>
                <td data-label="Vend.">${vend || '-'}</td>
                <td data-label="Ganancia" class="${g > 0 ? 'text-verde' : g < 0 ? 'text-rojo' : ''}">${g ? '$'+g : '-'}</td>
                <td data-label="Estado"><span class="estado-badge estado-${estadoClase}">${escapeHTML(p.estado)}</span></td>
                <td data-label="ML">${p.ml_id ? `<a href="${urlML(p.ml_id)}" target="_blank" rel="noopener noreferrer" class="link-ml">🔗 ML</a>` : '-'}</td>
                <td data-label="Eshop"><button class="btn-sm ${p.publicareshop ? 'btn-eshop-on' : 'btn-eshop-off'}" onclick="toggleEshop('${p.id}', ${!!p.publicareshop})">${p.publicareshop ? '🛍️ En tienda' : '📦 Publicar'}</button></td>
                <td data-label="Acciones">
                    <button class="btn-sm" onclick="editar('${p.id}')">✏️</button>
                    <button class="btn-sm btn-peligro" onclick="eliminar('${p.id}')">🗑️</button>
                </td>
            </tr>`;
    }).join('');
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
        publicarEshop: document.getElementById('publicarEshop').checked,
    };
    const url = id ? `${API_PROY}/${id}` : API_PROY;
    const method = id ? 'PUT' : 'POST';
    await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
    document.getElementById('linkArchivo').value = p.linkArchivo || '';
    document.getElementById('costo').value = p.costo || '';
    document.getElementById('precioVenta').value = p.precioVenta || '';
    document.getElementById('vendidos').value = p.vendidos || '';
    document.getElementById('cantidad').value = p.cantidad || '';
    document.getElementById('mlId').value = p.ml_id || '';
    document.getElementById('fotos').value = p.fotos || '';
    document.getElementById('estado').value = p.estado || 'Planificado';
    document.getElementById('publicarEshop').checked = !!p.publicareshop;
    document.getElementById('formOverlay').classList.remove('hidden');
}

async function eliminar(id) {
    if (confirm('¿Eliminar este proyecto?')) {
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
            <span>📂 ${escapeHTML(c)}</span>
            <div>
                <button class="btn-sm btn-renombrar">✏️</button>
                <button class="btn-sm btn-peligro btn-eliminar-cat">🗑️</button>
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
    if (!res.ok) { alert('Ya existe o nombre inválido'); return; }
    input.value = '';
    await renderCatsAdmin();
    cargar();
}

async function renombrarCarpeta(viejo) {
    const nuevo = prompt('Nuevo nombre:', viejo);
    if (!nuevo || nuevo === viejo) return;
    const res = await apiFetch(`${API_CAT}/${encodeURIComponent(viejo)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nuevo })
    });
    if (!res.ok) { alert('Error al renombrar'); return; }
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

function renderVentas() {
    const totalVendidos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0), 0);
    const totalIngresos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0) * (v.precioVenta || 0), 0);
    const totalCostos = todasLasVentas.reduce((s, v) => s + (v.cantidad || 0) * (v.costo || 0), 0);
    const totalGanancia = totalIngresos - totalCostos;

    document.getElementById('stat-vendidos').textContent = totalVendidos + ' uds';
    document.getElementById('stat-ingresos').textContent = '$' + totalIngresos.toFixed(2);
    document.getElementById('stat-costos').textContent = '$' + totalCostos.toFixed(2);
    document.getElementById('stat-ganancia').textContent = '$' + totalGanancia.toFixed(2);

    const tbody = document.getElementById('tbodyVentas');
    const ordenadas = [...todasLasVentas].reverse();
    tbody.innerHTML = ordenadas.map(v => {
        const gan = (v.precioVenta - v.costo) * v.cantidad;
        return `
            <tr>
                <td data-label="Proyecto">${escapeHTML(v.proyectoNombre || 'Sin proyecto')}</td>
                <td data-label="Cant.">${v.cantidad}</td>
                <td data-label="Precio Venta">$${(v.precioVenta || 0).toFixed(2)}</td>
                <td data-label="Costo">$${(v.costo || 0).toFixed(2)}</td>
                <td data-label="Ganancia" class="${gan > 0 ? 'text-verde' : gan < 0 ? 'text-rojo' : ''}">$${gan.toFixed(2)}</td>
                <td data-label="Fecha">${escapeHTML(v.fecha)}</td>
                <td data-label="Acciones"><button class="btn-sm btn-peligro" onclick="eliminarVenta('${v.id}')">🗑️</button></td>
            </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;">Sin ventas registradas. Presioná "Registrar Venta".</td></tr>';

    document.getElementById('tfootVentas').innerHTML = todasLasVentas.length ? `
        <tr class="total-row">
            <td data-label="Proyecto"><strong>TOTAL</strong></td>
            <td data-label="Cant."><strong>${totalVendidos}</strong></td>
            <td data-label="Precio Venta"></td>
            <td data-label="Costo"><strong>$${totalCostos.toFixed(2)}</strong></td>
            <td data-label="Ganancia" class="${totalGanancia > 0 ? 'text-verde' : totalGanancia < 0 ? 'text-rojo' : ''}"><strong>$${totalGanancia.toFixed(2)}</strong></td>
            <td data-label="Fecha"></td><td data-label="Acciones"></td>
        </tr>` : '';
}

function cambiarVista(vista) {
    const etiquetas = { tienda: 'Tienda', proyectos: 'Proyectos', ventas: 'Ventas', calculadora: 'Calculadora' };
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('tab-activo', t.textContent.includes(etiquetas[vista]));
    });
    document.getElementById('vistaTienda').classList.toggle('hidden', vista !== 'tienda');
    document.getElementById('vistaProyectos').classList.toggle('hidden', vista !== 'proyectos');
    document.getElementById('vistaVentas').classList.toggle('hidden', vista !== 'ventas');
    document.getElementById('vistaCalculadora').classList.toggle('hidden', vista !== 'calculadora');
    document.getElementById('btnNuevo').classList.toggle('hidden', vista !== 'proyectos');
    if (vista === 'tienda') renderTienda();
    if (vista === 'ventas') renderVentas();
    if (vista === 'calculadora') calcularPrecio();
    if (vista === 'proyectos') renderTabla();
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
        todosProyectos.map(p => `<option value="${p.id}" data-costo="${p.costo || 0}" data-nombre="${escapeHTML(p.nombre)}">${escapeHTML(p.nombre)} (${escapeHTML(p.codigo)})</option>`).join('');
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
    if (confirm('¿Eliminar esta venta?')) {
        await apiFetch(`${API_VTA}/${id}`, { method: 'DELETE' });
        await cargarVentas();
        renderVentas();
    }
}

async function eliminarCarpeta(nombre) {
    if (!confirm(`¿Eliminar carpeta "${nombre}"? Los proyectos perderán esta categoría.`)) return;
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
        const btnDesconectar = document.getElementById('btnDesconectarML');
        if (data.connected) {
            dot.className = 'ml-dot ml-connected';
            label.textContent = 'ML conectado';
            btnConectar.classList.add('hidden');
            btnDesconectar.classList.remove('hidden');
        } else {
            dot.className = 'ml-dot ml-disconnected';
            label.textContent = 'ML desconectado';
            btnConectar.classList.remove('hidden');
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
    if (!confirm('¿Desconectar Mercado Libre?')) return;
    try {
        await apiFetch('/api/ml/disconnect', { method: 'POST' });
        checkMLStatus();
    } catch {
        // ignore
    }
}

cargar();
