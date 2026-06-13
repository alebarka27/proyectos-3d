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

async function cargar() {
    const [resP, resC, resV] = await Promise.all([fetch(API_PROY), fetch(API_CAT), fetch(API_VTA)]);
    todosProyectos = await resP.json();
    catsGuardadas = await resC.json();
    todasLasVentas = await resV.json();
    renderSidebar();
    renderTabla();
}

function renderSidebar() {
    const enUso = new Set(todosProyectos.map(p => p.categoria).filter(Boolean));
    const todas = [...new Set([...catsGuardadas, ...enUso])].sort();
    const container = document.getElementById('listaCarpetas');
    document.getElementById('count-todas').textContent = todosProyectos.length;
    const datalist = document.getElementById('catList');
    datalist.innerHTML = todas.map(c => `<option value="${c}">`).join('');
    container.innerHTML = todas.map(c => `
        <div class="carpeta ${catActual === c ? 'carpeta-activa' : ''}" data-cat="${c}" onclick="filtrar('${c}')">
            <span class="carpeta-icon">📂</span> ${c}
            <span class="carpeta-count">${todosProyectos.filter(p => p.categoria === c).length}</span>
        </div>
    `).join('');
}

function ganancia(p) {
    const venta = parseFloat(p.precioVenta) || 0;
    const costo = parseFloat(p.costo) || 0;
    const cant = parseInt(p.vendidos) || 0;
    return (venta - costo) * cant;
}

function renderTabla() {
    const filtrados = catActual ? todosProyectos.filter(p => p.categoria === catActual) : todosProyectos;
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = filtrados.map(p => {
        const fotos = (p.fotos || '').split(',').map(f => f.trim()).filter(Boolean);
        const g = ganancia(p);
        const costo = parseFloat(p.costo) || 0;
        const pv = parseFloat(p.precioVenta) || 0;
        const vend = parseInt(p.vendidos) || 0;
        return `
            <tr>
                <td>${p.nombre}</td>
                <td>${p.codigo}</td>
                <td>${p.categoria ? `<span class="cat-badge">${p.categoria}</span>` : '-'}</td>
                <td>${p.linkArchivo ? `<a href="${p.linkArchivo}" target="_blank">🔗 Archivo</a>` : '-'}</td>
                <td>${costo ? '$'+costo : '-'}</td>
                <td>${pv ? '$'+pv : '-'}</td>
                <td>${vend || '-'}</td>
                <td class="${g > 0 ? 'text-verde' : g < 0 ? 'text-rojo' : ''}">${g ? '$'+g : '-'}</td>
                <td><span class="estado-badge estado-${p.estado}">${p.estado}</span></td>
                <td>
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
        fotos: document.getElementById('fotos').value,
        estado: document.getElementById('estado').value,
    };
    const url = id ? `${API_PROY}/${id}` : API_PROY;
    const method = id ? 'PUT' : 'POST';
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
    document.getElementById('fotos').value = p.fotos || '';
    document.getElementById('estado').value = p.estado || 'Planificado';
    document.getElementById('formOverlay').classList.remove('hidden');
}

async function eliminar(id) {
    if (confirm('¿Eliminar este proyecto?')) {
        await fetch(`${API_PROY}/${id}`, { method: 'DELETE' });
        cargar();
    }
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
        <div class="cat-admin-item">
            <span>📂 ${c}</span>
            <div>
                <button class="btn-sm" onclick="renombrarCarpeta('${c}')">✏️</button>
                <button class="btn-sm btn-peligro" onclick="eliminarCarpeta('${c}')">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function cargarCatsGuardadas() {
    const res = await fetch(API_CAT);
    catsGuardadas = await res.json();
}

async function crearCarpeta() {
    const input = document.getElementById('nuevaCat');
    const nombre = input.value.trim();
    if (!nombre) return;
    const res = await fetch(API_CAT, {
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
    const res = await fetch(`${API_CAT}/${encodeURIComponent(viejo)}`, {
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
    const res = await fetch(API_VTA);
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
                <td>${v.proyectoNombre || 'Sin proyecto'}</td>
                <td>${v.cantidad}</td>
                <td>$${(v.precioVenta || 0).toFixed(2)}</td>
                <td>$${(v.costo || 0).toFixed(2)}</td>
                <td class="${gan > 0 ? 'text-verde' : gan < 0 ? 'text-rojo' : ''}">$${gan.toFixed(2)}</td>
                <td>${v.fecha}</td>
                <td><button class="btn-sm btn-peligro" onclick="eliminarVenta('${v.id}')">🗑️</button></td>
            </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;">Sin ventas registradas. Presioná "Registrar Venta".</td></tr>';

    document.getElementById('tfootVentas').innerHTML = todasLasVentas.length ? `
        <tr class="total-row">
            <td><strong>TOTAL</strong></td>
            <td><strong>${totalVendidos}</strong></td>
            <td></td>
            <td><strong>$${totalCostos.toFixed(2)}</strong></td>
            <td class="${totalGanancia > 0 ? 'text-verde' : totalGanancia < 0 ? 'text-rojo' : ''}"><strong>$${totalGanancia.toFixed(2)}</strong></td>
            <td></td><td></td>
        </tr>` : '';
}

function cambiarVista(vista) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-activo'));
    document.querySelectorAll('.tab').forEach(t => {
        if (t.textContent.includes(vista === 'proyectos' ? 'Proyectos' : 'Ventas')) t.classList.add('tab-activo');
    });
    document.getElementById('vistaProyectos').classList.toggle('hidden', vista !== 'proyectos');
    document.getElementById('vistaVentas').classList.toggle('hidden', vista !== 'ventas');
    document.getElementById('btnNuevo').classList.toggle('hidden', vista !== 'proyectos');
    if (vista === 'ventas') renderVentas();
}

/* --- Formulario de ventas --- */

function mostrarFormVenta() {
    const select = document.getElementById('ventaProyecto');
    select.innerHTML = '<option value="">-- Seleccionar --</option>' +
        todosProyectos.map(p => `<option value="${p.id}" data-costo="${p.costo || 0}" data-nombre="${p.nombre}">${p.nombre} (${p.codigo})</option>`).join('');
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
    await fetch(API_VTA, {
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
        await fetch(`${API_VTA}/${id}`, { method: 'DELETE' });
        await cargarVentas();
        renderVentas();
    }
}

async function eliminarCarpeta(nombre) {
    if (!confirm(`¿Eliminar carpeta "${nombre}"? Los proyectos perderán esta categoría.`)) return;
    await fetch(`${API_CAT}/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
    if (catActual === nombre) catActual = '';
    await renderCatsAdmin();
    cargar();
}

cargar();
