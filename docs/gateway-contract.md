# Integración del frontend con Gateway

Revisión: 2026-11-07. Todos los cambios están en este frontend.

Estado inicial: rama `pp3/gateway-frontend`, árbol limpio, HEAD `5232dd7`.
`upstream`: https://github.com/PabloHD2024/Ecommerce_Frontend_PP3.git
`origin`: https://github.com/ignaci0vidal/pp3-frontend-alternativo.git
Se conserva el historial y se incluye atribución en README y pie del sitio.

## Fuentes del contrato

Se consultaron copias locales, sin modificarlas:

- `../EcommerceApp2/api-gateway/src/app.js` y `ms-catalogo/src/app.js`, `ms-pedidos/src/app.js`, HEAD `08322be015dceb7710358615a24e4213d8ff172f` del repositorio PabloHD2024/EcommerceApp2. Solo había un archivo no seguido `img.rar`.
- `../pp3-api-usuarios/src/app.js` y `profileFields.js`, HEAD `e1ddca31f14b9ecb9648af6a99265befba61739b`. Solo había un directorio no seguido `.work/`.

No se leyeron archivos de entorno ni se usaron credenciales de los servicios.

| Flujo | Ruta y cuerpo | Respuesta consumida |
| --- | --- | --- |
| Login | POST `/api/sesiones`, `{email,password}` | `{token,user}`; normaliza `name`/`role`, admite `nombre`/`rol` anteriores |
| Registro | POST `/api/usuarios`, `{name,apellido,email,password}` | Éxito HTTP; pasa al login, no presupone token |
| Perfil y F5 | GET `/api/usuarios/me`, Bearer | `{success,user}` |
| Editar/completar | PUT `/api/usuarios/me`, `{name,apellido,dni,telefono,direccion}` | `{success,user}`; no se mandan email ni role |
| Catálogo | GET `/api/productos?page=…&nombre=…&categoria=…` | `{items,pagination}`; admite `productos` anterior |
| Categorías | GET `/api/categorias` | Array de nombres |
| Carrito | Estado local de la página | Comprueba stock local; precio/stock final los determina el servidor |
| Crear pedido | POST `/api/pedidos`, `Idempotency-Key`, `{items:[{productId,quantity}]}` | Pedido con `estado`; solo `confirmed`/`paid` confirman |
| Consultar intento | GET `/api/pedidos/operaciones/:attemptId` | Pedido o resultado pendiente |
| Mis pedidos | GET `/api/pedidos` | Array con `fecha`, `detalles`, `total`, `estado` |
| Cancelar | PATCH `/api/pedidos/:id/cancelar` | Luego vuelve a consultar pedidos |

El Gateway local reenvía GET/PUT de usuarios/me y sesiones a usuarios sin quitar el envoltorio `user`. No expone un perfil en clientes. Usuarios permite los cinco campos del PUT; DNI opcional de 7 u 8 dígitos, teléfono solo dígitos y dirección hasta 300 caracteres. Valores opcionales vacíos se envían como null para borrarlos.

La sesión conserva el token ante red caída, 5xx o respuesta de perfil inválida; 401 borra token y datos privados. Se puede reintentar desde Perfil. El formulario se precarga y permanece editable al obtener un usuario. No se usan productos ficticios como fallback de producción.

El carrito es local y se pierde al recargar. Su sincronización opcional con `/api/usuarios/me/carrito` queda fuera de esta adaptación; el Gateway también tiene alias de carrito de clientes que este frontend no usa.

## Diferencias y límites

