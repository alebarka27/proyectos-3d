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
  gta.css                 — tema "Studio" (estética gantri.com, clara y editorial), SOLO páginas públicas
  utils.js                — helpers compartidos (incluye renderProductoCard)
  faq.html / nosotros.html — páginas estáticas públicas
```

### Tema visual de la tienda

Las páginas públicas usan `gta.css` (cargado después de `style.css`): tema
"Studio" inspirado en gantri.com — fondo blanco, tipografía Inter, botones
negros, fotos de producto sobre gris cálido (`--surface-2`) y secciones con
hairlines en lugar de cajas. El archivo conserva el nombre `gta.css` (y varias
clases conservan el prefijo `vice-`) por compatibilidad con `PUBLIC_PATHS`,
`vercel.json` y el HTML existente. El panel admin y el login NO cargan `gta.css`
(siguen con el tema oscuro base y la fuente Outfit) — si se
agrega un archivo estático nuevo que usen las páginas públicas, hay que sumarlo
a `PUBLIC_PATHS` en `api/index.js` o los visitantes sin sesión no lo van a poder cargar.

## Base de datos (Vercel Postgres)

Cuatro tablas, creadas automáticamente al arrancar:

- **proyectos**: id, nombre, codigo, categoria, costo, precioventa, vendidos, fotos, estado, fecha, publicareshop, cantidad, ml_id, descripcion, destacado, colores, colorfotos, archivos, filamento, colores_usados, notas_impresion, calc_desglose
- **categorias**: nombre (PK)
- **ventas**: id, proyectoid, proyectonombre, cantidad, precioventa, costo, ganancia, fecha
- **encargos**: id, cliente, contacto, detalle, precio, sena, estado (Pendiente/En proceso/Entregado/Cancelado), fecha, fecha_entrega, notas, items

`encargos.items` es un JSON `[{proyectoId, nombre, cantidad, precio}]`: los
productos del encargo, que pueden referenciar proyectos del catálogo
(`proyectoId`) o ser items libres (`proyectoId` vacío). Al entregar un encargo
con items, el admin ofrece registrar una venta por item (con el costo real del
proyecto si es del catálogo) y descuenta el stock.

`archivos` guarda un JSON `[{nombre, url}]` con los links a los archivos de
impresión de cada modelo (STL/3MF/gcode, normalmente en Drive). Se administran
desde la vista de detalle del admin (se abre al hacer click en una fila de la
tabla de proyectos). `filamento`, `colores_usados` y `notas_impresion` son la
ficha de impresión (privada, no se muestra en la tienda). `calc_desglose` guarda
el JSON `{gramos, horas, extras}` de la calculadora al crear el proyecto desde
ahí, y lo usa `POST /api/proyectos/recalcular-costos` para actualizar todos los
costos cuando cambia el precio del filamento. Las columnas `linkarchivo`,
`es_digital` y `drive_file_id` son legado de cuando se vendían STL (ya no se
venden): se conservan los datos pero nada las usa; al arrancar se migran a
`archivos` si esta está vacía.

Al arrancar por primera vez, migra datos desde `proyectos.json` si existe y la DB está vacía.

**Importante**: la API devuelve las filas tal cual salen de Postgres, con nombres de
columna en minúsculas (`precioventa`, `proyectonombre`, `publicareshop`).
En el frontend hay que leer esos nombres en minúsculas. El camelCase (`precioVenta`,
`mlId`) solo se usa en los *bodies* que el frontend envía a la API (POST/PUT).

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
| POST | `/api/proyectos/recalcular-costos` | ✅ | Recalcula costos de proyectos con desglose de calculadora |
| GET/POST/PUT/DELETE | `/api/categorias` | ✅ | CRUD de categorías |
| GET/POST/DELETE | `/api/ventas` | ✅ | CRUD de ventas |
| GET/POST/PUT/DELETE | `/api/encargos` | ✅ | CRUD de encargos (+ PATCH `/api/encargos/:id/estado`) |
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

- Sincronización de inventario con MercadoLibre (bidireccional)
- Imagen Open Graph propia (PNG 1200×630 con el tema claro) para los links compartidos
