# Casino Escolar — versión sin Docker

Aplicación web con moneda ficticia para una experiencia escolar. Cada puesto tiene un QR y un notebook; los participantes escanean el código, entran con su cuenta y el encargado registra rápidamente cuánto ganaron o perdieron.

Esta edición **no necesita Docker ni instalar PostgreSQL**. Incluye PostgreSQL embebido mediante PGlite y guarda todos los datos dentro de la carpeta `data`.

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

Acceso inicial:

```text
Usuario: admin
Clave: Admin2026!
```

El sistema solicitará cambiar esta clave.

## Probar con datos de demostración

Con el programa detenido, ejecuta una vez:

```powershell
npm run seed:demo
```

Después inicia con `npm start`. Se crearán:

| Rol | Usuario | Clave |
|---|---|---|
| Encargado | `mesa1` | `Mesa2026!` |
| Participante | `jugador1` | `Juega2026!` |

También se crea el juego **Ruleta de prueba** y se asigna al encargado.

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
- Botones rápidos **Ganó** y **Perdió**.
- Rangos mínimo y máximo configurables por juego.
- Roles de participante, encargado y administración general.
- Asignación de encargados a puestos específicos.
- Registro auditable de movimientos.
- Reversión de operaciones sin borrar el historial.
- Bloqueo del doble registro de una jugada.
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
5. Asigna cada encargado a su juego.
6. Crea cuentas individuales o usa **Generar muchas cuentas**.
7. Imprime los QR.
8. Realiza una prueba con dos dispositivos antes del evento.

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
src/db.js                  PostgreSQL embebido y persistencia local
src/services/ledger.js     actualización segura de saldos
src/views/                 pantallas editables
src/public/                estilos y JavaScript del navegador
sql/schema.sql             estructura de la base de datos
data/                      datos creados al ejecutar, no viene en el ZIP
test/                      pruebas automáticas
```
