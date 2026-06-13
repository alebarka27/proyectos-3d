const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: false } } : {})
});

app.use(express.json());

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
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
            CREATE TABLE IF NOT EXISTS categorias (
                nombre TEXT PRIMARY KEY
            );
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
        `);
        console.log('Base de datos inicializada');

        const dbPath = path.join(__dirname, '..', 'proyectos.json');
        if (fs.existsSync(dbPath)) {
            const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
            const data = Array.isArray(raw) ? { proyectos: raw, categorias: [], ventas: [] } : raw;

            const { rows: existing } = await client.query('SELECT COUNT(*) as count FROM proyectos');
            if (parseInt(existing[0].count) === 0 && data.proyectos?.length) {
                for (const p of data.proyectos) {
                    await client.query(
                        `INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                        [p.id, p.nombre || '', p.codigo || '', p.categoria || '', p.linkArchivo || '',
                            p.costo || 0, p.precioVenta || 0, p.vendidos || 0, p.fotos || '', p.estado || 'Planificado', p.fecha || '']
                    );
                }
                console.log(`Migrados ${data.proyectos.length} proyectos`);
            }

            if (data.categorias?.length) {
                for (const c of data.categorias) {
                    await client.query('INSERT INTO categorias (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
                }
            }

            if (data.ventas?.length) {
                const { rows: vExisting } = await client.query('SELECT COUNT(*) as count FROM ventas');
                if (parseInt(vExisting[0].count) === 0) {
                    for (const v of data.ventas) {
                        await client.query(
                            `INSERT INTO ventas (id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                            [v.id, v.proyectoId || '', v.proyectoNombre || '', v.cantidad || 1,
                                v.precioVenta || 0, v.costo || 0, v.ganancia || 0, v.fecha || '']
                        );
                    }
                    console.log(`Migradas ${data.ventas.length} ventas`);
                }
            }

            fs.renameSync(dbPath, dbPath + '.bak');
            console.log('proyectos.json migrado a Postgres y renombrado a proyectos.json.bak');
        }
    } finally {
        client.release();
    }
}

app.get('/api/proyectos', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM proyectos ORDER BY fecha DESC');
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
        await pool.query(
            `INSERT INTO proyectos (id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [id, nombre || '', codigo || '', categoria || '', linkArchivo || '',
                parseFloat(costo) || 0, parseFloat(precioVenta) || 0, parseInt(vendidos) || 0,
                fotos || '', estado || 'Planificado', fecha]
        );
        const { rows } = await pool.query('SELECT * FROM proyectos WHERE id = $1', [id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { nombre, codigo, categoria, linkArchivo, costo, precioVenta, vendidos, fotos, estado } = req.body;
        const { rowCount } = await pool.query(
            `UPDATE proyectos SET nombre=$1, codigo=$2, categoria=$3, linkarchivo=$4, costo=$5,
             precioventa=$6, vendidos=$7, fotos=$8, estado=$9 WHERE id=$10`,
            [nombre || '', codigo || '', categoria || '', linkArchivo || '',
                parseFloat(costo) || 0, parseFloat(precioVenta) || 0, parseInt(vendidos) || 0,
                fotos || '', estado || 'Planificado', req.params.id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
        const { rows } = await pool.query('SELECT * FROM proyectos WHERE id = $1', [req.params.id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/proyectos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM proyectos WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/categorias', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM categorias ORDER BY nombre');
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categorias', async (req, res) => {
    try {
        const nombre = (req.body.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
        await pool.query('INSERT INTO categorias (nombre) VALUES ($1)', [nombre]);
        const { rows } = await pool.query('SELECT * FROM categorias ORDER BY nombre');
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
        const { rowCount } = await pool.query('UPDATE categorias SET nombre=$1 WHERE nombre=$2', [nuevo, viejo]);
        if (rowCount === 0) return res.status(404).json({ error: 'No encontrada' });
        await pool.query('UPDATE proyectos SET categoria=$1 WHERE categoria=$2', [nuevo, viejo]);
        const { rows } = await pool.query('SELECT * FROM categorias ORDER BY nombre');
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Ya existe' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categorias/:nombre', async (req, res) => {
    try {
        const nombre = decodeURIComponent(req.params.nombre);
        await pool.query('DELETE FROM categorias WHERE nombre=$1', [nombre]);
        await pool.query("UPDATE proyectos SET categoria='' WHERE categoria=$1", [nombre]);
        const { rows } = await pool.query('SELECT * FROM categorias ORDER BY nombre');
        res.json(rows.map(r => r.nombre));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ventas', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM ventas ORDER BY fecha DESC');
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
        await pool.query(
            `INSERT INTO ventas (id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, proyectoId || '', proyectoNombre || '', cant, pv, co, ganancia, fecha]
        );
        const { rows } = await pool.query('SELECT * FROM ventas WHERE id = $1', [id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ventas/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ventas WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

if (require.main === module) {
    initDB().then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    }).catch(err => {
        console.error('Error al inicializar DB:', err);
        process.exit(1);
    });
}

module.exports = app;
