# Foro de ZONA GAMERS

Aplicación Express/EJS para la comunidad, con usuarios, perfiles, foros y sesiones persistidas en `database/zona-gamers.db`. La miniweb original situada en la raíz del proyecto permanece independiente.

## Iniciar

Desde esta carpeta, instala las dependencias con `npm install` y ejecuta `npm start`. La aplicación estará disponible en `http://localhost:3000` (o en el puerto definido por `PORT`).

En producción, configura `NODE_ENV=production` y una clave privada larga en `SESSION_SECRET`. El servidor exige esa variable en producción y usa cookies `Secure`, `HttpOnly` y `SameSite=Lax`; se espera que TLS termine en un proxy confiable.

El esquema y las categorías se crean automáticamente en SQLite al iniciar. `DATABASE_PATH` permite seleccionar otra ruta SQLite; si no está configurada, se usa `database/zona-gamers.db`. Las contraseñas se guardan con bcrypt y la aplicación aplica límites de acceso a autenticación y protección CSRF a las solicitudes de escritura.

Ejecuta `npm test` para verificar las rutas y los flujos principales sobre una base temporal aislada. El secreto de sesión de desarrollo se genera al arrancar; las sesiones locales dejan de ser válidas tras reiniciar el servidor.
