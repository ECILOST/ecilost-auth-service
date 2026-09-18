# ADR-0001: Identidad de Auth y provisión inicial de billetera

## Estado

Proposed — las decisiones de identidad están implementadas; la integración que dispara la
emisión inicial de ECICoin está pendiente.

## Contexto

`ecilost-auth-service` autentica mediante Google OAuth 2.0, aprovisiona una identidad local
y emite access tokens propios. HU-09 requiere que un estudiante recién creado reciba una
emisión inicial de ECICoin, responsabilidad de `ecilost-wallet-service`.

## Problema

Auth es el único componente que hoy conoce de forma confiable la creación inicial de un
usuario. Wallet debe crear la billetera una sola vez, sin depender de joins entre bases de
datos ni perder la emisión si Wallet no está disponible. No hay una integración entre los
dos repositorios.

## Decisiones identificadas

1. Auth usa Google OAuth 2.0 con Authorization Code + PKCE; no almacena contraseñas.
2. Auth emite tokens RS256 propios con `sub` y `role`; los demás servicios los verifican
   localmente con la JWKS de Auth, sin consultar Auth en cada petición.
3. La identidad local usa `userId` estable. Ningún otro servicio debe usar correo ni código
   institucional como identificador cruzado.
4. Cada servicio posee su esquema PostgreSQL y no hace joins contra los demás.
5. La emisión inicial debe ser propiedad de Wallet. Auth no debe escribir tablas de Wallet.

## Evidencia

- `README.md`: flujo Google OAuth, tokens Bearer, roles y JWKS.
- `src/auth/auth.service.ts`: aprovisionamiento de la identidad durante el primer inicio de
  sesión.
- `prisma/schema.prisma`: entidad `User`, `Role`, identificador estable y regla de esquema
  por servicio.
- `docs/ECILOST-Diagrama-Clases.md`: `WalletService.issueInitialBalance(studentId)` y la
  regla de que los servicios se comunican por puertos o eventos.

## Decisión pendiente

Se debe seleccionar y documentar uno de estos mecanismos antes de implementar HU-09:

1. Evento `UserCreated` publicado en un Event Broker y consumido idempotentemente por Wallet.
2. Llamada HTTP síncrona desde Auth hacia Wallet mediante un puerto de salida.

La opción 1 requeriría definir broker, paquete o contrato compartido, tópico, esquema del
evento, reintentos, clave de deduplicación y mecanismo de publicación confiable (por ejemplo,
outbox). La opción 2 requeriría definir URL, autenticación entre servicios, timeout, reintentos
y qué ocurre si Wallet no responde después de crear al usuario.

## Consecuencias

- Mientras la decisión siga pendiente, Auth puede crear usuarios pero no puede garantizar la
  emisión inicial de ECICoin.
- No se introducen dependencias de base de datos entre Auth y Wallet.
- El contrato debe transportar como mínimo `userId`, rol, instante de creación e identificador
  único del evento o solicitud para que Wallet sea idempotente.

## Riesgos

- Una llamada HTTP sin estrategia de recuperación puede crear usuarios sin billetera.
- Un evento publicado fuera de la transacción de creación puede perderse si el proceso falla
  entre ambas operaciones.
- Un consumidor no idempotente puede acreditar el saldo inicial más de una vez.

## Referencias

- HU-01, HU-09 y HU-10 en `backlog-azuredevops/ECILOST-Backlog.md`.
- `docs/ECILOST-Diagrama-Clases.md`, secciones de Auth, Wallet y Event Broker.
