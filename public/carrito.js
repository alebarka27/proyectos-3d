/* Carrito de pedido (solo front, localStorage): junta varios productos y arma
   UN solo mensaje de WhatsApp con todo el pedido. Se carga en todas las
   páginas públicas, después de utils.js e icons.js. */

const CARRITO_KEY = 'aurora_carrito';

function carritoLeer() {
    try {
        const items = JSON.parse(localStorage.getItem(CARRITO_KEY));
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

function carritoGuardar(items) {
    localStorage.setItem(CARRITO_KEY, JSON.stringify(items));
    carritoRender();
}

function carritoAgregar(id, nombre, precio) {
    const items = carritoLeer();
    const existente = items.find(i => i.id === id);
    if (existente) {
        existente.cant++;
    } else {
        items.push({ id, nombre, precio: parseFloat(precio) || 0, cant: 1 });
    }
    carritoGuardar(items);
}

function carritoCambiar(id, delta) {
    let items = carritoLeer();
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.cant += delta;
    if (item.cant <= 0) items = items.filter(i => i.id !== id);
    carritoGuardar(items);
}

function carritoVaciar() {
    carritoGuardar([]);
    carritoCerrar();
}

function carritoTotal(items) {
    return items.reduce((s, i) => s + i.precio * i.cant, 0);
}

function carritoMensajeWA(items) {
    const lineas = items.map(i =>
        `• ${i.cant} × ${i.nombre}${i.precio ? ` — $${formatearPrecio(i.precio * i.cant)}` : ''}`
    );
    const total = carritoTotal(items);
    return `Hola! Quiero hacer este pedido:\n${lineas.join('\n')}` +
        (total ? `\n\nTotal estimado: $${formatearPrecio(total)}` : '');
}

/* --- UI: botón flotante + panel --- */

function carritoEnsureUI() {
    if (document.getElementById('carritoFloat')) return;

    const btn = document.createElement('button');
    btn.id = 'carritoFloat';
    btn.className = 'carrito-float hidden';
    btn.setAttribute('aria-label', 'Ver mi pedido');
    btn.innerHTML = `${icon('cart', 'icon-lg')}<span class="carrito-count" id="carritoCount">0</span>`;
    btn.onclick = carritoTogglePanel;
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'carritoPanel';
    panel.className = 'carrito-panel hidden';
    document.body.appendChild(panel);
}

function carritoTogglePanel() {
    const panel = document.getElementById('carritoPanel');
    panel.classList.toggle('hidden');
}

function carritoCerrar() {
    document.getElementById('carritoPanel')?.classList.add('hidden');
}

function carritoRender() {
    carritoEnsureUI();
    const items = carritoLeer();
    const float = document.getElementById('carritoFloat');
    const panel = document.getElementById('carritoPanel');
    const count = items.reduce((s, i) => s + i.cant, 0);

    float.classList.toggle('hidden', count === 0);
    document.getElementById('carritoCount').textContent = count;
    if (count === 0) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const total = carritoTotal(items);
    panel.innerHTML = `
        <div class="carrito-header">
            <span>Tu pedido</span>
            <button class="carrito-cerrar" onclick="carritoCerrar()" aria-label="Cerrar">${icon('close')}</button>
        </div>
        <div class="carrito-items">
            ${items.map(i => `
                <div class="carrito-item">
                    <div class="carrito-item-info">
                        <span class="carrito-item-nombre">${escapeHTML(i.nombre)}</span>
                        ${i.precio ? `<span class="carrito-item-precio">$${formatearPrecio(i.precio * i.cant)}</span>` : ''}
                    </div>
                    <div class="carrito-item-cant">
                        <button onclick="carritoCambiar('${escapeHTML(i.id)}', -1)" aria-label="Quitar uno">−</button>
                        <span>${i.cant}</span>
                        <button onclick="carritoCambiar('${escapeHTML(i.id)}', 1)" aria-label="Agregar uno">+</button>
                    </div>
                </div>
            `).join('')}
        </div>
        ${total ? `<div class="carrito-total"><span>Total estimado</span><strong>$${formatearPrecio(total)}</strong></div>` : ''}
        <a class="btn-whatsapp carrito-enviar" href="${whatsappHref(carritoMensajeWA(items))}" target="_blank" rel="noopener noreferrer">
            ${icon('chat')} Enviar pedido por WhatsApp
        </a>
        <button class="carrito-vaciar" onclick="carritoVaciar()">Vaciar pedido</button>
    `;
}

/* Delegación: cualquier .btn-add-carrito (cards y ficha) agrega al pedido */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-add-carrito');
    if (!btn) return;
    e.preventDefault();
    carritoAgregar(btn.dataset.id, btn.dataset.nombre, btn.dataset.precio);
    const original = btn.dataset.labelOriginal || btn.textContent;
    btn.dataset.labelOriginal = original;
    btn.textContent = '✓ Agregado';
    btn.classList.add('btn-add-ok');
    setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('btn-add-ok');
    }, 1200);
});

document.addEventListener('DOMContentLoaded', carritoRender);
