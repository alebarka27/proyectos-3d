/* Home pública: hero con collage, categorías y grilla de destacados.
   Usa renderProductoCard/skeletonCards de utils.js y el carrito de carrito.js. */

async function cargarHome() {
    const estado = document.getElementById('homeEstado');
    const grid = document.getElementById('homeGrid');
    estado.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = skeletonCards(4);

    try {
        const res = await fetch('/api/eshop');
        if (!res.ok) throw new Error('Error al cargar');
        const productos = await res.json();

        renderCategoriasHome(productos);
        renderCollage(productos);

        // Destacados primero; si no hay marcados, se muestran los primeros del catálogo
        let dest = productos.filter(p => p.destacado);
        if (!dest.length) dest = productos;
        if (!dest.length) {
            grid.classList.add('hidden');
            estado.classList.remove('hidden');
            estado.textContent = 'Todavía no hay productos publicados. ¡Volvé pronto!';
            return;
        }
        grid.innerHTML = dest.slice(0, 8).map(renderProductoCard).join('');
    } catch {
        grid.innerHTML = `<div class="empty-state">
            ${icon('warning', 'icon-lg')}
            <p class="empty-state-title">No se pudo cargar la tienda</p>
            <p class="empty-state-text">Probá de nuevo en un momento.</p>
        </div>`;
    }
}

function renderCategoriasHome(productos) {
    const cats = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();
    if (!cats.length) return;
    document.getElementById('homeCategorias').innerHTML = cats.map(c =>
        `<a class="home-cat-btn" href="/eshop?categoria=${encodeURIComponent(c)}">${escapeHTML(c)}</a>`
    ).join('');
}

// Collage del hero: hasta 3 fotos reales de productos (destacados primero)
function renderCollage(productos) {
    const conFoto = [...productos].sort((a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0))
        .map(p => ({ p, foto: mlGridImage(fotosArray(p.fotos)[0] || '') }))
        .filter(x => /^https?:\/\//i.test(x.foto))
        .slice(0, 3);
    if (conFoto.length < 2) return; // con una sola foto el collage queda pobre

    const collage = document.getElementById('heroCollage');
    collage.innerHTML = conFoto.map(({ p, foto }) => `
        <a class="vice-polaroid" href="/producto.html?id=${encodeURIComponent(p.id)}" tabindex="-1">
            <img src="${escapeHTML(foto)}" alt="" loading="eager" decoding="async" onerror="this.closest('.vice-polaroid').remove()">
        </a>
    `).join('');
    collage.classList.remove('hidden');
}

cargarHome();
