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

La segunda revisión contrastó los repositorios oficiales indicados por el equipo. La evidencia remota siguiente prevalece sobre las copias locales cuando difieren:

- [Usuarios](https://github.com/ignaci0vidal/pp3-api-usuarios/blob/main/src/app.js), blob `40ac3fe90241be35ee8b5ed02c7f3ea4350b8e1e`: GET/PUT de carrito con `{success,carrito:[{productId,quantity}]}`.
- [Catálogo](https://github.com/Caaaaa2562/pp3-api-catalogo/blob/main/src/app.js), blob `70b37413095c2d479919fd01c34a4fe10fc7e1d7`: GET de producto individual, listado paginado y stock/precios.
- [Pedidos main](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/src/app.js), commit `4a898012bcd11d3ffe298b7e4447306dd2c65e6f`, blob `42b8aa18c17aaeb8f3c8823e3b0fa2f6ed48fc2f`.
- [Gateway de Lucía](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js), rama `arquitectura-microservicios`, commit `02afcf17a430a76cdb6ac8ef74b9afbc5d649c66`, blob `7cd361f21fc0ec46d9b4eaa6a8ef386acc78e194`.

No se leyeron archivos de entorno ni se usaron credenciales de los servicios.

| Flujo | Ruta y cuerpo | Respuesta consumida |
| --- | --- | --- |
| Login | POST `/api/sesiones`, `{email,password}` | `{token,user}`; normaliza `name`/`role`, admite `nombre`/`rol` anteriores |
| Registro | POST `/api/usuarios`, `{name,apellido,email,password}` | Éxito HTTP; pasa al login, no presupone token |
| Perfil y F5 | GET `/api/usuarios/me`, Bearer | `{success,user}` |
| Editar/completar | PUT `/api/usuarios/me`, `{name,apellido,dni,telefono,direccion}` | `{success,user}`; no se mandan email ni role |
| Catálogo | GET `/api/productos?page=…&nombre=…&categoria=…` | `{items,pagination}`; admite `productos` anterior |
| Categorías | GET `/api/categorias` | Array de nombres |
| Recuperar carrito | GET `/api/usuarios/me/carrito`, Bearer | `{success,carrito:[{productId,quantity}]}` más GET `/api/productos/:id` para datos actuales |
| Guardar carrito | PUT `/api/usuarios/me/carrito`, `{carrito:[{productId,quantity}]}` | Reemplazo completo persistido; muestra solo cantidades reconocidas por API |
| Crear pedido | POST `/api/pedidos`, `Idempotency-Key`, `{items:[{productId,quantity}],direccionEntrega,couponCode}` | Pedido directo o `{pedido}` con `estado`; solo `confirmed`/`paid` confirman |
| Consultar intento | GET `/api/pedidos/operaciones/:attemptId` | Pedido o resultado pendiente |
| Mis pedidos | GET `/api/pedidos` | Array con `fecha`, `detalles`, `total`, `estado` |
| Detalle | GET `/api/pedidos/:id` | Pedido con `direccionEntrega` y cupón `cuponCodigo` (también admite `couponCode`) |
| Cancelar | PATCH `/api/pedidos/:id`, `{estado:"cancelled"}` | Luego vuelve a consultar pedidos |

El Gateway local reenvía GET/PUT de usuarios/me y sesiones a usuarios sin quitar el envoltorio `user`. No expone un perfil en clientes. Usuarios permite los cinco campos del PUT; DNI opcional de 7 u 8 dígitos, teléfono solo dígitos y dirección hasta 300 caracteres. Valores opcionales vacíos se envían como null para borrarlos.

La sesión conserva el token ante red caída, 5xx o respuesta de perfil inválida; 401 borra token y datos privados. Se puede reintentar desde Perfil. El formulario se precarga y permanece editable al obtener un usuario. No se usan productos ficticios como fallback de producción.

El carrito requiere iniciar sesión y se persiste en usuarios. No hay carrito de invitados ni copia local de productos/precios. Tras login/F5 recupera IDs y cantidades; los enriquece desde Catálogo. Un producto eliminado se mantiene visible como no disponible para poder quitarlo, y no permite comprarlo. Ante fallo de GET no se escribe un carrito vacío; si un PUT pierde su respuesta, exige recuperar por GET antes de seguir editando. Las escrituras se serializan dentro de la pestaña. La API reemplaza el carrito completo y no ofrece versión/ETag: ediciones simultáneas desde varias pestañas/dispositivos pueden sobrescribirse.

Tras confirmar un pedido se vacía el carrito mediante PUT, conservando el identificador del pedido mientras el vaciado no esté reconocido. Así, un fallo de limpieza no habilita un segundo POST de compra. La dirección del checkout se precarga desde el perfil, se puede editar y se envía como `direccionEntrega`; el cupón opcional se envía como `couponCode`. La UI muestra el total y descuento devueltos por Pedidos, sin calcular descuentos. El subtotal de carrito es orientativo.

## Diferencias y límites

- La copia local antigua del Gateway descarta dirección. El Gateway remoto de Lucía sí reenvía `direccionEntrega` al crear; el frontend vuelve a incluir dirección y cupón según el contrato objetivo. El pago sigue siendo un paso separado.
- Crear pedido requiere `Idempotency-Key`; la UI evita doble envío y conserva el identificador por usuario en localStorage, incluso tras F5 o fallo de red. Mientras está pendiente bloquea cambios del carrito. Desde Mis Pedidos se puede abrir checkout y confirmar para consultar el intento. Un 404 al consultarlo conserva la clave por precaución: requiere revisión del servicio antes de iniciar otra operación. No hay reintento automático de escrituras.
- La UI crea y permite cancelar pedidos; no implementa pago ni comprobante. El pago es otro paso del contrato. Cancelación puede quedar pendiente de conciliación; consultar Mis Pedidos para el estado real.
- No se puede afirmar paridad con producción: las consultas GET a `https://pp3-ecommerce-api-gateway.onrender.com` de `/health`, `/api/usuarios/me` sin token, `/api/productos?limit=1` y `/api/categorias` agotaron 20 segundos aun con acceso de red ampliado. No se observó status HTTP. Esto no demuestra que falten rutas; impide verificar disponibilidad, CORS y versión desplegada. No se enviaron POST, PUT ni PATCH a producción.

### Bloqueos comprobados en los repositorios remotos

El frontend está preparado, pero la integración completa no se puede dar por cumplida:

1. Gateway de Lucía no declara GET/PUT `/api/usuarios/me/carrito` ni GET `/api/productos/:id`. Debe reenviar carrito con Bearer a Usuarios y detalle de productos a Catálogo. Sin esto no puede recuperarse/guardarse un carrito con información actual. El frontend muestra un fallo y no simula persistencia.
2. Tampoco declara GET `/api/pedidos/:id` ni GET `/api/pedidos/operaciones/:attemptId`. Sin ellos fallan detalle y recuperación segura de compras pendientes. El segundo requiere proxy autenticado hacia `/api/pedidos/internal/intentos/:attemptId` con identidad derivada del JWT y token interno solo en Gateway.
3. Actualización del equipo del 08/11/2026: la ruta canónica de cancelación es PATCH `/api/pedidos/:id` con `{estado:"cancelled"}`. El frontend y su prueba usan ahora ese contrato; falta verificarlo contra el Gateway desplegado.
4. Gateway pasa `couponCode` a Catálogo, pero no al POST inicial de Pedidos. Debe incluirlo también allí: de lo contrario la clave/hash inicial no contempla el cupón y un pendiente puede carecer de esa asociación. La confirmación escribe `inventory.couponCode`; no alcanza para garantizar la persistencia del cupón desde la creación y sus reintentos.
5. Pedidos main declara `const direccionEntrega` dos veces dentro de POST (líneas 101 y 120 del archivo consultado). `node --check` sobre el contenido remoto, sin guardarlo ni modificarlo, falla con `SyntaxError: Identifier 'direccionEntrega' has already been declared`. El formateador también duplica la propiedad de dirección. Existe [migración 003](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/migrations/003-direccion-entrega.sql) para VARCHAR(500), INSERT y hash de dirección, pero no puede certificarse ejecutable esa versión hasta corregir la declaración y probarla. No se tocó el backend.
6. En el código de Pedidos consultado, detalle/comprobante validan ID y rol, y los cambios de estado de cancelación/envío/entrega comprueban permisos antes de resolver reintentos. Se dejaron intactos. El frontend no manda `x-user-id`, `x-user-role`, importes autorizados de inventario ni token de servicio; eso corresponde al Gateway. No se ejecutaron pruebas de autorización contra un servicio real.

El ejemplo compartido por el equipo devuelve dirección null y confirma pago/transición de un pedido existente: no prueba POST con dirección/cupón ni su lectura posterior. Además, Render puede estar ejecutando un commit anterior al main consultado.

Health checks GET de esta segunda revisión: `https://pp3-api-catalogo.onrender.com/health` y `https://pp3-api-pedidos-1.onrender.com/health` devolvieron 200 con `{status:"ok",service:...}`. Usuarios y Gateway agotaron 15 segundos. Un health 200 no verifica rutas autenticadas, migraciones ni la versión desplegada. No se usó el token interno compartido en la conversación y no se guardó en archivos; su administrador debe rotarlo.

## Evidencia de pruebas

`node --test test/frontend.test.cjs`: 20 pruebas del JavaScript real ejecutado en VM con DOM mínimo y fetch interceptado, sin paquetes externos. Cubren normalización, Bearer, restauración, 401, 503, red caída, perfil GET/PUT, precarga, edición, escape de dirección, fallo de guardado, login/registro, items/filtros/paginación, stock, checkout pendiente, recuperación tras F5, respuesta perdida sin duplicar POST, detalles de pedidos y método de cancelación. Incluyen persistencia del carrito entre instancias, productos actualizados/eliminados, GET fallido sin vaciar, PUT incierto y reconciliación, carrito de invitado bloqueado, respuesta tardía tras logout, envío de dirección/cupón y vaciado persistente tras confirmar (también si la limpieza falla).

Estos dobles se derivan de las fuentes locales y remotas anteriores: prueban los handlers y las llamadas del frontend frente a esas respuestas, no la ejecución del Gateway, bases de datos, CORS ni un navegador real. No se usó Postman CLI (no está instalado), no se buscó un mock del propietario ni se publicaron mocks. No se crearon cuentas ni pedidos reales. Los datos de prueba son ficticios y los tokens son cadenas sin validez.

También se verifican sintaxis con `node --check app.js`, espacios con `git diff --check` y diff/listado de archivos antes de publicar. Pendiente: smoke test en navegador con servicios de prueba disponibles y verificación de GET/PUT autenticados contra el despliegue correcto.


