# Foro de ZONA GAMERS

Aplicación Express/EJS para la comunidad, con usuarios, perfiles, foros y sesiones persistidas en `database/zona-gamers.db`. La miniweb original situada en la raíz del proyecto permanece independiente.

## Iniciar

Desde esta carpeta, instala las dependencias con `npm install` y ejecuta `npm start`. La aplicación estará disponible en `http://localhost:3000` (o en el puerto definido por `PORT`).

En producción, configura `NODE_ENV=production` y una clave privada larga en `SESSION_SECRET`. El servidor exige esa variable en producción y usa cookies `Secure`, `HttpOnly` y `SameSite=Lax`; se espera que TLS termine en un proxy confiable.

El esquema y las categorías se crean automáticamente en SQLite al iniciar. Las migraciones aditivas conservan las publicaciones y usuarios existentes y registran los adjuntos en la tabla `attachments`. `DATABASE_PATH` permite seleccionar otra ruta SQLite; si no está configurada, se usa `database/zona-gamers.db`. Los archivos subidos se guardan en `uploads/` (configurable con `UPLOADS_PATH`) y sus rutas y tipo MIME se asocian en SQLite al publicar. Las contraseñas se guardan con bcrypt y la aplicación aplica límites de acceso a autenticación y protección CSRF a las solicitudes de escritura.

El panel de miembros en línea deduplica usuarios autenticados según `sessions.last_seen`; se consideran activos durante cinco minutos. El editor valida el contenido en el servidor, asocia solamente archivos subidos por el usuario autenticado y sanitiza el HTML al almacenarlo y renderizarlo.

Los perfiles admiten avatares JPG/JPEG, PNG, WebP, GIF y HEIC/HEIF de hasta 20 MB. Las fotos se orientan según sus metadatos, se convierten en el servidor para la vista previa y se guardan optimizadas como avatares cuadrados; el recorte puede ajustarse desde el navegador. También se admite biografía, cambio de usuario con un plazo de 15 días y cambio de contraseña con revocación de las demás sesiones. Los roles `CEO`, `Admin`, `Moderator` y `Soporte` tienen etiquetas visibles; la autorización se verifica en el servidor y los cambios quedan auditados. La migración inicial promueve de forma idempotente la cuenta existente `RETROCESO` a `Admin` sin modificar su contraseña. No hay un proveedor de correo configurado: las solicitudes de cambio de email quedan pendientes y no alteran el correo actual.

Ejecuta `npm test` para verificar las rutas y los flujos principales sobre una base temporal aislada, incluyendo permisos de roles, migración y perfiles. En desarrollo, `SESSION_SECRET` se conserva en `forum/.env` si se configura; sin esa variable, se genera uno nuevo al arrancar y las sesiones locales dejan de ser válidas tras reiniciar el servidor.
