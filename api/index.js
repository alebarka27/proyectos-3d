const express = require('express');
const { sql } = require('@vercel/postgres');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ml = require('./ml');
const drive = require('./drive');
const { Readable } = require('stream');

// workaround: ensure no app.get('*') pattern for Express 5 compatibility

const app = express();
const PORT = process.env.PORT || 3000;

// Cache en el edge de Vercel para endpoints publicos (la tienda cambia poco).
// s-maxage: cachea 2 min; stale-while-revalidate: sirve cache viejo hasta 10 min
// mientras revalida en segundo plano.
const CACHE_PUBLICO = 'public, s-maxage=120, stale-while-revalidate=600';

// Archivos digitales mas pesados que esto se entregan redirigiendo directo a Drive
// (mas rapido, no satura la funcion serverless). Mas chicos se sirven por stream.
const DESCARGA_PROXY_MAX_MB = parseInt(process.env.DESCARGA_PROXY_MAX_MB) || 80;

app.set('trust proxy', true);
app.use(express.json());

/* ---- Autenticacion (sesion por cookie firmada, sin estado en servidor) ---- */

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 dias
const PUBLIC_PATHS = new Set(['/', '/login.html', '/login.js', '/style.css', '/app.js', '/utils.js', '/icons.js', '/favicon.svg', '/api/login', '/api/logout', '/api/me', '/api/ml/status', '/api/ml/webhook', '/eshop', '/eshop.js', '/api/eshop', '/producto.html', '/producto.js', '/faq.html', '/nosotros.html', '/api/destacados', '/api/buscar', '/api/producto']);

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
    if (req.path === '/login.html' && authed) return res.redirect('/');
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (req.path.startsWith('/api/producto/')) return next();
    if (req.path.startsWith('/api/descargar/')) return next();
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

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

app.get('/eshop', (req, res) => {
    res.sendFile(path.join(publicDir, 'eshop.html'));
});

