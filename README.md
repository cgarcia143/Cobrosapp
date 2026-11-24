# Cobranzas

PWA de créditos y cobranzas en pesos colombianos. Angular 21 y Firebase, con una sede (tenant) por oficina o independiente.

Angular 22 es la línea más nueva, pero exige Node 22.22 o superior. Este equipo tiene Node 22.17, así que el proyecto usa Angular 21.2, la última versión estable que compila aquí.

## Roles

Los Custom Claims los escribe solo Cloud Functions con el Admin SDK. El cliente no puede cambiarlos.

| Claim | Super admin | Oficina | Cobrador | Independiente |
| --- | --- | --- | --- | --- |
| `role` | `super_admin` | `oficina_admin` | `cobrador` | `independiente` |
| `tenantId` | `null` | id de la sede | id de la sede | id de la sede |
| `subscriptionActive` | `true` | según la sede | según la sede | según la sede |

El cobrador lista únicamente créditos con `collectorUid == uid`, registra pagos y sube la foto del cobro. No puede borrar pagos ni consultar los reportes de la sede. La oficina y el independiente administran clientes, créditos y reportes de su tenant. El super administrador ve todas las sedes, registra el pago de la suscripción y suspende o habilita cuentas.

## Firestore

```text
tenants/{tenantId}
  name, type, status, ownerUid, capitalCop, city, phone
  subscription: { plan, cycle, amountCop, nextDue, lastPaymentAt }

tenants/{tenantId}/members/{uid}
tenants/{tenantId}/clients/{clientId}
tenants/{tenantId}/credits/{creditId}
tenants/{tenantId}/credits/{creditId}/installments/{installmentId}
tenants/{tenantId}/payments/{paymentId}
tenants/{tenantId}/billingPayments/{paymentId}
```

`status` de la sede: `trial`, `activo`, `suspendido`.

El crédito guarda el saldo, la próxima cuota y `lastPaymentDate` (`AAAA-MM-DD` en Bogotá) para armar la ruta sin recorrer todas las cuotas. La cuota también vive en la subcolección, que es la fuente del calendario.

Las reglas separan `list` de `get`. El administrador puede listar la colección de su sede. El cobrador solo puede listar documentos cuyo `collectorUid` es su uid, así que una consulta de reportes sin ese filtro queda denegada. Los pagos no se pueden actualizar ni borrar: un error se corrige con un abono compensatorio.

Storage:

```text
tenants/{tenantId}/credits/{creditId}/documents/{archivo}
tenants/{tenantId}/credits/{creditId}/acceptance/{archivo}
tenants/{tenantId}/payments/{paymentId}/{archivo}
```

## Cuotas

La tasa es plana sobre el capital y el resultado se redondea al peso:

```text
interés = round(capital * tasa / 100)
total = capital + interés
cuota = floor(total / n)
última cuota = cuota + residuo
```

La primera cuota vence el día de inicio. Diario suma 1 día, semanal 7, quincenal 15 y mensual conserva el día de calendario, con tope al último día del mes. Todas las fechas de vencimiento quedan a las 00:00 de `America/Bogota`.

La ganancia de un pago es la parte proporcional del interés: `round(abono * interés / total)`.

## Offline

Hay dos capas:

- El service worker de Angular guarda el cascarón de la PWA.
- Firestore usa `persistentLocalCache` con `persistentMultipleTabManager`. La agenda escucha con `onSnapshot` e `includeMetadataChanges`. `metadata.fromCache` indica que la pantalla salió de IndexedDB. `metadata.hasPendingWrites` indica pagos todavía en cola.

La primera visita a una ruta tiene que hacerse con conexión para llenar la caché. Las transacciones no se encolan sin red, por eso los pagos usan un `writeBatch`. Las imágenes y los videos no se encolan: si no hay red, el servicio rechaza la evidencia y no deja el crédito a medias.

## Suscripción

`createTenant` abre 15 días de prueba. `registerSubscriptionPayment` corre la fecha un mes o un año y reactiva la sede. `setTenantAccess` suspende o habilita. `enforceSubscriptions` corre todos los días a las 00:10 en Bogotá y suspende sedes vencidas. En los tres casos se reescriben los claims y se revocan los refresh tokens.

Las reglas también leen `tenants/{id}.status`. Aunque el token tarde en renovarse, una sede `suspendido` no puede escribir.

## Impresión

El recibo de 58 mm se puede enviar por Web Bluetooth, en comandos ESC/POS y trozos de 180 bytes, o por el cuadro de impresión del navegador. Bluetooth clásico (SPP) no está disponible en el navegador. Las tildes se simplifican porque muchas mini impresoras no traen UTF-8.

## Puesta en marcha

1. Crea el proyecto en Firebase: Auth correo/contraseña, Firestore, Storage y Functions en `southamerica-east1`.
2. Copia las credenciales web a `src/environments/environment.ts` y `environment.prod.ts`.
3. En `.firebaserc`, reemplaza `REEMPLAZAR_PROJECT_ID`.
4. Crea el primer usuario en Authentication.
5. Asigna el super administrador, con una cuenta de servicio o `gcloud auth application-default login`:

```bash
cd functions
npm install
npm run set-super-admin -- correo@empresa.com
```

6. Despliega reglas, índices y funciones:

```bash
firebase deploy --only firestore,storage,functions
```

7. Arranca la PWA:

```bash
npm start
```

Ese usuario cierra sesión y vuelve a entrar. Desde Plataforma crea la sede con el correo de un dueño que ya exista en Auth. El dueño vuelve a entrar y, si es oficina, vincula cobradores desde Equipo.
