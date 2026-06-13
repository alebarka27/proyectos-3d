const express = require('express');
const { sql } = require('@vercel/postgres');
const path = require('path');
const fs = require('fs');

// workaround: ensure no app.get('*') pattern for Express 5 compatibility

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

            fs.renameSync(dbPath, dbPath + '.bak');
            console.log('proyectos.json migrado a Postgres y renombrado a proyectos.json.bak');
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

module.exports = app;