let dbReady = false;
let dbInitPromise = null;

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
        // Productos digitales (archivos STL servidos desde Google Drive)
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS es_digital BOOLEAN DEFAULT FALSE;`;
        await sql`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS drive_file_id TEXT DEFAULT '';`;
        // Tokens de descarga generados al vender un producto digital
        await sql`
            CREATE TABLE IF NOT EXISTS descargas (
                token TEXT PRIMARY KEY,
                proyectoid TEXT DEFAULT '',
                ml_order_id TEXT DEFAULT '',
                vence BIGINT DEFAULT 0,
                descargas_restantes INTEGER DEFAULT 5,
                fecha TEXT DEFAULT ''
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
        const { nombre, codigo, categoria, linkArchivo, costo, precioVenta, vendidos, fotos, estado, publicarEshop, cantidad, mlId, descripcion, destacado, esDigital, driveFileId } = req.body;
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, es_digital, drive_file_id)
            VALUES (${id}, ${nombre || ''}, ${codigo || ''}, ${categoria || ''}, ${linkArchivo || ''},
                    ${parseFloat(costo) || 0}, ${parseFloat(precioVenta) || 0}, ${parseInt(vendidos) || 0},
                    ${fotos || ''}, ${estado || 'Planificado'}, ${fecha}, ${!!publicarEshop}, ${parseInt(cantidad) || 0}, ${mlId || ''}, ${descripcion || ''}, ${!!destacado}, ${!!esDigital}, ${driveFileId || ''})
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
            INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, es_digital, drive_file_id, colores, colorfotos)
            VALUES (${id}, ${(o.nombre || '') + ' (copia)'}, ${o.codigo || ''}, ${o.categoria || ''}, ${o.linkarchivo || ''},
                    ${o.costo || 0}, ${o.precioventa || 0}, 0, ${o.fotos || ''}, ${o.estado || 'Planificado'}, ${fecha},
                    false, ${o.cantidad || 0}, '', ${o.descripcion || ''}, false, ${o.es_digital || false}, ${o.drive_file_id || ''}, ${o.colores || ''}, ${o.colorfotos || ''})
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
                INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, es_digital, drive_file_id)
                VALUES (${id}, ${it.nombre}, ${it.codigo || ''}, ${it.categoria || ''}, '',
                        ${parseFloat(it.costo) || 0}, ${parseFloat(it.precioVenta) || 0}, 0, ${it.fotos || ''},
                        'Planificado', ${fecha}, false, ${parseInt(it.cantidad) || 0}, '', ${it.descripcion || ''}, false,
                        ${!!it.esDigital}, ${it.driveFileId || ''})
            `;
            creados++;
        }
        res.json({ ok: true, creados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Link directo de Google Drive del archivo del producto + mensaje listo para copiar
// y pegarle al comprador en el chat de ML (entrega manual). El archivo debe estar
// compartido en Drive como "cualquiera con el enlace" (lector).
app.get('/api/proyectos/:id/download-link', async (req, res) => {
    try {
        const { rows } = await sql`SELECT id, nombre, es_digital, drive_file_id FROM proyectos WHERE id = ${req.params.id}`;
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        const p = rows[0];
        if (!p.es_digital || !p.drive_file_id) return res.json({ disponible: false, link: '', mensaje: '' });

        const fileId = drive.fileIdFrom(p.drive_file_id);
        const link = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
        const mensaje = `¡Hola! Somos Aurora3, ¡muchas gracias por tu compra! Acá tenés tu archivo: ${link} Podés descargarlo o guardarlo en tu Drive, te queda para siempre. ¡Que lo disfrutes!`;
        res.json({ disponible: true, link, mensaje });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { nombre, codigo, categoria, linkArchivo, costo, precioVenta, vendidos, fotos, estado, publicarEshop, cantidad, mlId, descripcion, destacado, esDigital, driveFileId } = req.body;
        const { rowCount } = await sql`
            UPDATE proyectos SET
                nombre=${nombre || ''}, codigo=${codigo || ''}, categoria=${categoria || ''},
                linkarchivo=${linkArchivo || ''}, costo=${parseFloat(costo) || 0},
                precioventa=${parseFloat(precioVenta) || 0}, vendidos=${parseInt(vendidos) || 0},
                fotos=${fotos || ''}, estado=${estado || 'Planificado'}, publicareshop=${!!publicarEshop},
                cantidad=${parseInt(cantidad) || 0}, ml_id=${mlId || ''},
                descripcion=${descripcion || ''}, destacado=${!!destacado},
                es_digital=${!!esDigital}, drive_file_id=${driveFileId || ''}
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
            ? await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores FROM proyectos WHERE publicareshop = true AND categoria = ${categoria} ORDER BY nombre`
            : await sql`SELECT id, nombre, categoria, fotos, precioventa, cantidad, ml_id, colores FROM proyectos WHERE publicareshop = true ORDER BY nombre`;
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
            ORDER BY vendidos DESC, destacado DESC
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

// Descarga de archivo digital (STL) mediante token unico. Publico: el comprador
// llega aca desde el mensaje post-venta de ML. Valida vencimiento y cupo, y sirve
// el archivo desde Google Drive sin exponer el link real de Drive.
app.get('/api/descargar/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { rows } = await sql`SELECT * FROM descargas WHERE token = ${token}`;
        if (!rows.length) return res.status(404).send('Link de descarga inválido.');
        const d = rows[0];
        // vence puede venir como string (BIGINT). 0 = no vence nunca.
        if (Number(d.vence) > 0 && Date.now() > Number(d.vence)) return res.status(410).send('Este link de descarga venció.');
        if (d.descargas_restantes <= 0) return res.status(410).send('Se agotaron las descargas de este link.');

        const { rows: pr } = await sql`SELECT nombre, drive_file_id FROM proyectos WHERE id = ${d.proyectoid}`;
        if (!pr.length || !pr[0].drive_file_id) return res.status(404).send('Archivo no disponible.');
        const fileId = drive.fileIdFrom(pr[0].drive_file_id);

        const meta = await drive.getFileMeta(fileId).catch(() => ({}));

        // Archivos pesados: redirigir directo a Drive (rapido, no satura el server).
        // Requiere que ese archivo este compartido como "cualquiera con el enlace".
        if (meta.size && Number(meta.size) > DESCARGA_PROXY_MAX_MB * 1024 * 1024) {
            await sql`UPDATE descargas SET descargas_restantes = descargas_restantes - 1 WHERE token = ${token}`
                .catch(e => console.error('No se pudo descontar descarga:', e.message));
            return res.redirect(302, `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`);
        }

        const fileRes = await drive.getFileResponse(fileId);

        const nombreBase = (pr[0].nombre || 'archivo').trim().replace(/[^\w\-]+/g, '_') || 'archivo';
        const ext = (meta.name && meta.name.includes('.')) ? meta.name.split('.').pop() : 'stl';
        const filename = `${nombreBase}.${ext}`;

        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        if (meta.size) res.setHeader('Content-Length', meta.size);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Descontar un cupo solo si la descarga se completa
        res.on('finish', () => {
            sql`UPDATE descargas SET descargas_restantes = descargas_restantes - 1 WHERE token = ${token}`
                .catch(e => console.error('No se pudo descontar descarga:', e.message));
        });

        Readable.fromWeb(fileRes.body).pipe(res);
    } catch (err) {
        console.error('Descarga error:', err);
        if (!res.headersSent) res.status(500).send('Error al descargar el archivo. Probá de nuevo más tarde.');
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
                const { rows } = await sql`SELECT id, nombre, es_digital, drive_file_id FROM proyectos WHERE ml_id LIKE '%' || ${mlItemId} || '%'`;
                if (rows.length) {
                    const proy = rows[0];
                    const pId = proy.id;
                    await sql`UPDATE proyectos SET cantidad = GREATEST(0, cantidad - ${cant}) WHERE id = ${pId}`;
                    const ventaId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
                    const fecha = new Date().toISOString().split('T')[0];
                    await sql`
                        INSERT INTO ventas (id, proyectoid, cantidad, precioventa, costo, ganancia, fecha)
                        VALUES (${ventaId}, ${pId}, ${cant}, ${precio}, 0, ${precio * cant}, ${fecha})
                    `;
                    console.log(`Venta ML auto-registrada: ${mlItemId} x${cant} -> proyecto ${pId}`);
                    // Nota: la entrega del archivo digital es manual (ML bloquea el envio
                    // de mensajes con links por API). El vendedor copia el link del producto
                    // desde el panel y lo pega en el chat de ML. Ver /api/proyectos/:id/download-link
                }
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('ML webhook error:', err);
        res.sendStatus(200);
    }
});

app.get('/producto.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'producto.html'));
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
app._rateLimit = { loginAttempts, isRateLimited, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS };

module.exports = app;
