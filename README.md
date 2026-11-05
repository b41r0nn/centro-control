# centro-control

Un mini centro de control para Claude Code: un panel que se queda al lado del chat
y se actualiza solo, en cada sesion nueva y en las que ya tenias abiertas.

## Que muestra

- **Contexto**: tokens de entrada de la ultima respuesta contra la ventana del modelo, con barra y porcentaje.
- **Limites de uso**: la ventana de 5 horas y la de 7 dias que reporta la API, con el porcentaje usado y cuanto falta para que se reinicien. Si la cuenta reporta otras ventanas (por ejemplo un limite de gasto de un gateway), tambien salen.
- **Tokens**: contador propio de tokens de hoy, de la semana y de la sesion, guardado entre sesiones, mas el costo acumulado.
- **Actividad**: si hay un turno en curso, cuanto lleva, cuantas herramientas uso, cual fue la ultima y con que argumento, y el inicio del pedido que lo arranco.
- **Tareas y agentes**: barra de progreso de terminados sobre lanzados, y una linea por agente con su estado, su tipo, cuantas herramientas uso y su descripcion.
- **Alertas**: cada llamada potencialmente peligrosa que pasa por el motor (borrados recursivos, `git push --force`, `reset --hard`, SQL sin `WHERE`, descargas canalizadas a shell, `terraform destroy`, escrituras sobre `.env` o llaves, y mas). Avisa con un toast y una notificacion del sistema; **no bloquea nada**.
- **Linea de estado**: un resumen corto y permanente abajo (`ctx 41% · 5h 18% · 7d 62% · hoy 1.2M`).

## Botones

`Mejorar prompt` (m) reescribe el borrador que tengas en la caja del prompt con Haiku
y lo deja ahi para que lo revises. `Copiar resumen` (c) copia al portapapeles el
resumen de todo lo anterior. `Limpiar alertas` (l) vacia la lista. `Compactar` (k)
aparece cuando el contexto pasa del 70%.

## Comandos

- `/centro` abre el panel (a cualquier ancho de terminal).
- `/mejora` mejora el borrador del prompt sin abrir el panel.
- `/estado` escribe el resumen en la conversacion, donde el modelo tambien lo lee.

## Notas

El panel se abre solo al arrancar la sesion, pero el motor solo lo dibuja sin que se
lo pidan desde 144 columnas de ancho (110 una vez que lo hayas abierto a mano). En una
terminal mas angosta queda abierto esperando: `/centro` lo coloca a cualquier ancho.

El contador de tokens de hoy y de la semana es propio del mod: la API no expone un
limite diario ni semanal, solo las ventanas de 5 horas y 7 dias, que son las que salen
con porcentaje real.

## Instalacion

En el prompt de una sesion de terminal:

```
/plugin install centro-control --marketplace b41r0nn/centro-control
```

Responde `y` para agregar el marketplace y Enter para aceptar el scope de usuario.
Desde un shell es lo mismo con `claude plugin install`. En la app de escritorio, donde
`/plugin` no corre: el boton + al lado de la caja del prompt, Plugins, Add marketplace
con `b41r0nn/centro-control`, y despues Add plugin.

Queda activo en esa misma sesion, y en cada sesion que empiece despues.

## Requisitos

Claude Code 2.1.318 o cercano. Los function hooks son early access y su API cambia
entre releases, asi que en una version bastante mas vieja el modulo puede no cargar.

## Editarlo

Clonar el repositorio y correr la sesion apuntando a la carpeta:

```
claude --plugin-dir <la carpeta del clon>
```

Asi el motor recarga el mod cada vez que guardas un archivo, y deja los tipos del
build en `.claude-plugin/types/` para que el editor y `tsc -p .` lo revisen.
`claude plugin validate .` lee el manifiesto y el modulo como lo hara el motor, y
`claude plugin test .` corre las pruebas de `centro.test.tsx`.
