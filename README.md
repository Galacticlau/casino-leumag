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
SESSION_SECRET=una-clave-larga-y-aleatoria
ADMIN_PASSWORD=una-clave-inicial-segura
```

Railway entrega automáticamente `RAILWAY_PUBLIC_DOMAIN`; el programa lo utiliza para generar los enlaces y los códigos QR. `PUBLIC_URL` queda como variable opcional si posteriormente quieres utilizar un dominio propio.

En **Settings → Public Networking**, selecciona **Generate Domain**. Si Railway solicita el puerto interno, escribe `3000`. La ruta de comprobación de salud es `/health`.

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


### Apuestas antes de la ronda

En **Administración → Juegos → Opciones para apostar**, escribe una opción por línea para crear la botonera de ese juego. Hay un máximo de 12 opciones. Los juegos comienzan con el botón genérico «Participar»; configura sus opciones reales antes del evento. Bingo y ruleta conservan su flujo independiente, sin esta apuesta previa.

Al entrar desde el QR, cada participante selecciona opción y monto y confirma para entrar a la fila. Se valida el rango de la mesa y el saldo, tanto al confirmar como al iniciar la ronda. La opción y el monto aparecen en la fila y en la ronda activa. Para cambiar una apuesta pendiente, cancela la espera y vuelve a entrar; una ronda iniciada conserva su apuesta.

El saldo no se descuenta al entrar: se liquida al cerrar la ronda. Si perdió, el sistema descuenta exactamente la apuesta confirmada. Si ganó, la encargada registra la **ganancia neta**, sin sumar la devolución de la apuesta. Por ejemplo, con saldo $10.000 y apuesta $500, perder deja $9.500; ganar $500 deja $10.500. Se mantiene el rango de resultados configurado para el juego. La apuesta también queda identificada en el movimiento de la cuenta.

Las opciones se pueden editar cuando no hay participantes pendientes ni una ronda en juego. Las participaciones pendientes anteriores a esta actualización deben cancelarse y confirmarse de nuevo para registrar la apuesta.


### Inscripción con QR

En **Administración → Inscripción por QR**, abre «Generar y administrar QR de inscripción» y pulsa **Generar QR y abrir inscripción**. Puedes imprimir el QR o compartir el enlace. El QR lleva a `/register`, donde cada participante escribe su nombre completo, elige un usuario `nombre.apellido` y una clave. Se aceptan claves sencillas como `123` o `1`, sin largo mínimo ni requisitos de composición. La clave se almacena cifrada mediante hash, y no se exige cambiarla al entrar.

Cada cuenta creada aquí es participante, comienza con $10.000 y registra su saldo inicial en los movimientos. Si el usuario ya existe, el formulario pide agregar un número o iniciar sesión. La inscripción comienza cerrada y solo la administración general puede abrirla o cerrarla. Al cerrarla, las cuentas existentes conservan su acceso; al reabrirla sirve el mismo QR.
