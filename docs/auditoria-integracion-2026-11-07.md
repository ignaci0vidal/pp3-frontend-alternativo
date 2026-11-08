# Auditoría de integración PP3 — 2026-11-07

La integración todavía no está lista para certificar compra completa. Login, registro, perfil, listado de productos y categorías concuerdan en contrato. Hay bloqueos de Gateway y problemas de consistencia reproducidos localmente. Los errores de arranque de Pedidos detectados en la revisión inicial se corrigieron después, como se registra a continuación. El cambio de origen CORS ya fue solicitado a Lucía y continúa pendiente de su respuesta.

Esta revisión no modifica código de aplicación, servicios ni configuración de Render/Vercel. No se usaron secretos ni se crearon cuentas, pagos o pedidos reales. Las escrituras descritas abajo se hicieron únicamente contra dobles locales.

## Actualización: correcciones de Pedidos verificadas

Se volvió a consultar main tras el aviso del equipo. El [PR #3](https://github.com/ignaciohernandez/pp3-api-pedidos/pull/3) quedó integrado en el commit [4616531](https://github.com/ignaciohernandez/pp3-api-pedidos/commit/46165314ff275e2c355b6faa90d21d9446d9e991).

- `node --check src/app.js` pasa: eliminó la declaración duplicada de direccionEntrega y la propiedad repetida del formateador.
- La migración 002 ya no agrega dirección incondicionalmente. La columna queda a cargo de 003, que consulta information_schema antes de crearla. Esto resuelve la causa identificada de columna duplicada en reejecuciones; no se ejecutó contra MySQL real.
- Se descargaron app.js, auth.js y test/app.test.js de ese commit a una carpeta temporal, sin modificar los servicios. Con Node 24.19.0 y Express local 5.3.0 (compatible con el rango ^5.2.1 declarado por Pedidos) se ejecutó su suite: **13/13 pruebas aprobadas**, salida 0. Cubren identidad/roles, propietario del detalle, permisos en reintentos, dirección en POST/lista/detalle, límite de 500 caracteres, idempotencia, cupón y dirección durante confirmación/lecturas/reintentos, pago simulado y comprobante protegido. Las bases de datos son dobles en memoria.
- El health público directo de Pedidos devolvió 200 con `{status:"ok",service:"orders"}`. No expone versión/commit: esto no certifica que Render esté ejecutando exactamente 4616531 ni que se hayan aplicado migraciones en su base.
- En esta repetición el health de Gateway agotó 35 segundos sin respuesta HTTP; no se pudo confirmar su conexión a Pedidos ni actualizar el estado de CORS desde ese intento.

Los hallazgos 3 y 4 de abajo quedan como evidencia histórica **corregida en main**, no como pendientes actuales. Los bloqueos de Gateway, el vencimiento de cupones de Catálogo y la respuesta tardía de perfil del frontend siguen siendo hallazgos independientes.

## Versiones y alcance

Se leyeron versiones remotas fijadas por commit, no solo las copias locales:

| Componente | Commit revisado | Fuente |
| --- | --- | --- |
| Gateway — Lucía | `02afcf17a430a76cdb6ac8ef74b9afbc5d649c66` | [src/app.js](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js), rama arquitectura-microservicios |
| Usuarios — Ignacio Vidal | `e1ddca31f14b9ecb9648af6a99265befba61739b` | [src/app.js](https://github.com/ignaci0vidal/pp3-api-usuarios/blob/e1ddca31f14b9ecb9648af6a99265befba61739b/src/app.js), main |
| Catálogo — Carla | `17434b3219216f99e187798770b6096bcbd32e11` | [src/app.js](https://github.com/Caaaaa2562/pp3-api-catalogo/blob/17434b3219216f99e187798770b6096bcbd32e11/src/app.js), main |
| Pedidos — Ignacio Hernández | `4a898012bcd11d3ffe298b7e4447306dd2c65e6f` | [src/app.js](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/src/app.js), main |
| Frontend | Código local hasta `01f9bc7`; origin apunta a `75ad21a` | El commit posterior cambia únicamente documentación. El app.js servido por Vercel coincide con el local, normalizando CRLF/LF |

SHA256 de app.js obtenido de Vercel: `ef8207d221d0784ec4b0498e3f2d0023dcc9479fc684c1f01ee24b94a6f45d3c`. Usa `https://pp3-ecommerce-api-gateway.onrender.com` como API_BASE e incluye carrito persistente. Esto comprueba el archivo publicado, no la configuración del despliegue automático.

## Hallazgos prioritarios

### 1. Bloqueante: CORS todavía autoriza el frontend anterior

En GET y OPTIONS enviados con `Origin: https://pp3-frontend-alternativo.vercel.app`, el Gateway publicado devolvió:

```text
Access-Control-Allow-Origin: https://ecommercefrontendpp3.vercel.app
```

El origen no coincide; el navegador bloquea la lectura de respuestas y los preflights de escrituras. Recibir 200 con Node/curl no prueba que el navegador pueda consumirlo. Lucía debe configurar exactamente `FRONTEND_ORIGIN=https://pp3-frontend-alternativo.vercel.app` y aplicar el cambio. El código actual del Gateway configura un origen literal, no una lista separada por comas. El usuario confirmó que ya está esperando este cambio.

Evidencia de código: [Gateway líneas 8–11](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js#L8). Los OPTIONS devolvieron 204 con métodos y headers adecuados, pero origen incorrecto. Un 204 tampoco demuestra que exista la ruta.

### 2. Alta: faltan rutas de Gateway que el frontend necesita

| Ruta del frontend | API destino | Evidencia |
| --- | --- | --- |
| GET/PUT `/api/usuarios/me/carrito` | Usuarios, misma ruta | Ausentes en código; GET publicado 404; ambas 404 en reproducción local autenticada |
| GET `/api/productos/:id` | Catálogo, misma ruta | Ausente; publicado `/api/productos/1` 404; reproducción local 404 |
| GET `/api/pedidos/:id` | Pedidos, misma ruta con identidad interna | Ausente; publicado `/api/pedidos/1` 404; reproducción local 404 |
| GET `/api/pedidos/operaciones/:attemptId` | Pedidos `/api/pedidos/internal/intentos/:attemptId` | Ausente; publicado 404; reproducción local autenticada 404 |

Consecuencias: el carrito no puede recuperarse ni guardarse; tampoco puede recuperar los datos de sus productos, consultar detalle o resolver una compra incierta. Agregar solo CORS no resuelve estos problemas. No corresponde enviar el navegador directamente a Pedidos con credenciales de servicio.

Adicionalmente, Pedidos tiene POST `/:id/pagar` y GET `/:id/comprobante`, pero Gateway no los publica y el frontend no implementa esos pasos. Son funcionalidades pendientes si se exige compra con pago y comprobante. La administración de usuarios, productos y cupones tampoco está cubierta por esta UI/Gateway.

### 3. Alta: main de Pedidos no supera la validación de sintaxis

En POST `/api/pedidos` hay dos declaraciones `const direccionEntrega` en el mismo bloque ([línea 105](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/src/app.js#L105) y línea 120). Se ejecutó `node --check` sobre el contenido remoto sin modificarlo:

```text
SyntaxError: Identifier 'direccionEntrega' has already been declared
```

El formateador también repite la propiedad de dirección (líneas 30 y 38), aunque eso por sí solo no impide arrancar. El main consultado no puede iniciar con ese archivo. Que el servicio publicado esté sano no demuestra que esté ejecutando este commit.

Responsable: Pedidos. Corregir la declaración, validar sintaxis y correr sus pruebas antes de desplegar.

### 4. Alta: las migraciones de Pedidos fallan al repetirse

[002-order-lifecycle.sql](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/migrations/002-order-lifecycle.sql) contiene un `ALTER TABLE orders ADD COLUMN direccion_entrega ...` incondicional. El [migrador](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/src/migrate.js) ejecuta todos los archivos en cada arranque sin registrar cuáles ya se aplicaron, y el [Dockerfile](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/Dockerfile) exige que termine bien antes de iniciar el servidor.

Si la columna ya existe, 002 falla por columna duplicada y no alcanza a ejecutar la protección de [003-direccion-entrega.sql](https://github.com/ignaciohernandez/pp3-api-pedidos/blob/4a898012bcd11d3ffe298b7e4447306dd2c65e6f/migrations/003-direccion-entrega.sql). Por lo tanto un reinicio/redeploy puede impedir el arranque aun corrigiendo la sintaxis. Evidencia por inspección; no se ejecutaron migraciones contra la base real.

Responsable: Pedidos. Usar historial de migraciones o hacer repetibles las operaciones y comprobar arranque sobre una base existente.

### 5. Alta: Gateway puede devolver stock de un pedido confirmado o pagado

El Gateway compensa inventario ante cualquier fallo de confirmación ([desde línea 1170](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js#L1170)), sin resolver primero si la confirmación se persistió. Tampoco termina temprano cuando el POST idempotente de Pedidos devuelve un pedido ya pagado.

Se ejecutó el código real de Gateway con Express/JWT y upstreams simulados, sin producción:

- Confirmación persistida cuya respuesta se pierde: Gateway devuelve 503 y retorna stock; el pedido permanece `confirmed`.
- Reintento cuyo pedido ya está `paid`: Gateway intenta confirmarlo otra vez, recibe conflicto y retorna stock; el pedido permanece `paid`.

Catálogo hace idempotentes los movimientos individuales, pero eso no garantiza consistencia del flujo completo. Gateway tampoco programa conciliación de pendientes/cancelaciones ni expone la consulta de intento que usa la UI.

Responsable: Gateway. Consultar estado antes de compensar un resultado ambiguo; respetar estados terminales y recuperar/conciliar operaciones pendientes. No certificar reintentos hasta probar estos escenarios.

### 6. Alta: el cupón se pierde en el POST inicial a Pedidos

Gateway reenvía `direccionEntrega` pero omite `couponCode` en el [cuerpo inicial a Pedidos](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js#L1040). Sí lo pasa después a Catálogo, y Pedidos copia `inventory.couponCode` al confirmar.

La reproducción local confirmó la omisión. El pedido pendiente y su hash inicial no contemplan el cupón solicitado. Un cambio de cupón con la misma clave puede producir un conflicto en inventario y no el conflicto esperado en Pedidos. Reenviar `couponCode` desde el primer POST y comprobar que permanezca en creación, confirmación, listado, detalle y reintentos.

La respuesta de Pedidos se llama `cuponCodigo`, no `couponCode`; el frontend admite ambos. Esa diferencia está adaptada en la UI y no rompe por sí misma.

### 7. Alta: Catálogo valida distinto el vencimiento al consultar y al vender

GET `/api/cupones/code/:code` valida con `expires_on >= CURRENT_DATE` en SQL ([línea 227](https://github.com/Caaaaa2562/pp3-api-catalogo/blob/17434b3219216f99e187798770b6096bcbd32e11/src/app.js#L227)). En cambio la venta compara `coupon.expires_on < new Date().toISOString().slice(0, 10)` ([línea 505](https://github.com/Caaaaa2562/pp3-api-catalogo/blob/17434b3219216f99e187798770b6096bcbd32e11/src/app.js#L505)).

El driver pg convierte DATE a objetos Date por defecto ([documentación oficial](https://node-postgres.com/features/types)); `src/db.js` no cambia ese parser. Comparar un Date con el texto YYYY-MM-DD no compara ambas fechas correctamente.

Se reprodujo con el código real de Catálogo y una base simulada que devuelve un cupón vencido en 2000 como Date: consulta de cupón 404, pero venta 201 con descuento aplicado y stock consumido. No se probó una compra real. Responsable: Catálogo. Reutilizar validación SQL con la misma fecha/zona y probar Date reales del driver, no solo strings.

### 8. Media: método y reintentos de cancelación no concuerdan

Frontend llama PATCH `/api/pedidos/:id/cancelar`; [Gateway publica PUT](https://github.com/LuCorral/PP3-Ecommerce-Microservices/blob/02afcf17a430a76cdb6ac8ef74b9afbc5d649c66/src/app.js#L741). Reproducción autenticada: PATCH 404.

Además, repetir PUT sobre un pedido ya cancelado intenta pasarlo de `cancelled` a `cancelling` y devuelve 409. Se reprodujo localmente. La restitución de stock es idempotente en Catálogo para la misma operación, pero Gateway no considera completa una cancelación ya terminada. Acordar método público y devolver el estado existente en reintentos completados.

### 9. Media: guardar perfil puede volver a mostrar datos tras logout

El [handler del frontend](../app.js) de PUT de perfil (líneas 702–720) aplica `response.user` al terminar sin comprobar que siga siendo la misma sesión. La carga de carrito y otras lecturas sí tienen esa protección.

Reproducción con el JavaScript real y fetch interceptado: iniciar PUT, cerrar sesión y luego resolver la respuesta deja `state.token === null`, pero restaura el usuario anterior y muestra su email en Perfil. No reautentica al usuario ni el servidor permite nuevas operaciones sin token; sí expone datos en la pantalla después del logout. Responsable: frontend. Capturar token/identidad de la operación y descartar respuestas antiguas.

### 10. Media: hay desacople entre disponibilidad directa y Gateway

Dos consultas públicas sucesivas mostraron Pedidos directo 200 en `/health`, pero Gateway 503 y `orders: unavailable`. Usuarios y Catálogo estaban `ok` para Gateway. También se comprobó que Pedidos directo rechaza GET `/api/pedidos` sin token interno con 403.

Esto demuestra el desacople observado, no su causa. Lucía debe revisar ORDERS_SERVICE_URL, conectividad, timeout y logs. Los nombres de configuración del Gateway son ORDERS_SERVICE_TOKEN y CATALOG_SERVICE_TOKEN; cada microservicio compara su propio SERVICE_TOKEN. Los valores correspondientes deben coincidir, y JWT_SECRET de Gateway/Usuarios debe coincidir. No se inspeccionaron valores ni secretos, por lo que no se afirma que estén mal configurados.

## Otras diferencias a acordar

- Nombre/apellido del pedido salen de los claims del JWT en Gateway. PUT de perfil devuelve un usuario actualizado pero no emite token nuevo: un pedido posterior puede conservar el nombre anterior hasta volver a iniciar sesión. La identidad sub permanece estable. Definir si se exige el nombre vigente y dónde obtenerlo.
- Usuarios permite carritos sin límite de artículos y admite productId numéricos como 0; Pedidos/Catálogo requieren IDs positivos y hasta 100 entradas. La UI no limita a 100. Alinear validaciones para evitar aceptar carritos que después no se pueden comprar.
- PUT de carrito reemplaza el conjunto completo sin versión/ETag. La pestaña serializa sus propias escrituras, pero dos dispositivos pueden sobrescribirse. No es una garantía de edición concurrente.
- La dirección de perfil tiene máximo 300 y la de entrega 500. Son campos distintos y el frontend los valida por separado; no deben confundirse al definir el contrato.

## Concordancias comprobadas

| Flujo | Resultado de revisión |
| --- | --- |
| Login | Front y Gateway POST `/api/sesiones` con email/password; Usuarios devuelve token/user y claims sub/name/role |
| Registro | POST `/api/usuarios` con name/apellido/email/password; Usuarios fuerza role client |
| Perfil | GET/PUT `/api/usuarios/me`; respuesta user; cinco campos editables admitidos |
| Catálogo | API devuelve items/pagination; Gateway transforma a productos/pagination; frontend admite ambas formas |
| Categorías | Array de nombres compatible; GET publicado 200 |
| Precios | Catálogo calcula en centavos y Pedidos expone importes monetarios; frontend no decide descuentos ni total definitivo |
| Identidad | Gateway deriva identidad del JWT y envía headers internos; frontend no tiene token de servicio |
| Protección de pedidos | Código de detalle/comprobante valida ID y rol; cancelación/envío/entrega valida permisos antes de reintentos. Esto no se probó contra usuarios reales |
| Dirección | Front la envía y Gateway la reenvía; Pedidos tiene columna/INSERT/serialización previstos, sujetos a corregir arranque/migraciones |

## Pruebas y límites

- 20 pruebas existentes de frontend: pasan. Son pruebas de handlers con dobles; no certifican las rutas que faltan en Gateway.
- Sintaxis de los cuatro app.js remotos: Gateway, Usuarios y Catálogo pasan; Pedidos falla por declaración duplicada.
- Gateway real ejecutado localmente con Express/JWT, middleware CORS sustituido y upstreams simulados: ocho rutas faltantes, cuatro rutas canónicas de auth/perfil concordantes, creación normal, confirmación con respuesta perdida, reintento de pedido pagado y cancelación repetida.
- Catálogo real con middleware de servicio y SQL simulado: inconsistencia de vencimiento reproducida con Date del tipo documentado por pg.
- Frontend real con DOM/fetch simulados: respuesta tardía de PUT tras logout restaura datos privados en pantalla.
- Producción: solo GET y OPTIONS sin credenciales. Usuarios, Catálogo y Pedidos directos devolvieron 200 en health. Gateway devolvió 503 por orders. Listado de productos/categorías 200; rutas faltantes 404; perfil/pedidos sin token 401. CORS incorrecto observado en respuestas y preflights. Vercel sirve el app.js esperado.
- No se verificaron escritura persistida real, roles con cuentas de prueba, migraciones en MySQL ni transacciones en PostgreSQL. No se utilizó Postman CLI porque no está instalado; se usaron Node y dobles explícitos. Scripts/resultados de esta ejecución: `%TEMP%/pp3-contract-audit-20261107/`.

## Orden de resolución sugerido

1. Lucía: aplicar origen CORS conocido, revisar conexión a Pedidos y exponer rutas canónicas.
2. Ignacio Hernández: corregir sintaxis y repetibilidad de migraciones antes del próximo deploy.
3. Lucía: corregir idempotencia/compensación y propagar cupón desde la creación.
4. Carla: unificar validación de vencimiento de cupones.
5. Frontend: descartar respuestas de perfil de sesiones anteriores; acordar límite de carrito y método de cancelación.
6. Con servicios de prueba disponibles: ejecutar compra con dirección/cupón, reintentos, detalle, cancelación y pago/comprobante si entran en alcance. Verificar GET posterior a cada escritura y repetir tras F5. No usar compras reales como smoke test.
