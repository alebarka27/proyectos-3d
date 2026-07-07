/* Helpers compartidos (formatearPrecio, urlML, fotosArray, mlHighResImage,
   whatsappHref, escapeHTML, safeHref) viven en utils.js, cargado antes. */

let productoNombre = '';

// Mensaje de WhatsApp, incluyendo el color elegido si hay uno
function mensajeWA(color) {
    const col = color ? ` en color ${color}` : '';
    return `Hola! Me interesa "${productoNombre}"${col} que vi en el catálogo.`;
}

async function cargarProducto() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const main = document.getElementById('productoMain');

    if (!id) {
        main.innerHTML = `<div class="producto-no-encontrado"><h2>Producto no encontrado</h2><p>No se especificó un producto.</p><a href="/eshop" style="color:var(--info);margin-top:16px;display:inline-block;">Volver a la tienda</a></div>`;
        return;
    }

    try {
        const res = await fetch(`/api/producto/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('No encontrado');
        const data = await res.json();
        const p = data.producto;

        document.title = `${p.nombre} — 3D by Aurora`;

        const fotos = fotosArray(p.fotos).map(mlHighResImage);
        const esDigital = !!p.es_digital;
        // Un archivo digital nunca se agota
        const sinStock = !esDigital && (!p.cantidad || p.cantidad <= 0);
        const precio = parseFloat(p.precioventa) || 0;
        const mlUrl = urlML(p.ml_id);
        productoNombre = p.nombre;
        const colores = fotosArray(p.colores);
        let colorFotos = {};
        try { colorFotos = JSON.parse(p.colorfotos || '{}'); } catch { colorFotos = {}; }

        // El mensaje arranca con el color activo (el primero) si el producto tiene colores
        const whatsappUrl = whatsappHref(mensajeWA(colores[0] || ''));
        // El boton flotante en esta pagina tambien lleva el mensaje del producto
        document.querySelector('.whatsapp-float')?.setAttribute('href', whatsappUrl);

        actualizarSEO(p, fotos[0], precio, sinStock);

        let galeriaHTML = '';
        if (fotos.length) {
            galeriaHTML = `
                <div class="producto-gallery-main">
                    <img id="galleryMain" src="${escapeHTML(safeHref(fotos[0]))}" alt="${escapeHTML(p.nombre)}" onerror="imgFallback(this)">
                </div>
                ${fotos.length > 1 ? `<div class="producto-gallery-thumbs">${fotos.map((f, i) => `<img src="${escapeHTML(safeHref(f))}" class="${i === 0 ? 'active' : ''}" onclick="cambiarFoto(this, '${escapeHTML(safeHref(f))}')" alt="Foto ${i + 1}" onerror="imgFallback(this)">`).join('')}</div>` : ''}
            `;
        } else {
            galeriaHTML = `<div class="producto-gallery-main"><div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div></div>`;
        }

        main.innerHTML = `
            <a class="producto-back" href="/eshop">← Volver a la tienda</a>
            <div class="producto-layout">
                <div class="producto-gallery">${galeriaHTML}</div>
                <div class="producto-info">
                    ${p.categoria || esDigital ? `<div>
                        ${p.categoria ? `<span class="cat-badge">${escapeHTML(p.categoria)}</span>` : ''}
                        ${esDigital ? '<span class="badge-stl-ficha">Archivo digital (STL)</span>' : ''}
                    </div>` : ''}
                    <h1>${escapeHTML(p.nombre)}</h1>
                    ${precio ? `
                    <div class="producto-precio">
                        <span class="simbolo">$</span>
                        <span class="monto">${formatearPrecio(precio)}</span>
                    </div>` : ''}
                    <div class="producto-stock ${sinStock ? 'stock-no' : 'stock-ok'}">
                        ${sinStock ? `${icon('close')} Agotado`
                            : esDigital ? `${icon('check')} Entrega digital — recibís el archivo para descargar tras la compra`
                            : `${icon('check')} ${p.cantidad} disponible${p.cantidad !== 1 ? 's' : ''}`}
                    </div>
                    ${colores.length ? `
                    <div class="producto-colores">
                        <span class="producto-colores-label">Color: <strong id="colorActivo">${escapeHTML(colores[0])}</strong></span>
                        <div class="producto-colores-row" id="coloresRow">
                            ${colores.map((c, i) => {
                                const hex = colorHex(c);
                                const cls = hex === 'transparent' ? 'swatch swatch-transparente' : hex ? 'swatch' : 'swatch swatch-otro';
                                const style = (hex && hex !== 'transparent') ? `style="background:${hex}"` : '';
                                const url = colorFotos[c] || '';
                                return `<button type="button" class="${cls} swatch-btn ${i === 0 ? 'swatch-active' : ''}" ${style} title="${escapeHTML(c)}" aria-label="${escapeHTML(c)}" data-color="${escapeHTML(c)}" data-url="${escapeHTML(safeHref(url))}" onclick="seleccionarColor(this)"></button>`;
                            }).join('')}
                        </div>
                    </div>` : ''}
                    <div class="producto-ctas">
                        <a id="ctaWhatsapp" class="producto-cta-whatsapp ${sinStock ? 'btn-whatsapp-disabled' : ''}" ${sinStock ? '' : `href="${whatsappUrl}" target="_blank" rel="noopener noreferrer"`}>
                            <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            ${sinStock ? 'Agotado' : 'Comprar por WhatsApp'}
                        </a>
                        ${mlUrl ? `<a class="producto-cta-ml" href="${mlUrl}" target="_blank" rel="noopener noreferrer">${icon('cart')} Compralo también por Mercado Libre</a>` : ''}
                    </div>
                    ${p.descripcion ? `
                    <div class="producto-descripcion">
                        <h3>Descripción</h3>
                        <p>${escapeHTML(p.descripcion).replace(/\n/g, '<br>')}</p>
                    </div>` : ''}
                </div>
            </div>
            ${data.similares && data.similares.length ? `
            <div class="producto-similares">
                <h2>Productos similares</h2>
                <div class="eshop-grid">${data.similares.map(s => {
                    const sFoto = mlGridImage(fotosArray(s.fotos)[0]);
                    const sImg = sFoto ? `<img src="${escapeHTML(safeHref(sFoto))}" alt="${escapeHTML(s.nombre)}" loading="lazy" decoding="async" onerror="imgFallback(this)">` : `<div class="product-img-placeholder">${icon('printer', 'icon-lg')}</div>`;
                    const sPrecio = parseFloat(s.precioventa) || 0;
                    return `
                        <article class="product-card" onclick="window.location.href='/producto.html?id=${s.id}'" style="cursor:pointer">
                            <div class="product-img">${sImg}</div>
                            <div class="product-body">
                                <h3 class="product-title">${escapeHTML(s.nombre)}</h3>
                                ${sPrecio ? `<div class="precio-section"><span class="precio-simbolo">$</span><span class="precio-monto" style="font-size:22px">${formatearPrecio(sPrecio)}</span></div>` : ''}
                            </div>
                        </article>`;
                }).join('')}</div>
            </div>` : ''}
        `;
    } catch {
        main.innerHTML = `<div class="producto-no-encontrado"><h2>Producto no encontrado</h2><p>Este producto no está disponible o fue eliminado.</p><a href="/eshop" style="color:var(--info);margin-top:16px;display:inline-block;">Ver todos los productos</a></div>`;
    }
}

function cambiarFoto(el, src) {
    const main = document.getElementById('galleryMain');
    if (main) main.src = src;
    document.querySelectorAll('.producto-gallery-thumbs img').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

function seleccionarColor(btn) {
    const nombre = btn.dataset.color;
    const url = btn.dataset.url;

    const label = document.getElementById('colorActivo');
    if (label) label.textContent = nombre;

    document.querySelectorAll('#coloresRow .swatch-btn').forEach(b => b.classList.remove('swatch-active'));
    btn.classList.add('swatch-active');

    // El mensaje de WhatsApp ahora menciona el color elegido
    const wa = whatsappHref(mensajeWA(nombre));
    document.getElementById('ctaWhatsapp')?.setAttribute('href', wa);
    document.querySelector('.whatsapp-float')?.setAttribute('href', wa);

    if (url && url !== '#') {
        const main = document.getElementById('galleryMain');
        if (main) main.src = url;
        // marcar como activa la miniatura que coincida con la foto del color
        document.querySelectorAll('.producto-gallery-thumbs img').forEach(img => {
            img.classList.toggle('active', img.getAttribute('src') === url);
        });
    }
}

// Meta tags Open Graph + datos estructurados para vista previa al compartir y SEO
function actualizarSEO(p, foto, precio, sinStock) {
    const desc = (p.descripcion || `${p.nombre} — producto impreso en 3D.`).slice(0, 200);
    const set = (id, attr, val) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute(attr, val);
    };
    set('metaDescription', 'content', desc);
    set('ogTitle', 'content', `${p.nombre} — 3D by Aurora`);
    set('ogDescription', 'content', desc);
    if (foto) set('ogImage', 'content', safeHref(foto));

    // Si el servidor ya inyecto el JSON-LD (SEO server-side), no duplicarlo
    if (document.querySelector('script[type="application/ld+json"]')) return;

    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.nombre,
        description: desc,
        image: foto ? [safeHref(foto)] : [],
        category: p.categoria || undefined,
        offers: {
            '@type': 'Offer',
            priceCurrency: 'ARS',
            price: precio || 0,
            availability: sinStock ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        },
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
}

cargarProducto();
