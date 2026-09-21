# ADR-0001: Identidad de Auth y provisión inicial de billetera

## Estado

Accepted — RabbitMQ y un outbox transaccional entregan `user.created.v1` a Wallet.

## Contexto

`ecilost-auth-service` autentica mediante Google OAuth 2.0, aprovisiona una identidad local
y emite access tokens propios. HU-09 requiere que un estudiante recién creado reciba una
emisión inicial de ECICoin, responsabilidad de `ecilost-wallet-service`.

## Problema

Auth es el único componente que hoy conoce de forma confiable la creación inicial de un
usuario. Wallet debe crear la billetera una sola vez, sin depender de joins entre bases de
datos ni perder la emisión si Wallet no está disponible. No hay una integración entre los
dos repositorios.

## Decisiones

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

## Decisión de integración

Auth persiste `user.created.v1` en `outbox_events` dentro del mismo `upsert` que crea la
identidad. Un publicador lo envía a RabbitMQ al exchange duradero `ecilost.events`, con la
routing key `user.created.v1`, y marca el registro como publicado solo después de la
confirmación del broker. Si RabbitMQ no está disponible, la identidad se conserva y el evento
se reintenta.

Wallet consume la cola duradera `ecilost.wallet.user-created`. El mensaje contiene `eventId`,
`userId`, `role` y `occurredAt`; solo los usuarios `STUDENT` activan `bootstrap(userId)`. El
consumer confirma el mensaje después del bootstrap y lo reencola ante un fallo. `bootstrap` usa
un `upsert` y una referencia única, por lo que tolera entregas al menos una vez sin duplicar la
emisión inicial.

## Consecuencias

- Auth no depende de la disponibilidad de Wallet ni de RabbitMQ durante el login; el outbox
  conserva la intención de aprovisionar la billetera.
- No se introducen dependencias de base de datos entre Auth y Wallet.
- RabbitMQ entrega al menos una vez; Wallet debe conservar el consumo idempotente.

## Riesgos

- Un publisher detenido deja eventos pendientes en el outbox y retrasa, pero no pierde, la
  provisión. Deben monitorearse su antigüedad y número de intentos.
- Un consumidor no idempotente acreditaría el saldo inicial más de una vez; Wallet lo evita con
  su operación de bootstrap idempotente.

## Referencias

- HU-01, HU-09 y HU-10 en `backlog-azuredevops/ECILOST-Backlog.md`.
- `docs/ECILOST-Diagrama-Clases.md`, secciones de Auth, Wallet y Event Broker.