- El checkout original enviaba dirección y mostraba medio de pago, pero el Gateway local crea pedidos solo con items/cupón, y pedidos no persiste dirección. Se retiraron esos controles para evitar prometer datos que se descartan. La dirección del perfil sí se conserva en usuarios. Si se requiere envío asociado al pedido, falta incorporar ese campo al contrato de Gateway/pedidos; no se cambió ningún backend.
- Crear pedido requiere `Idempotency-Key`; la UI evita doble envío y conserva el identificador por usuario en localStorage, incluso tras F5 o fallo de red. Mientras está pendiente bloquea cambios del carrito. Desde Mis Pedidos se puede abrir checkout y confirmar para consultar el intento. Un 404 al consultarlo conserva la clave por precaución: requiere revisión del servicio antes de iniciar otra operación. No hay reintento automático de escrituras.
- La UI crea y permite cancelar pedidos; no implementa pago ni comprobante. El pago es otro paso del contrato. Cancelación puede quedar pendiente de conciliación; consultar Mis Pedidos para el estado real.
- No se puede afirmar paridad con producción: las consultas GET a `https://pp3-ecommerce-api-gateway.onrender.com` de `/health`, `/api/usuarios/me` sin token, `/api/productos?limit=1` y `/api/categorias` agotaron 20 segundos aun con acceso de red ampliado. No se observó status HTTP. Esto no demuestra que falten rutas; impide verificar disponibilidad, CORS y versión desplegada. No se enviaron POST, PUT ni PATCH a producción.

## Evidencia de pruebas

`node --test test/frontend.test.cjs`: 11 pruebas del JavaScript real ejecutado en VM con DOM mínimo y fetch interceptado, sin paquetes externos. Cubren normalización, Bearer, restauración, 401, 503, red caída, perfil GET/PUT, precarga, edición, escape de dirección, fallo de guardado, login/registro, items/filtros/paginación, stock, checkout pendiente, recuperación tras F5, respuesta perdida sin duplicar POST, detalles de pedidos y método de cancelación.

Estos dobles se derivan de las fuentes locales anteriores: prueban los handlers y las llamadas del frontend frente a esas respuestas, no la ejecución del Gateway, bases de datos, CORS ni un navegador real. No se usó Postman CLI (no está instalado), no se buscó un mock del propietario ni se publicaron mocks. No se crearon cuentas ni pedidos reales. Los datos de prueba son ficticios y los tokens son cadenas sin validez.

También se verifican sintaxis con `node --check app.js`, espacios con `git diff --check` y diff/listado de archivos antes de publicar. Pendiente: smoke test en navegador con servicios de prueba disponibles y verificación de GET/PUT autenticados contra el despliegue correcto.

## Vercel: siguiente paso, sin deploy en esta tarea

- Importar `ignaci0vidal/pp3-frontend-alternativo`; elegir la rama acordada para producción (`pp3/gateway-frontend` si se publica directamente esta rama).
- Framework preset: Other. Root directory: raíz del repo. Sin instalación ni build. Output directory: `.`. No necesita variables de entorno, funciones ni rewrites; la navegación es interna a index.html.
- Confirmar que `API_BASE` sea la URL HTTPS del Gateway que Lucía mantendrá. Las variables de Vercel no se interpolan en este JavaScript estático: un cambio de URL debe hacerse explícitamente en app.js.
- Una vez asignado el dominio, coordinar con Lucía **el origen literal que muestre el navegador**, por ejemplo `https://<dominio-real-asignado>.vercel.app`, sin barra final, ruta ni wildcard. No podemos dar un dominio exacto antes de que Vercel lo asigne; no asumir que coincidirá con el nombre del repo.
- Lucía debe agregar ese valor a `FRONTEND_ORIGIN` del Gateway y aplicar/reiniciar el servicio. El Gateway local admite una lista separada por comas; conservar los orígenes locales necesarios. Los previews tienen orígenes diferentes y requieren coordinar cada origen autorizado. Si se usa dominio propio, coordinar también su origen exacto.
- Verificar preflight desde ese dominio con `Authorization`, `Content-Type`, `Idempotency-Key` y métodos GET/POST/PUT/PATCH; luego perfil y compra solo en entorno de prueba.

No se creó proyecto ni deployment de Vercel.
