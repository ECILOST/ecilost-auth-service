# ECILOST Auth Service

Servicio de identidad de ECI Lost & Auction. Autentica con Google OAuth 2.0 mediante Authorization Code y PKCE. Emite los JWT que validan Catalog, Auction, Wallet y Engagement y publica sus claves públicas mediante JWKS.

## Inicio local

Requiere Node.js 22, Docker Compose, PostgreSQL y RabbitMQ. Para iniciar sesión en el navegador, configura un cliente OAuth de Google para el entorno local.

```bash
cp .env.example .env
docker compose up -d
npm ci
npm run db:deploy
npm run start:dev
```

Completa `.env` antes de instalar. La URI de retorno registrada en Google debe coincidir con `GOOGLE_REDIRECT_URI`, normalmente `http://localhost:3000/auth/google/callback`. Usa un par RS256 propio del entorno y conserva `JWT_PRIVATE_KEY`, `COOKIE_SECRET` y `GOOGLE_CLIENT_SECRET` fuera de Git. La plantilla describe las variables y el formato de las llaves.

| Comprobación | URL local |
|---|---|
| Salud del proceso | [GET /health](http://localhost:3000/health) |
| Swagger UI | [/docs](http://localhost:3000/docs) |
| OpenAPI JSON | [/docs-json](http://localhost:3000/docs-json) |
| Llaves públicas | [/.well-known/jwks.json](http://localhost:3000/.well-known/jwks.json) |

## Sesión y Swagger

1. Abre `GET /auth/google` en el navegador. Google devuelve el control a `GET /auth/google/callback`. Auth verifica la identidad y emite la cookie firmada `ecilost_rt` con `HttpOnly`.
2. En el mismo origen, llama a `POST /auth/token` con esa cookie. El servicio rota la sesión de renovación y devuelve `access_token`, `expires_in` y `role`.
3. Abre Swagger y usa **Authorize** en el esquema `access-token`. Pega el valor de `access_token` y ejecuta `GET /auth/me`. Para `POST /auth/token` y `POST /auth/logout`, el navegador envía la cookie obtenida durante el inicio de sesión.

| Operación | Credencial | Resultado |
|---|---|---|
| `POST /auth/token` | Cookie de sesión | Emite un JWT nuevo y rota la cookie |
| `POST /auth/logout` | Cookie de sesión | Revoca la cadena de renovación |
| `GET /auth/me` | Bearer JWT | Identificador, rol y capacidades del JWT |
| `GET /auth/profile` | Bearer JWT | Perfil actual en PostgreSQL |
| `PATCH /auth/profile` | Bearer JWT | Fija o borra el código institucional |
| `GET /auth/users?email=...` | Bearer JWT de `STAFF` | Busca una cuenta para operaciones administrativas |

Los JWT se firman con RS256 e incluyen `sub`, `role`, `iss`, `aud`, `iat`, `jti` y `exp`. El correo, el nombre y el avatar viven en el perfil. Un token ausente, vencido o sin `exp` produce `401`. Un rol insuficiente produce `403`.

## Roles y revocación

El correo de Google debe estar verificado. En el alta, `STAFF_EMAILS` asigna `STAFF` a las cuentas autorizadas. El resto recibe `STUDENT`. Catalog, Auction y Wallet aplican los permisos en cada operación.

| Capacidad | Rol |
|---|---|
| Registrar objetos, crear lotes, programar salas y recargar Ecicoin | `STAFF` |
| Participar y pujar | `STUDENT` |

Para retirar `STAFF`, compila el servicio y exporta `DATABASE_URL` para la base de Auth que administra el operador. Ejecuta:

```bash
npm run build
npm run staff:revoke -- <uuid-del-usuario>
```

El comando cambia el rol a `STUDENT` y revoca sus sesiones activas de renovación en una transacción. Los JWT ya emitidos conservan sus permisos hasta su `exp`. El UUID corresponde a `userId`. El código institucional es opcional, único y editable por el titular.

## Pruebas y despliegue

```bash
npm test
npm run lint
npm run typecheck

cp .env.test.example .env.test
# Completa el par RS256 efímero según la plantilla antes de ejecutar la suite.
npm run test:e2e
```

Las pruebas de integración usan el esquema `auth_test` de PostgreSQL, RabbitMQ local y un doble de Google. GitHub Actions ejecuta la validación en PR hacia `develop` y `main`. Las actualizaciones de esas ramas publican la imagen en GHCR y, con el entorno configurado, ejecutan las migraciones y despliegan en Azure Container Apps.

- [ADR de identidad y provisión de billetera](docs/adr/0001-identidad-y-provision-de-billetera.md)
- [Configuración de ejemplo](.env.example)
