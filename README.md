# Ecommerce_Frontend_PP3
Codigo Frontend del proyecto de microservicios de PP3

Frontend original de [PabloHD2024](https://github.com/PabloHD2024/Ecommerce_Frontend_PP3), con su historial conservado. Adaptación en `pp3/gateway-frontend`, repositorio [ignaci0vidal/pp3-frontend-alternativo](https://github.com/ignaci0vidal/pp3-frontend-alternativo).

Sitio estático: HTML, CSS y JavaScript sin build ni dependencias de ejecución.
La URL pública del Gateway se configura en `API_BASE` de `app.js`; no lleva secretos.

Pruebas locales (Node 18 o posterior):

```sh
node --check app.js
node --test test/frontend.test.cjs
git diff --check
```

Ver [contrato, evidencia y pendientes](docs/gateway-contract.md), incluida la configuración futura de Vercel y CORS.

Última revisión: [08/11/2026 — correcciones, pruebas y bloqueos de integración](docs/revision-integral-2026-11-08.md).
