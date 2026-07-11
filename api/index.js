const express = require('express');
const { sql } = require('@vercel/postgres');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ml = require('./ml');

// workaround: ensure no app.get('*') pattern for Express 5 compatibility

const app = express();
const PORT = process.env.PORT || 3000;

// Cache en el edge de Vercel para endpoints publicos (la tienda cambia poco).
// s-maxage: cachea 2 min; stale-while-revalidate: sirve cache viejo hasta 10 min
// mientras revalida en segundo plano.
const CACHE_PUBLICO = 'public, s-maxage=120, stale-while-revalidate=600';

app.set('trust proxy', true);
app.use(express.json());

/* ---- Autenticacion (sesion por cookie firmada, sin estado en servidor) ---- */

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 dias
const PUBLIC_PATHS = new Set(['/', '/index.html', '/login.html', '/login.js', '/style.css', '/gta.css', '/utils.js', '/icons.js', '/home.js', '/carrito.js', '/favicon.svg', '/api/login', '/api/logout', '/api/me', '/api/ml/status', '/api/ml/webhook', '/eshop', '/eshop.js', '/api/eshop', '/producto.html', '/producto.js', '/faq.html', '/nosotros.html', '/api/destacados', '/api/buscar', '/api/producto', '/robots.txt', '/sitemap.xml']);

function sign(value) {
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
    return `${value}.${hmac}`;
}

