# Revisión integral del frontend — 08/11/2026

Se revisaron `app.js`, `index.html`, estilos, pruebas y documentación. Solo se modificó este frontend. No se crearon usuarios, pedidos ni pagos en producción. Las verificaciones públicas fueron GET y OPTIONS sin credenciales. Este informe actualiza las revisiones del 07/11; no certifica una compra completa en producción.

## Fuentes actuales

Se descargó el código público de las ramas por defecto y se contrastó el contrato. Commits informados por GitHub durante la revisión:

| Servicio | Commit | Fuente |
| --- | --- | --- |
| Usuarios | `e1ddca31f14b9ecb9648af6a99265befba61739b` | [src/app.js](https://github.com/ignaci0vidal/pp3-api-usuarios/blob/e1ddca31f14b9ecb9648af6a99265befba61739b/src/app.js) |
| Catálogo | `17434b3219216f99e187798770b6096bcbd32e11` | [src/app.js](https://github.com/Caaaaa2562/pp3-api-catalogo/blob/17434b3219216f99e187798770b6096bcbd32e11/src/app.js) |
| Pedidos | `46165314ff275e2c355b6faa90d21d9446d9e991` | [src/app.js](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/46165314ff275e2c355b6faa90d21d9446d9e991/src/app.js) |
| Gateway | `31653a2f46841e3b59bc456174c1e385217b2386` | [src/app.js](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/31653a2f46841e3b59bc456174c1e385217b2386/src/app.js), rama `arquitectura-microservicios` |

## Correcciones y funcionalidades

- Pago simulado desde Mis Pedidos para `confirmed`: POST `/api/pedidos/:id/pagar` con `metodo` (`tarjeta`/`transferencia`) y `resultadoSimulado` (`aprobado`/`rechazado`). Se informa explícitamente que es una simulación; no se solicitan datos bancarios. Una respuesta rechazada no se anuncia como pago aprobado. Después se vuelve a consultar pedidos.
- Comprobante no fiscal para `paid`, `shipped` y `delivered`: GET `/api/pedidos/:id/comprobante` con Bearer. Modal con número, cliente, fecha, método, productos, subtotal, descuento, cupón y total. Se representa mediante `textContent` y se limpia al cerrar o salir de sesión.
- Pago y cancelación bloquean escrituras simultáneas en esta instancia de la UI. No hay reintento automático de escrituras ante una respuesta perdida; se consulta el listado. Esto no equivale a coordinar pestañas distintas.
- Cancelación canónica: PATCH `/api/pedidos/:id` con `{ "estado": "cancelled" }`. La UI solo anuncia cancelación completa si la respuesta confirma ese estado; de lo contrario informa solicitud pendiente y recarga pedidos.
- Se escaparon textos y atributos de catálogo, destacados, pedidos y mensajes de error que antes podían interpretarse como HTML. Los argumentos de los botones de productos se serializan y escapan; las imágenes aceptan rutas relativas o HTTP(S). Los IDs de pedidos deben ser numéricos antes de usarse en atributos/selectores.
- Respuestas tardías de perfil, carrito, detalle, pago y comprobante no restauran datos de una sesión cerrada. Entrar en otra cuenta limpia los datos visibles previos. Cerrar un comprobante invalida su petición pendiente.
- Las consultas más recientes de catálogo, listado/detalle y comprobantes prevalecen sobre respuestas anteriores que lleguen fuera de orden.
- Los conflictos de checkout marcados `uncertain` conservan la clave de idempotencia. Las respuestas exitosas con JSON inválido no se consideran confirmación. Un pedido recuperado como `shipped` o `delivered` también se reconoce como compra ya confirmada para limpiar el carrito.
- Se admiten errores del backend con campo `mensaje`, se mantiene el cierre de sesión para 401 incluso con respuesta no JSON y se limita la espera HTTP a 30 segundos. Las respuestas inciertas conservan el flujo de recuperación.
- Destacados sin stock quedan deshabilitados. Los enlaces del footer con `data-view` navegan. El guardado de perfil bloquea envíos concurrentes; los modales tienen altura máxima y scroll; los avisos tienen región accesible.

## Evidencia pública y bloqueos actuales

Gateway consultado: `https://pp3-ecommerce-api-gateway.onrender.com`.

| Consulta | Resultado observado | Implicación |
| --- | --- | --- |
| Usuarios `/health` directo | 200, `service: users` | Servicio responde |
| Catálogo `/health` directo | 200, `service: catalog` | Servicio responde |
| Pedidos `/health` directo, URL indicada por el equipo sin sufijo `-1` | 200, `service: orders` | Servicio responde |
| Gateway `/health` | 503, `users: ok`, `catalog: ok`, `orders: unavailable` | Revisar conexión/configuración del Gateway con Pedidos; el health directo no acredita esa conexión |
| Gateway GET `/api/productos?limit=1` | 200 con `productos` y `pagination` | El frontend admite ese formato y el formato `items` |
| Gateway GET `/api/categorias` | 200, array de nombres | Compatible con las categorías dinámicas |
| Catálogo directo GET `/api/productos/1` | 200 | El recurso individual existe en Catálogo |
| Gateway GET `/api/productos/1` | 404 | Falta exponer el producto individual; la hidratación del carrito depende de esa ruta |
| Gateway GET `/api/pedidos/operaciones/review-read-only` | 404, `Cannot GET` | No está expuesta la recuperación de intentos; el código remoto tampoco declara esa ruta |
| Gateway GET `/api/pedidos` sin token | 401 | La ruta exige autenticación; no se probó su operación con sesión real |
| Gateway GET `/api/pedidos/1/comprobante` sin token | 401 | Existe control de autenticación; no demuestra emisión/lectura del comprobante |
| OPTIONS `/api/pedidos/1/pagar`, origen alternativo | 204; permite métodos y headers solicitados, pero origen diferente | CORS bloquea el navegador desde el frontend alternativo |

En las respuestas y en el preflight, `Access-Control-Allow-Origin` fue `https://ecommercefrontendpp3.vercel.app`, no `https://pp3-frontend-alternativo.vercel.app`. El preflight solicitó `authorization,content-type,idempotency-key`; la respuesta permitió esos headers y GET/HEAD/PUT/PATCH/POST/DELETE. El código del Gateway usa `FRONTEND_ORIGIN`, pero no se leyeron variables ni credenciales del despliegue.

El Gateway remoto ya declara pago, comprobante, detalle y cancelación canónica. No declara producto individual ni consulta de operaciones. Con CORS incorrecto, ambas rutas faltantes y Pedidos degradado para el Gateway, la integración completa continúa bloqueada. Son cambios de Gateway/despliegue; no se alteraron los backends desde este trabajo.

## Validación y límites

- `node --test test/frontend.test.cjs`: **38/38** pruebas aprobadas al finalizar las correcciones de esta revisión.
- `node --check app.js`: correcto.
- `git diff --check`: correcto.
- Las pruebas ejecutan los handlers reales en VM con DOM mínimo y `fetch` interceptado: autenticación, perfil, carrito persistido, stock, filtros/paginación, checkout e idempotencia, cancelación, pago aprobado/rechazado, comprobantes, HTML hostil, respuestas tardías y consistencia entre IDs/handlers del HTML y JavaScript.
- Estos dobles verifican el comportamiento local frente a respuestas controladas. No prueban autorización entre dos usuarios reales, transacciones de base de datos, coordinación entre pestañas ni el ciclo completo de compra a través del Gateway publicado.
- No se usó Postman: el CLI no está instalado y no existe simulación Postman en este repositorio. No se publicaron recursos externos.
- Se intentó abrir una revisión visual con el navegador integrado; el host de acceso al navegador informó que no está disponible. No se presenta la inspección de HTML/CSS como validación visual en navegador.

Antes de la demo, una vez corregido el Gateway: verificar CORS desde el dominio alternativo y ejecutar con cuentas/datos de prueba el recorrido login → carrito → creación con dirección/cupón → recuperación tras F5 → pago simulado aprobado/rechazado → comprobante; comprobar también cancelación y pertenencia de pedidos entre usuarios distintos.
