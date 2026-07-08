# proyectos-3d — Gestor de Proyectos de Impresión 3D

Aplicación web para gestionar un emprendimiento de impresión 3D: catálogo de productos, ventas, integración con MercadoLibre y tienda online pública (eshop).

## Stack

- **Backend**: Node.js + Express 5, `api/index.js` es el entry point y la única serverless function de Vercel
- **Frontend**: HTML/CSS/JS vanilla, sin framework, en `/public`
- **Base de datos**: Vercel Postgres (`@vercel/postgres`, SQL crudo con template literals)
- **Deploy**: Vercel (serverless). Config en `vercel.json`
- **Integración**: MercadoLibre OAuth2 + webhooks (`api/ml.js`)

## Estructura

```
api/
  index.js     — servidor Express, todas las rutas API, init de DB
  ml.js        — lógica de MercadoLibre (OAuth2, tokens, items, webhooks)
public/
  index.html / home.js    — home pública (hero, destacados, categorías)
  admin.html / app.js     — panel de admin (se sirve en /admin, requiere login)
  eshop.html / eshop.js   — tienda pública (filtros, orden, lazy load)
  producto.html / producto.js  — página de producto individual (pública)
  login.html / login.js   — login de admin (redirige a /admin)
  carrito.js              — carrito de pedido (localStorage → mensaje de WhatsApp)
  style.css               — estilos base (admin + tienda)
  gta.css                 — tema "Vice" (estética GTA VI), SOLO páginas públicas
  utils.js                — helpers compartidos (incluye renderProductoCard)
  faq.html / nosotros.html — páginas estáticas públicas
```

### Tema visual de la tienda

Las páginas públicas usan `gta.css` (cargado después de `style.css`): paleta
Vice City (rosa/naranja/violeta), títulos en Bebas Neue con degradado, grano de
película y glow neón. El panel admin y el login NO cargan `gta.css` — si se
agrega un archivo estático nuevo que usen las páginas públicas, hay que sumarlo
a `PUBLIC_PATHS` en `api/index.js` o los visitantes sin sesión no lo van a poder cargar.

## Base de datos (Vercel Postgres)

Tres tablas, creadas automáticamente al arrancar:

- **proyectos**: id, nombre, codigo, categoria, linkarchivo, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado
- **categorias**: nombre (PK)
- **ventas**: id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha

Al arrancar por primera vez, migra datos desde `proyectos.json` si existe y la DB está vacía.

## Rutas API principales

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/proyectos` | ✅ | Lista todos los proyectos |
| POST | `/api/proyectos` | ✅ | Crear proyecto |
| PUT | `/api/proyectos/:id` | ✅ | Editar proyecto |
| DELETE | `/api/proyectos/:id` | ✅ | Eliminar proyecto |
| PATCH | `/api/proyectos/:id/vender` | ✅ | Registrar venta (baja cantidad en 1) |
| PATCH | `/api/proyectos/:id/eshop` | ✅ | Toggle publicar en eshop |
| POST | `/api/proyectos/:id/ml-sync` | ✅ | Sincronizar con ML |
| GET | `/api/eshop` | ❌ | Productos públicos de la tienda |
| GET | `/api/destacados` | ❌ | Productos destacados (para home) |
| GET | `/api/buscar` | ❌ | Búsqueda pública |
| GET | `/api/producto/:id` | ❌ | Detalle de producto + similares |
| GET/POST/PUT/DELETE | `/api/categorias` | ✅ | CRUD de categorías |
| GET/POST/DELETE | `/api/ventas` | ✅ | CRUD de ventas |
| GET | `/api/ml/auth` | ✅ | Iniciar OAuth ML |
| GET | `/api/ml/callback` | ❌ | Callback OAuth ML |
| GET | `/api/ml/status` | ❌ | Estado de conexión ML |
| POST | `/api/ml/disconnect` | ✅ | Desconectar ML |
| POST | `/api/ml/import` | ✅ | Importar productos desde ML |
| POST | `/api/ml/webhook` | ❌ | Webhook de órdenes ML |

## Autenticación

- Sesión sin estado: cookie HMAC-SHA256 firmada con `SESSION_SECRET`
- Un solo usuario admin con `ADMIN_PASSWORD`
- El panel vive en `/admin` (protegido); `/` es la home pública de la tienda
- Rate limiting de login en memoria: 5 intentos / 60 segundos por IP
- Protección CSRF: valida `Origin` header en mutaciones

## Variables de entorno necesarias

```
POSTGRES_URL=         # Vercel Postgres connection string
SESSION_SECRET=       # Secret para firmar cookies
ADMIN_PASSWORD=       # Contraseña del panel admin
ML_CLIENT_ID=         # App ID de MercadoLibre
ML_CLIENT_SECRET=     # Secret de MercadoLibre
ML_REDIRECT_URI=      # https://tu-dominio.vercel.app/api/ml/callback
```

Para desarrollo local: crear `.env` con estas variables (no está en git).

## Arrancar localmente

```bash
npm install
# Crear .env con las variables (ver .env.example)
node api/index.js
# o
.\iniciar.bat
```

Para desarrollo con Vercel CLI (simula el entorno serverless):
```bash
npm run dev   # vercel dev
```

## Deploy

Push a `main` en GitHub → Vercel detecta y deploya automáticamente.

## Pendiente / Próximos pasos

- Mejoras en el catálogo del panel admin
- Sincronización de inventario con MercadoLibre (bidireccional)
- Imagen Open Graph propia (PNG 1200×630 con la paleta Vice) para los links compartidos