function verifyToken(token) {
    if (!token) return false;
    const sep = token.lastIndexOf('.');
    if (sep === -1) return false;
    const value = token.slice(0, sep);
    const hmac = token.slice(sep + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
    const a = Buffer.from(hmac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return Date.now() < parseInt(value, 10);
}

function parseCookies(req) {
    const header = req.headers.cookie;
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return cookies;
}

function isAuthenticated(req) {
    return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

/* ---- Rate limiting de login (en memoria, por IP) ---- */

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function isRateLimited(ip) {
    const entry = loginAttempts.get(ip);
    return !!entry && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailedLogin(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt < now) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
        entry.count++;
    }
}

app.post('/api/login', (req, res) => {
    if (isRateLimited(req.ip)) {
        return res.status(429).json({ error: 'Demasiados intentos. Esperá un minuto.' });
    }
    if ((req.body?.password || '') !== ADMIN_PASSWORD) {
        registerFailedLogin(req.ip);
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    loginAttempts.delete(req.ip);
    const expires = Date.now() + SESSION_MAX_AGE;
    res.cookie(COOKIE_NAME, sign(String(expires)), {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!process.env.VERCEL,
        maxAge: SESSION_MAX_AGE,
    });
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
    res.json({ authed: isAuthenticated(req) });
});

app.use((req, res, next) => {
    const authed = isAuthenticated(req);
    if (req.path === '/login.html' && authed) return res.redirect('/admin');
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (req.path.startsWith('/api/producto/')) return next();
    if (authed) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
    return res.redirect('/login.html');
});

/* ---- CSRF: validar Origin en mutaciones a la API ---- */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

app.use('/api', (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
        try {
            if (new URL(origin).host !== req.headers.host) {
                return res.status(403).json({ error: 'Origen no permitido' });
            }
        } catch {
            return res.status(403).json({ error: 'Origen no permitido' });
        }
    }
    next();
});

/* ---- Validación de montos en proyectos (POST/PUT) ----
   Costo y precio de venta tienen que ser números >= 0 si vienen con valor.
   Corre antes del gate de DB para rechazar datos rotos sin tocar la base. */

function montoInvalido(v) {
    if (v === undefined || v === null || v === '') return false; // vacío = 0, permitido
    const n = parseFloat(v);
    return isNaN(n) || n < 0;
}

app.use('/api/proyectos', (req, res, next) => {
    if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
        if (montoInvalido(req.body.costo) || montoInvalido(req.body.precioVenta)) {
            return res.status(400).json({ error: 'El costo y el precio de venta deben ser números mayores o iguales a 0' });
        }
    }
    next();
});

const publicDir = path.join(__dirname, '..', 'public');

/* ---- SEO server-side de la ficha de producto ----
   Los crawlers de WhatsApp/Instagram/Google no ejecutan JS, asi que los meta
   tags (titulo, descripcion, imagen) se inyectan aca antes de servir el HTML.
   Tiene que registrarse ANTES de express.static para ganarle al archivo plano. */

const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const setMetaById = (html, id, value) =>
    html.replace(new RegExp(`(<meta[^>]+id="${id}"[^>]*content=")[^"]*(")`), `$1${escapeAttr(value)}$2`);

let productoHTMLCache = null;

app.get('/producto.html', async (req, res, next) => {
    try {
        if (!productoHTMLCache) productoHTMLCache = fs.readFileSync(path.join(publicDir, 'producto.html'), 'utf-8');
    } catch {
        return next();
    }
    let html = productoHTMLCache;
    const id = String(req.query.id || '');
    if (id) {
        try {
            await ensureDB();
            const { rows } = await sql`
                SELECT nombre, categoria, fotos, precioventa, cantidad, descripcion FROM proyectos
                WHERE id = ${id} AND publicareshop = true
            `;
            if (rows.length) {
                const p = rows[0];
                const titulo = `${p.nombre} — 3D by Aurora`;
                const desc = (p.descripcion || `${p.nombre} — pieza impresa en 3D. Comprá por WhatsApp o Mercado Libre.`)
                    .replace(/\s+/g, ' ').trim().slice(0, 200);
                const foto = mlHighRes((p.fotos || '').split(',')[0]?.trim() || '');
                const url = `https://${req.headers.host}/producto.html?id=${encodeURIComponent(id)}`;
                const disponible = (parseInt(p.cantidad) || 0) > 0;

                html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(titulo)}</title>`);
                html = setMetaById(html, 'metaDescription', desc);
                html = setMetaById(html, 'ogTitle', titulo);
                html = setMetaById(html, 'ogDescription', desc);
                if (foto) html = setMetaById(html, 'ogImage', foto);

                const ld = {
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: p.nombre,
                    description: desc,
                    image: foto ? [foto] : [],
                    category: p.categoria || undefined,
                    offers: {
                        '@type': 'Offer',
                        priceCurrency: 'ARS',
                        price: parseFloat(p.precioventa) || 0,
                        availability: disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                        url,
                    },
                };
                const extra = `    <link rel="canonical" href="${escapeAttr(url)}">\n` +
                    `    <meta property="og:url" content="${escapeAttr(url)}">\n` +
                    `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n`;
                html = html.replace('</head>', extra + '</head>');
            }
        } catch (e) {
            console.warn('SEO producto:', e.message);
        }
    }
    res.set('Cache-Control', CACHE_PUBLICO);
    res.type('html').send(html);
});

/* ---- Indexacion en buscadores ---- */

app.get('/robots.txt', (req, res) => {
    const base = `https://${req.headers.host}`;
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /login.html\nDisallow: /admin\n\nSitemap: ${base}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        await ensureDB();
        const base = `https://${req.headers.host}`;
        const { rows } = await sql`SELECT id, fecha FROM proyectos WHERE publicareshop = true`;
        const urls = [
            { loc: `${base}/` },
            { loc: `${base}/eshop` },
            { loc: `${base}/faq.html` },
            { loc: `${base}/nosotros.html` },
            ...rows.map(r => ({ loc: `${base}/producto.html?id=${encodeURIComponent(r.id)}`, lastmod: r.fecha })),
        ];
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            urls.map(u => `  <url><loc>${u.loc.replace(/&/g, '&amp;')}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
            '\n</urlset>';
        res.set('Cache-Control', CACHE_PUBLICO);
        res.type('application/xml').send(xml);
    } catch (err) {
        res.status(500).type('text/plain').send('Error generando sitemap');
    }
});

if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

app.get('/eshop', (req, res) => {
    res.sendFile(path.join(publicDir, 'eshop.html'));
});

// Panel de administración (protegido: /admin no está en PUBLIC_PATHS,
// el middleware de auth redirige a /login.html si no hay sesión)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
});

let dbReady = false;
let dbInitPromise = null;

/* ---- Archivos del modelo ----
   Cada proyecto guarda en la columna `archivos` un JSON [{nombre, url}] con los
   links a sus archivos de impresion (STL/3MF/gcode, normalmente en Drive). */

function normalizarArchivos(valor) {
    let lista = valor;
    if (typeof valor === 'string') {
        try { lista = JSON.parse(valor); } catch { lista = []; }
    }
    if (!Array.isArray(lista)) lista = [];
    return JSON.stringify(lista
        .map(a => ({ nombre: String((a && a.nombre) || '').trim(), url: String((a && a.url) || '').trim() }))
        .filter(a => a.url));
}

// Acepta tanto un ID de archivo de Drive como un link completo y devuelve el ID.
function driveFileIdFrom(valor) {
    const v = String(valor || '').trim();
    let m = v.match(/\/d\/([a-zA-Z0-9_-]+)/);   // .../file/d/<ID>/view
    if (m) return m[1];
    m = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);      // ...?id=<ID>
    if (m) return m[1];
    return v;
}

// Migracion unica (idempotente): vuelca linkarchivo y drive_file_id de cada
// proyecto en la nueva lista `archivos`, para no perder los links ya cargados.
async function migrarArchivos() {
    const { rows } = await sql`
        SELECT id, linkarchivo, drive_file_id FROM proyectos
        WHERE (archivos = '' OR archivos IS NULL)
          AND (linkarchivo != '' OR drive_file_id != '')
    `;
    for (const p of rows) {
        const lista = [];
        if (p.linkarchivo) lista.push({ nombre: 'Archivo del modelo', url: p.linkarchivo });
        if (p.drive_file_id) {
            lista.push({ nombre: 'Archivo en Drive', url: `https://drive.google.com/file/d/${driveFileIdFrom(p.drive_file_id)}/view` });
        }
        await sql`UPDATE proyectos SET archivos = ${JSON.stringify(lista)} WHERE id = ${p.id}`;
    }
    if (rows.length) console.log(`Migrados los links de ${rows.length} proyectos a la lista de archivos`);
}

async function initDB() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS proyectos (
                id TEXT PRIMARY KEY,
                nombre TEXT NOT NULL DEFAULT '',
                codigo TEXT DEFAULT '',
                categoria TEXT DEFAULT '',
                linkarchivo TEXT DEFAULT '',
                costo REAL DEFAULT 0,
                precioventa REAL DEFAULT 0,
                vendidos INTEGER DEFAULT 0,
                fotos TEXT DEFAULT '',
                estado TEXT DEFAULT 'Planificado',
                fecha TEXT DEFAULT '',
                publicareshop BOOLEAN DEFAULT FALSE
            );
        `;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS publicareshop BOOLEAN DEFAULT FALSE;`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cantidad INTEGER DEFAULT 0;`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS ml_id TEXT DEFAULT '';`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT '';`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS destacado BOOLEAN DEFAULT FALSE;`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS colores TEXT DEFAULT '';`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS colorfotos TEXT DEFAULT '';`;
        // Columnas legado de la epoca de venta de STL (ya no se usan, se conservan los datos)
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS es_digital BOOLEAN DEFAULT FALSE;`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS drive_file_id TEXT DEFAULT '';`;
        // Archivos para imprimir cada modelo: JSON [{nombre, url}] por proyecto
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS archivos TEXT DEFAULT '';`;
        await migrarArchivos();
        // Ficha de impresion (organizador): filamento, colores usados y notas privadas
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS filamento TEXT DEFAULT '';`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS colores_usados TEXT DEFAULT '';`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS notas_impresion TEXT DEFAULT '';`;
        // Desglose de la calculadora (JSON {gramos, horas, extras}) para poder
        // recalcular el costo cuando cambia el precio del filamento
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS calc_desglose TEXT DEFAULT '';`;
        // Encargos: pedidos de clientes (WhatsApp, conocidos) con seña y fecha de entrega
        await sql`
            CREATE TABLE IF NOT EXISTS encargos (
                id TEXT PRIMARY KEY,
                cliente TEXT DEFAULT '',
                contacto TEXT DEFAULT '',
                detalle TEXT DEFAULT '',
                precio REAL DEFAULT 0,
                sena REAL DEFAULT 0,
                estado TEXT DEFAULT 'Pendiente',
                fecha TEXT DEFAULT '',
                fecha_entrega TEXT DEFAULT '',
                notas TEXT DEFAULT ''
            );
        `;
        await sql`
            CREATE TABLE IF NOT EXISTS categorias (
                nombre TEXT PRIMARY KEY
            );
        `;
        await sql`
            CREATE TABLE IF NOT EXISTS ventas (
                id TEXT PRIMARY KEY,
                proyectoid TEXT DEFAULT '',
                proyectonombre TEXT DEFAULT '',
                cantidad INTEGER DEFAULT 1,
                precioventa REAL DEFAULT 0,
                costo REAL DEFAULT 0,
                ganancia REAL DEFAULT 0,
                fecha TEXT DEFAULT ''
            );
        `;
        // Indices para acelerar las consultas mas frecuentes del catalogo publico
        await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_eshop ON proyectos (publicareshop);`;
        await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_categoria ON proyectos (categoria);`;
        await sql`CREATE INDEX IF NOT EXISTS idx_proyectos_ml_id ON proyectos (ml_id);`;
        await sql`CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas (fecha);`;
        console.log('Base de datos inicializada');
        await ml.initMLTokens().catch(e => console.log('initMLTokens:', e.message));

        const dbPath = path.join(__dirname, '..', 'proyectos.json');
        if (fs.existsSync(dbPath)) {
            const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            const data = Array.isArray(raw) ? { proyectos: raw, categorias: [], ventas: [] } : raw;

            const { rows: existing } = await sql`SELECT COUNT(*) as count FROM proyectos`;
            if (parseInt(existing[0].count) === 0 && data.proyectos?.length) {
                for (const p of data.proyectos) {
                    await sql`
                        INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha)
                        VALUES (${p.id}, ${p.nombre || ''}, ${p.codigo || ''}, ${p.categoria || ''}, ${p.linkArchivo || ''},
                                ${p.costo || 0}, ${p.precioVenta || 0}, ${p.vendidos || 0}, ${p.fotos || ''}, ${p.estado || 'Planificado'}, ${p.fecha || ''})
                    `;
                }
                console.log(`Migrados ${data.proyectos.length} proyectos`);
            }

            if (data.categorias?.length) {
                for (const c of data.categorias) {
                    await sql`INSERT INTO categorias (nombre) VALUES (${c}) ON CONFLICT DO NOTHING`;
                }
            }

            if (data.ventas?.length) {
                const { rows: vExisting } = await sql`SELECT COUNT(*) as count FROM ventas`;
                if (parseInt(vExisting[0].count) === 0) {
                    for (const v of data.ventas) {
                        await sql`
                            INSERT INTO ventas (id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha)
                            VALUES (${v.id}, ${v.proyectoId || ''}, ${v.proyectoNombre || ''}, ${v.cantidad || 1},
                                    ${v.precioVenta || 0}, ${v.costo || 0}, ${v.ganancia || 0}, ${v.fecha || ''})
                        `;
                    }
                    console.log(`Migradas ${data.ventas.length} ventas`);
                }
            }

            try {
                fs.renameSync(dbPath, dbPath + '.bak');
                console.log('proyectos.json migrado a Postgres y renombrado a proyectos.json.bak');
            } catch (e) {
                console.log('Migracion completada (no se pudo renombrar backup, filesystem read-only)');
            }
        }
    } catch (err) {
        console.error('initDB error:', err.message);
        throw err;
    }
}

async function ensureDB() {
    if (dbReady) return;
    if (!dbInitPromise) {
        dbInitPromise = initDB();
    }
    await dbInitPromise;
    dbReady = true;
}

app.use(async (req, res, next) => {
    try {
        await ensureDB();
        next();
    } catch (err) {
        res.status(500).json({ error: 'Error de base de datos: ' + err.message });
    }
});

app.get('/api/proyectos', async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM proyectos ORDER BY fecha DESC`;
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos', async (req, res) => {
    try {
        const id = Date.now().toString();
        const { nombre, codigo, categoria, costo, precioVenta, vendidos, fotos, estado, publicarEshop, cantidad, mlId, descripcion, destacado, archivos, filamento, coloresUsados, notasImpresion, calcDesglose } = req.body;
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO proyectos (id, nombre, codigo, categoria, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, archivos, filamento, colores_usados, notas_impresion, calc_desglose)
            VALUES (${id}, ${(nombre || '').trim()}, ${(codigo || '').trim()}, ${(categoria || '').trim()},
                    ${parseFloat(costo) || 0}, ${parseFloat(precioVenta) || 0}, ${parseInt(vendidos) || 0},
                    ${fotos || ''}, ${estado || 'Planificado'}, ${fecha}, ${!!publicarEshop}, ${parseInt(cantidad) || 0}, ${mlId || ''}, ${descripcion || ''}, ${!!destacado}, ${normalizarArchivos(archivos)},
                    ${(filamento || '').trim()}, ${(coloresUsados || '').trim()}, ${notasImpresion || ''}, ${calcDesglose || ''})
        `;
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Duplica un proyecto existente (sin ml_id ni ventas) para cargar variantes rapido.
app.post('/api/proyectos/:id/duplicar', async (req, res) => {
    try {
        const { rows: orig } = await sql`SELECT * FROM proyectos WHERE id = ${req.params.id}`;
        if (!orig.length) return res.status(404).json({ error: 'No encontrado' });
        const o = orig[0];
        const id = Date.now().toString();
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO proyectos (id, nombre, codigo, categoria, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, archivos, colores, colorfotos, filamento, colores_usados, notas_impresion, calc_desglose)
            VALUES (${id}, ${(o.nombre || '') + ' (copia)'}, ${o.codigo || ''}, ${o.categoria || ''},
                    ${o.costo || 0}, ${o.precioventa || 0}, 0, ${o.fotos || ''}, ${o.estado || 'Planificado'}, ${fecha},
                    false, ${o.cantidad || 0}, '', ${o.descripcion || ''}, false, ${o.archivos || ''}, ${o.colores || ''}, ${o.colorfotos || ''},
                    ${o.filamento || ''}, ${o.colores_usados || ''}, ${o.notas_impresion || ''}, ${o.calc_desglose || ''})
        `;
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Carga masiva: crea varios proyectos de una (cada item: nombre, precioVenta, categoria, ...).
app.post('/api/proyectos/bulk', async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ error: 'No se recibieron items' });
        const fecha = new Date().toISOString().split('T')[0];
        let creados = 0;
        for (let i = 0; i < items.length; i++) {
            const it = items[i] || {};
            if (!it.nombre) continue;
            const id = (Date.now() + i).toString();
            await sql`
                INSERT INTO proyectos (id, nombre, codigo, categoria, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado)
                VALUES (${id}, ${it.nombre}, ${it.codigo || ''}, ${it.categoria || ''},
                        ${parseFloat(it.costo) || 0}, ${parseFloat(it.precioVenta) || 0}, 0, ${it.fotos || ''},
                        'Planificado', ${fecha}, false, ${parseInt(it.cantidad) || 0}, '', ${it.descripcion || ''}, false)
            `;
            creados++;
        }
        res.json({ ok: true, creados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { nombre, codigo, categoria, costo, precioVenta, vendidos, fotos, estado, publicarEshop, cantidad, mlId, descripcion, destacado, archivos, filamento, coloresUsados, notasImpresion, calcDesglose } = req.body;
        // Campos que el body puede no traer: si vienen undefined se conserva
        // lo guardado (COALESCE con null)
        const archivosNuevos = archivos === undefined ? null : normalizarArchivos(archivos);
        const keep = v => v === undefined ? null : String(v);
        const { rowCount } = await sql`
            UPDATE proyectos SET
                nombre=${(nombre || '').trim()}, codigo=${(codigo || '').trim()}, categoria=${(categoria || '').trim()},
                costo=${parseFloat(costo) || 0},
                precioventa=${parseFloat(precioVenta) || 0}, vendidos=${parseInt(vendidos) || 0},
                fotos=${fotos || ''}, estado=${estado || 'Planificado'}, publicareshop=${!!publicarEshop},
                cantidad=${parseInt(cantidad) || 0}, ml_id=${mlId || ''},
                descripcion=${descripcion || ''}, destacado=${!!destacado},
                archivos=COALESCE(${archivosNuevos}, archivos),
                filamento=COALESCE(${keep(filamento)}, filamento),
                colores_usados=COALESCE(${keep(coloresUsados)}, colores_usados),
                notas_impresion=COALESCE(${keep(notasImpresion)}, notas_impresion),
                calc_desglose=COALESCE(${keep(calcDesglose)}, calc_desglose)
            WHERE id=${req.params.id}
        `;
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${req.params.id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/proyectos/:id', async (req, res) => {
    try {
        await sql`DELETE FROM proyectos WHERE id = ${req.params.id}`;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/proyectos/:id/eshop', async (req, res) => {
    try {
        const { publicarEshop } = req.body;
        await sql`UPDATE proyectos SET publicareshop=${!!publicarEshop} WHERE id=${req.params.id}`;
        const { rows } = await sql`SELECT id, publicareshop FROM proyectos WHERE id = ${req.params.id}`;
        if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/proyectos/:id/vender', async (req, res) => {
    try {
        const { rows: actual } = await sql`SELECT id, nombre, cantidad, costo, precioventa FROM proyectos WHERE id = ${req.params.id}`;
        if (actual.length === 0) return res.status(404).json({ error: 'No encontrado' });
        const p = actual[0];
        const cant = Math.max(0, (p.cantidad || 0) - 1);
        await sql`UPDATE proyectos SET cantidad=${cant} WHERE id=${req.params.id}`;
        const ventaId = Date.now().toString();
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO ventas (id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha)
            VALUES (${ventaId}, ${p.id}, ${p.nombre || ''}, 1, ${p.precioventa || 0}, ${p.costo || 0},
                    ${(p.precioventa || 0) - (p.costo || 0)}, ${fecha})
        `;
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${req.params.id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/eshop', async (req, res) => {
    try {
        const { categoria } = req.query;
        const { rows } = categoria
            ? await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores, destacado FROM proyectos WHERE publicareshop = true AND categoria = ${categoria} ORDER BY nombre`
            : await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores, destacado FROM proyectos WHERE publicareshop = true ORDER BY nombre`;
        res.set('Cache-Control', CACHE_PUBLICO);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/destacados', async (req, res) => {
    try {
        const { rows } = await sql`
            SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores FROM proyectos
            WHERE publicareshop = true
            ORDER BY destacado DESC, vendidos DESC
            LIMIT 8
        `;
        res.set('Cache-Control', CACHE_PUBLICO);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/buscar', async (req, res) => {
    try {
        const { q, categoria } = req.query;
        if (!q || q.trim().length < 1) return res.json([]);
        const term = `%${q.trim()}%`;
        const { rows } = categoria
            ? await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores FROM proyectos WHERE publicareshop = true AND (nombre ILIKE ${term} OR categoria ILIKE ${term}) AND categoria = ${categoria} ORDER BY nombre LIMIT 20`
            : await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores FROM proyectos WHERE publicareshop = true AND (nombre ILIKE ${term} OR categoria ILIKE ${term}) ORDER BY nombre LIMIT 20`;
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/producto/:id', async (req, res) => {
    try {
        const { rows } = await sql`
            SELECT id, nombre, codigo, categoria, fotos, precioventa, cantidad, ml_id, descripcion, estado, colores, colorfotos FROM proyectos
            WHERE id = ${req.params.id} AND publicareshop = true
        `;
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

        const p = rows[0];
        let similares = [];
        if (p.categoria) {
            const { rows: sim } = await sql`
                SELECT id, nombre, fotos, precioventa FROM proyectos
                WHERE publicareshop = true AND categoria = ${p.categoria} AND id != ${p.id}
                ORDER BY RANDOM() LIMIT 4
            `;
            similares = sim;
        }

        res.set('Cache-Control', CACHE_PUBLICO);
        res.json({ producto: p, similares });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/categorias', async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM categorias ORDER BY nombre`;
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categorias', async (req, res) => {
    try {
        const nombre = (req.body.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
        await sql`INSERT INTO categorias (nombre) VALUES (${nombre})`;
        const { rows } = await sql`SELECT * FROM categorias ORDER BY nombre`;
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Ya existe' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categorias/:nombre', async (req, res) => {
    try {
        const viejo = decodeURIComponent(req.params.nombre);
        const nuevo = (req.body.nombre || '').trim();
        if (!nuevo) return res.status(400).json({ error: 'Nombre requerido' });
        const { rowCount } = await sql`UPDATE categorias SET nombre=${nuevo} WHERE nombre=${viejo}`;
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrada' });
        await sql`UPDATE proyectos SET categoria=${nuevo} WHERE categoria=${viejo}`;
        const { rows } = await sql`SELECT * FROM categorias ORDER BY nombre`;
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Ya existe' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categorias/:nombre', async (req, res) => {
    try {
        const nombre = decodeURIComponent(req.params.nombre);
        await sql`DELETE FROM categorias WHERE nombre=${nombre}`;
        await sql`UPDATE proyectos SET categoria='' WHERE categoria=${nombre}`;
        const { rows } = await sql`SELECT * FROM categorias ORDER BY nombre`;
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ventas', async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM ventas ORDER BY fecha DESC`;
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ventas', async (req, res) => {
    try {
        const id = Date.now().toString();
        const { proyectoId, proyectoNombre, cantidad, precioVenta, costo } = req.body;
        const cant = parseInt(cantidad) || 1;
        const pv = parseFloat(precioVenta) || 0;
        const co = parseFloat(costo) || 0;
        const ganancia = (pv - co) * cant;
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO ventas (id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha)
            VALUES (${id}, ${proyectoId || ''}, ${proyectoNombre || ''}, ${cant}, ${pv}, ${co}, ${ganancia}, ${fecha})
        `;
        const { rows } = await sql`SELECT * FROM ventas WHERE id = ${id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ventas/:id', async (req, res) => {
    try {
        await sql`DELETE FROM ventas WHERE id = ${req.params.id}`;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---- Encargos (pedidos de clientes con seña y fecha de entrega) ---- */

const ESTADOS_ENCARGO = ['Pendiente', 'En proceso', 'Entregado', 'Cancelado'];

function bodyEncargo(body) {
    return {
        cliente: (body.cliente || '').trim(),
        contacto: (body.contacto || '').trim(),
        detalle: (body.detalle || '').trim(),
        precio: parseFloat(body.precio) || 0,
        sena: parseFloat(body.sena) || 0,
        estado: ESTADOS_ENCARGO.includes(body.estado) ? body.estado : 'Pendiente',
        fechaEntrega: (body.fechaEntrega || '').trim(),
        notas: body.notas || '',
    };
}

app.get('/api/encargos', async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM encargos ORDER BY fecha DESC`;
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/encargos', async (req, res) => {
    try {
        const e = bodyEncargo(req.body);
        if (!e.detalle && !e.cliente) return res.status(400).json({ error: 'Poné al menos el cliente o qué encargó' });
        const id = Date.now().toString();
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO encargos (id, cliente, contacto, detalle, precio, sena, estado, fecha, fecha_entrega, notas)
            VALUES (${id}, ${e.cliente}, ${e.contacto}, ${e.detalle}, ${e.precio}, ${e.sena}, ${e.estado}, ${fecha}, ${e.fechaEntrega}, ${e.notas})
        `;
        const { rows } = await sql`SELECT * FROM encargos WHERE id = ${id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/encargos/:id', async (req, res) => {
    try {
        const e = bodyEncargo(req.body);
        const { rowCount } = await sql`
            UPDATE encargos SET
                cliente=${e.cliente}, contacto=${e.contacto}, detalle=${e.detalle},
                precio=${e.precio}, sena=${e.sena}, estado=${e.estado},
                fecha_entrega=${e.fechaEntrega}, notas=${e.notas}
            WHERE id=${req.params.id}
        `;
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
        const { rows } = await sql`SELECT * FROM encargos WHERE id = ${req.params.id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cambio rapido de estado (avanzar Pendiente -> En proceso -> Entregado, etc.)
app.patch('/api/encargos/:id/estado', async (req, res) => {
    try {
        const estado = req.body.estado;
        if (!ESTADOS_ENCARGO.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
        const { rowCount } = await sql`UPDATE encargos SET estado=${estado} WHERE id=${req.params.id}`;
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
        const { rows } = await sql`SELECT * FROM encargos WHERE id = ${req.params.id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/encargos/:id', async (req, res) => {
    try {
        await sql`DELETE FROM encargos WHERE id = ${req.params.id}`;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---- Recalculo de costos ----
   Los proyectos creados desde la calculadora guardan su desglose (gramos,
   horas, extras) en calc_desglose. Con los precios actuales (material $/kg,
   kWh, desgaste/hora) se recalcula el costo de todos de una. */

app.post('/api/proyectos/recalcular-costos', async (req, res) => {
    try {
        const costoKg = parseFloat(req.body.costoMaterialKg);
        const kwh = parseFloat(req.body.kwh) || 0;
        const desgasteHora = parseFloat(req.body.desgasteHora) || 0;
        if (isNaN(costoKg) || costoKg < 0) return res.status(400).json({ error: 'Costo del material inválido' });

        const { rows } = await sql`SELECT id, nombre, costo, calc_desglose FROM proyectos WHERE calc_desglose != '' AND calc_desglose IS NOT NULL`;
        const cambios = [];
        for (const p of rows) {
            let d;
            try { d = JSON.parse(p.calc_desglose); } catch { continue; }
            const gramos = parseFloat(d.gramos) || 0;
            const horas = parseFloat(d.horas) || 0;
            const extras = (Array.isArray(d.extras) ? d.extras : []).reduce((s, e) => s + (parseFloat(e && e.costo) || 0), 0);
            // Misma formula que la calculadora del panel
            const nuevo = Math.round(((90 / 1000) * kwh * horas + (costoKg / 1000) * gramos * 1.1 + horas * desgasteHora + extras) * 100) / 100;
            if (Math.abs(nuevo - (p.costo || 0)) < 0.01) continue;
            await sql`UPDATE proyectos SET costo=${nuevo} WHERE id=${p.id}`;
            cambios.push({ id: p.id, nombre: p.nombre, antes: p.costo || 0, ahora: nuevo });
        }
        res.json({ ok: true, conDesglose: rows.length, actualizados: cambios.length, cambios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---- Mercado Libre Integration ---- */

app.get('/api/ml/auth', async (req, res) => {
    if (!process.env.ML_CLIENT_ID) return res.status(400).json({ error: 'ML_CLIENT_ID no configurado' });
    try {
        const authURL = await ml.getAuthURL();
        res.redirect(authURL);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ml/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send('Falta code');
        await ml.exchangeCode(code);
        res.redirect('/');
    } catch (err) {
        console.error('ML callback error:', err);
        res.status(500).send('Error al conectar con Mercado Libre: ' + err.message);
    }
});

app.get('/api/ml/status', async (req, res) => {
    try {
        const connected = await ml.isConnected();
        res.json({ connected });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ml/disconnect', async (req, res) => {
    try {
        const { sql } = require('@vercel/postgres');
        await sql`DELETE FROM ml_tokens WHERE id = 'main'`;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/ml-sync', async (req, res) => {
    try {
        const { rows } = await sql`
            SELECT ml_id, precioventa, cantidad, estado, nombre FROM proyectos WHERE id = ${req.params.id}
        `;
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        const p = rows[0];
        if (!p.ml_id) return res.status(400).json({ error: 'Este proyecto no tiene ml_id' });
        const itemId = ml.parseMLId(p.ml_id);
        const result = await ml.updateItem(itemId, {
            price: p.precioventa,
            available_quantity: p.cantidad,
            status: p.estado === 'Cancelado' ? 'paused' : 'active',
        });
        res.json({ ok: true, ml: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eleva una URL de imagen de ML a su version original (-O) y fuerza https
const mlHighRes = u => (u || '').replace(/^http:\/\//, 'https://').replace(/-[A-Z](\.(?:jpe?g|png|webp))$/i, '-O$1');

// Crea una publicacion nueva en ML desde los datos del producto y guarda el ml_id.
app.post('/api/proyectos/:id/ml-publish', async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${req.params.id}`;
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        const p = rows[0];
        if (p.ml_id) return res.status(400).json({ error: 'Este producto ya está publicado en ML' });

        const { categoryId, listingType, cantidad, pausar } = req.body || {};

        // Categoria: override manual o prediccion automatica por titulo
        let catId = categoryId;
        if (!catId) {
            const pred = await ml.predictCategory(p.nombre);
            catId = pred && pred.category_id;
        }
        if (!catId) return res.status(400).json({ error: 'No se pudo predecir la categoría. Indicá una manualmente.' });

        const fotos = (p.fotos || '').split(',').map(s => mlHighRes(s.trim())).filter(Boolean);
        const qty = parseInt(cantidad) > 0 ? parseInt(cantidad) : (p.cantidad > 0 ? p.cantidad : 100);

        const body = {
            title: (p.nombre || '').slice(0, 60),
            category_id: catId,
            price: p.precioventa || 0,
            currency_id: 'ARS',
            available_quantity: qty,
            buying_mode: 'buy_it_now',
            condition: 'new',
            listing_type_id: listingType || 'gold_special',
            pictures: fotos.map(url => ({ source: url })),
        };

        const item = await ml.createItem(body);

        // Por seguridad, dejar la publicacion pausada salvo que pidan publicarla viva
        if (pausar !== false) {
            try { await ml.updateItem(item.id, { status: 'paused' }); item.status = 'paused'; } catch (e) { console.warn('pausar ML:', e.message); }
        }
        if (p.descripcion) {
            try { await ml.setItemDescription(item.id, p.descripcion); } catch (e) { console.warn('descripcion ML:', e.message); }
        }

        await sql`UPDATE proyectos SET ml_id = ${item.id} WHERE id = ${p.id}`;
        res.json({ ok: true, ml_id: item.id, permalink: item.permalink, status: item.status });
    } catch (err) {
        // Propaga el error de ML (incluye que atributos faltan) para que el usuario lo vea
        res.status(400).json({ error: err.message });
    }
});

// Junta los colores de un item de ML (desde las variaciones con stock, o el
// atributo COLOR) y el mapa color -> foto correspondiente de esa variacion.
function extraerColoresYFotos(item) {
    const picById = {};
    for (const pic of item.pictures || []) {
        const url = mlHighRes(pic.url || pic.secure_url || '');
        if (url) picById[pic.id] = url;
    }
    const colores = [];
    const vistos = new Set();
    const colorFotos = {};
    const push = (name, picIds) => {
        const n = (name || '').trim();
        if (!n || vistos.has(n.toLowerCase())) return;
        vistos.add(n.toLowerCase());
        colores.push(n);
        const url = (picIds || []).map(id => picById[id]).find(Boolean);
        if (url) colorFotos[n] = url;
    };
    if (Array.isArray(item.variations)) {
        for (const v of item.variations) {
            if (v.available_quantity != null && v.available_quantity <= 0) continue;
            const c = (v.attribute_combinations || []).find(x => x.id === 'COLOR');
            if (c) push(c.value_name, v.picture_ids);
        }
    }
    if (!colores.length && Array.isArray(item.attributes)) {
        const c = item.attributes.find(a => a.id === 'COLOR');
        if (c) push(c.value_name, null);
    }
    return { colores: colores.join(','), colorFotos: JSON.stringify(colorFotos) };
}

app.post('/api/ml/import', async (req, res) => {
    try {
        const userId = await ml.getUserId();
        if (!userId) return res.status(400).json({ error: 'ML no conectado' });
        const itemIds = await ml.searchItems(userId);
        const items = await ml.getItemsDetails(itemIds);

        const { rows: existentes } = await sql`SELECT id, ml_id, publicareshop FROM proyectos WHERE ml_id != ''`;
        const yaImportados = new Map(existentes.map(r => [ml.parseMLId(r.ml_id), r]));

        const fecha = new Date().toISOString().split('T')[0];
        let importados = 0;
        let actualizados = 0;
        for (const item of items) {
            const fotos = item.pictures?.length
                ? item.pictures.map(p => mlHighRes(p.url || p.secure_url || '')).filter(Boolean).join(',')
                : mlHighRes(item.thumbnail || '');
            const publicar = item.status === 'active';
            const { colores, colorFotos } = extraerColoresYFotos(item);

            // La descripcion real de ML vive en un endpoint aparte; short_description suele venir vacio
            let descripcion = item.short_description?.content || '';
            if (!descripcion) {
                try { descripcion = await ml.getItemDescription(item.id); } catch { descripcion = ''; }
            }

            if (yaImportados.has(item.id)) {
                // actualizar estado/precio/stock/colores; completar fotos y descripcion si estaban vacias
                const existing = yaImportados.get(item.id);
                await sql`
                    UPDATE proyectos SET
                        precioventa = ${item.price || 0},
                        cantidad = ${item.available_quantity || 0},
                        publicareshop = ${publicar},
                        colores = ${colores},
                        colorfotos = ${colorFotos},
                        fotos = CASE WHEN fotos = '' OR fotos IS NULL THEN ${fotos} ELSE fotos END,
                        descripcion = CASE WHEN descripcion = '' OR descripcion IS NULL THEN ${descripcion} ELSE descripcion END
                    WHERE id = ${existing.id}
                `;
                actualizados++;
                continue;
            }

            const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
            await sql`
                INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, colores, colorfotos)
                VALUES (${id}, ${item.title || ''}, '', '', '', 0, ${item.price || 0}, 0, ${fotos}, 'Terminado', ${fecha}, ${publicar}, ${item.available_quantity || 0}, ${item.id}, ${descripcion}, ${colores}, ${colorFotos})
            `;
            yaImportados.set(item.id, { id });
            importados++;
        }
        res.json({ ok: true, importados, actualizados, total: items.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ml/webhook', async (req, res) => {
    try {
        const { topic, resource, user_id } = req.body;
        if (!topic) return res.sendStatus(400);

        // Validar que la notificacion sea para nuestra cuenta de ML (evita POSTs falsos)
        const ourUserId = await ml.getUserId();
        if (ourUserId && user_id && String(user_id) !== String(ourUserId)) {
            console.warn(`Webhook ML ignorado: user_id ${user_id} no coincide con ${ourUserId}`);
            return res.sendStatus(200);
        }

        if (topic === 'orders_v2' && resource) {
            const orderId = resource.split('/').pop();
            const order = await ml.getOrder(orderId);
            for (const item of order.order_items || []) {
                const mlItemId = item.item.id;
                const cant = Math.max(1, parseInt(item.quantity) || 1);
                const precio = item.unit_price || 0;
                const { rows } = await sql`SELECT id, nombre FROM proyectos WHERE ml_id LIKE '%' || ${mlItemId} || '%'`;
                if (rows.length) {
                    const pId = rows[0].id;
                    await sql`UPDATE proyectos SET cantidad = GREATEST(0, cantidad - ${cant}) WHERE id = ${pId}`;
                    const ventaId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
                    const fecha = new Date().toISOString().split('T')[0];
                    await sql`
                        INSERT INTO ventas (id, proyectoid, cantidad, precioventa, costo, ganancia, fecha)
                        VALUES (${ventaId}, ${pId}, ${cant}, ${precio}, 0, ${precio * cant}, ${fecha})
                    `;
                    console.log(`Venta ML auto-registrada: ${mlItemId} x${cant} -> proyecto ${pId}`);
                }
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('ML webhook error:', err);
        res.sendStatus(200);
    }
});

app.get('/faq.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'faq.html'));
});

app.get('/nosotros.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'nosotros.html'));
});

app.use((req, res) => {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

if (require.main === module) {
    dbInitPromise = initDB();
    dbInitPromise.then(() => {
        dbReady = true;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    }).catch(err => {
        console.error('Error al inicializar DB:', err);
        process.exit(1);
    });
}

app._auth = { sign, verifyToken, parseCookies, isAuthenticated, COOKIE_NAME };
app._seo = { escapeAttr, setMetaById };
app._rateLimit = { loginAttempts, isRateLimited, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS };

module.exports = app;
