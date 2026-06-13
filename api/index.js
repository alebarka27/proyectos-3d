const express = require('express');
const { sql } = require('@vercel/postgres');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// workaround: ensure no app.get('*') pattern for Express 5 compatibility

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(express.json());

/* ---- Autenticacion (sesion por cookie firmada, sin estado en servidor) ---- */

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 dias
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/style.css', '/app.js', '/api/login', '/api/logout']);

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

app.use((req, res, next) => {
    const authed = isAuthenticated(req);
    if (req.path === '/login.html' && authed) return res.redirect('/');
    if (PUBLIC_PATHS.has(req.path)) return next();
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
        console.log('Base de datos inicializada');

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
        const { nombre, codigo, categoria, linkArchivo, costo, precioVenta, vendidos, fotos, estado } = req.body;
        const fecha = new Date().toISOString().split('T')[0];
        await sql`
            INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha)
            VALUES (${id}, ${nombre || ''}, ${codigo || ''}, ${categoria || ''}, ${linkArchivo || ''},
                    ${parseFloat(costo) || 0}, ${parseFloat(precioVenta) || 0}, ${parseInt(vendidos) || 0},
                    ${fotos || ''}, ${estado || 'Planificado'}, ${fecha})
        `;
        const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${id}`;
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { nombre, codigo, categoria, linkArchivo, costo, precioVenta, vendidos, fotos, estado } = req.body;
        const { rowCount } = await sql`
            UPDATE proyectos SET
                nombre=${nombre || ''}, codigo=${codigo || ''}, categoria=${categoria || ''},
                linkarchivo=${linkArchivo || ''}, costo=${parseFloat(costo) || 0},
                precioventa=${parseFloat(precioVenta) || 0}, vendidos=${parseInt(vendidos) || 0},
                fotos=${fotos || ''}, estado=${estado || 'Planificado'}
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
