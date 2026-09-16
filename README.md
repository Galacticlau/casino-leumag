# Casino Escolar — versión sin Docker

Aplicación web con moneda ficticia para una experiencia escolar. Cada puesto tiene un QR y un notebook; los participantes escanean el código, entran con su cuenta y el encargado registra rápidamente cuánto ganaron o perdieron.

Esta edición **no necesita Docker ni instalar PostgreSQL** para utilizarse localmente. Incluye PostgreSQL embebido mediante PGlite y guarda todos los datos dentro de la carpeta `data`. También puede conectarse a PostgreSQL de Railway para una ejecución en línea con más conexiones simultáneas.

> Proyecto educativo: no utiliza dinero real, pagos ni premios convertibles en dinero.

## Forma más sencilla de iniciarlo en Windows

### 1. Instalar Node.js

Descarga la versión LTS desde:

https://nodejs.org/

Durante la instalación puedes conservar todas las opciones predeterminadas. Después, cierra y vuelve a abrir Visual Studio Code.

Comprueba la instalación en una terminal nueva:

```powershell
node --version
npm --version
```

### 2. Iniciar la aplicación

Tienes dos alternativas.

**Alternativa A: doble clic**

Abre `INICIAR_WINDOWS.bat`. La primera vez instalará automáticamente los componentes y luego iniciará la aplicación.

**Alternativa B: terminal de VS Code**

```powershell
npm install
npm start
```

Cuando aparezca el mensaje de inicio, abre:

```text
http://localhost:3000
```

En el primer inicio, la terminal mostrará el usuario y una clave temporal generada automáticamente, por ejemplo:

```text
Usuario: admin
Clave temporal generada: Admin-XXXXXXXXXXXX
```

El sistema solicitará cambiarla al ingresar. No publiques ni compartas esa clave.

## Probar con datos de demostración

Con el programa detenido, ejecuta una vez:

```powershell
npm run seed:demo
```

Después inicia con `npm start`. Se crearán:

| Rol | Usuario | Clave |
|---|---|---|
| Encargado | `mesa1` | Se genera y muestra en la terminal |
| Participante | `jugador1` | Se genera y muestra en la terminal |

También se crea el juego **Ruleta de prueba** y se asigna al encargado. Cada vez que ejecutes este comando se generarán nuevas claves de demostración.

## Acceder desde celulares y otros notebooks

Al iniciar, la terminal mostrará dos direcciones parecidas a estas:

```text
Casino Escolar disponible en http://localhost:3000
Desde otros equipos de la red: http://192.168.1.25:3000
```

- En el computador principal usa `localhost`.
- En celulares y otros notebooks usa la segunda dirección.
- Todos los dispositivos deben estar conectados a la misma red Wi-Fi.
- Si Windows pregunta si deseas permitir acceso a Node.js, selecciona **Permitir en redes privadas**.

El programa intenta colocar automáticamente la dirección de red correcta dentro de los QR. Antes de imprimirlos, escanea uno con un celular y comprueba que abre la aplicación.

Si la red del colegio impide que los dispositivos se comuniquen entre sí, prueba con un router propio o un punto de acceso que permita conexiones entre dispositivos.

## Funciones incluidas

- Cuenta individual con saldo e historial.
- QR diferente para cada juego.
- Fila automática de participantes en el notebook del puesto.
- Juegos individuales o rondas grupales de hasta 10 participantes.
- Inicio y cancelación segura de rondas desde el notebook del puesto.
- Resultado individual para cada participante y atajo para aplicar el mismo resultado a todos.
- Rangos mínimo y máximo configurables por juego.
- Roles de participante, encargado y administración general.
- Asignación de encargados a puestos específicos.
- Registro auditable de movimientos.
- Reversión de operaciones sin borrar el historial.
- Bloqueo del doble registro de una jugada.
- Una sola participación activa por estudiante y una sola ronda activa por juego.
- Cierre atómico: la ronda se registra completa o no se modifica ningún saldo.
- Creación masiva de hasta 200 cuentas y descarga de claves en CSV.
- Tarjetas QR listas para imprimir.

## Dónde se guardan los datos

La base se crea automáticamente en:

```text
data/casino-db
```

Para respaldar el evento:

1. Detén el programa con `Ctrl+C`.
2. Copia la carpeta `data` completa a otro lugar.

No borres esa carpeta si quieres conservar cuentas, saldos y movimientos.

## Configuración recomendada

1. Ingresa como administración.
2. Cambia el nombre del evento, moneda y saldo inicial.
3. Crea cuentas de encargados.
4. Crea los juegos.
   - Usa capacidad `1` para juegos individuales.
   - Usa entre `2` y `10` para juegos grupales.
5. Asigna cada encargado a su juego.
6. Crea cuentas individuales o usa **Generar muchas cuentas**.
7. Imprime los QR.
8. Realiza una prueba con dos dispositivos antes del evento.

## Cómo funciona una ronda grupal

1. Los participantes escanean el QR y presionan **Avisar que estoy listo**.
2. El encargado selecciona hasta la capacidad configurada y presiona **Iniciar ronda**.
3. Los celulares seleccionados muestran que la ronda comenzó.
4. El encargado registra quién ganó o perdió y la cantidad correspondiente.
5. **Aplicar a todos** permite copiar rápidamente un resultado común y luego corregir casos individuales.
6. **Cerrar ronda y registrar resultados** actualiza todos los saldos en una sola operación.

Si se cancela una ronda, sus participantes vuelven a la fila sin perder saldo.

## Usar PostgreSQL de Railway

El programa elige automáticamente la base de datos:

- Sin `DATABASE_URL`: utiliza PGlite dentro de `data/casino-db`.
- Con `DATABASE_URL`: utiliza PostgreSQL externo y un grupo de conexiones.

Para producción configura al menos estas variables:

```text
NODE_ENV=production
DATABASE_URL=dirección entregada por PostgreSQL
PUBLIC_URL=https://tu-aplicacion.up.railway.app
SESSION_SECRET=una-clave-larga-y-aleatoria
ADMIN_PASSWORD=una-clave-inicial-segura
```

`DATABASE_POOL_SIZE` tiene valor predeterminado `12`. No es necesario instalar Docker en el computador para desplegar esta versión.

## Detener y volver a iniciar

Para detener el servidor, presiona:

```text
Ctrl+C
```

Para volver a iniciarlo:

```powershell
npm start
```

Los datos se conservarán.

## Comandos útiles

```powershell
npm install         # instalar componentes la primera vez
npm start           # iniciar el programa
npm run seed:demo   # agregar cuentas de demostración
npm test            # ejecutar pruebas automáticas
npm run check       # revisar sintaxis
```

## Estructura del proyecto

```text
src/server.js              rutas y funcionamiento de la aplicación
src/db.js                  selección entre PostgreSQL local y Railway
src/services/ledger.js     actualización segura de saldos
src/services/rounds.js     inicio, cancelación y cierre atómico de rondas
src/views/                 pantallas editables
src/public/                estilos y JavaScript del navegador
sql/schema.sql             estructura de la base de datos
data/                      datos creados al ejecutar, no viene en el ZIP
test/                      pruebas automáticas
```
