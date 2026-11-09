const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { after, before, test } = require('node:test');

const forumDirectory = path.resolve(__dirname, '..');
let temporaryDirectory;
let databasePath;
let uploadsPath;
let port;
let server;
let serverOutput = '';
const cookies = new Map();

function listenOnAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: availablePort } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(availablePort));
    });
  });
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: forumDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_PATH: databasePath,
      UPLOADS_PATH: uploadsPath,
      SESSION_SECRET: 'test-only-session-secret-never-used-outside-temporary-database'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Forum server exited unexpectedly:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Forum server did not start:\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out stopping the isolated test server.'));
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
  server = null;
}

async function request(url, { method = 'GET', fields, headers = {}, session = 'primary' } = {}) {
  const requestHeaders = { ...headers };
  if (cookies.has(session)) requestHeaders.Cookie = cookies.get(session);
  const body = fields ? new URLSearchParams(fields).toString() : undefined;
  if (body) requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: requestHeaders,
    body,
    redirect: 'manual'
  });
  const setCookies = response.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) => value.startsWith('zona.sid='));
  if (sessionCookie) cookies.set(session, sessionCookie.split(';')[0]);
  return response;
}

async function uploadMedia(token, files, session = 'primary') {
  const body = new FormData();
  for (const file of Array.isArray(files) ? files : [files]) {
    body.append('media', new Blob([file.content], { type: file.mime }), file.name);
  }
  const headers = { Accept: 'application/json', 'X-CSRF-Token': token };
  if (cookies.has(session)) headers.Cookie = cookies.get(session);
  return fetch(`http://127.0.0.1:${port}/publicaciones/medios`, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual'
  });
}

async function uploadAvatar(token, file, session = 'primary') {
  const body = new FormData();
  body.append('avatar', new Blob([file.content], { type: file.mime }), file.name);
  const headers = { Accept: 'application/json', 'X-CSRF-Token': token };
  if (cookies.has(session)) headers.Cookie = cookies.get(session);
  return fetch(`http://127.0.0.1:${port}/perfil/avatar`, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual'
  });
}

async function previewAvatar(token, file, session = 'primary') {
  const body = new FormData();
  body.append('avatar', new Blob([file.content], { type: file.mime }), file.name);
  const headers = { Accept: 'application/json', 'X-CSRF-Token': token };
  if (cookies.has(session)) headers.Cookie = cookies.get(session);
  return fetch(`http://127.0.0.1:${port}/perfil/avatar/preview`, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual'
  });
}

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]*)"/);
  assert.ok(match, 'Expected a CSRF input in the rendered form.');
  assert.ok(match[1], 'Expected a non-empty CSRF token.');
  return match[1];
}

async function responseText(response) {
  return response.text();
}

before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-gamers-forum-test-'));
  databasePath = path.join(temporaryDirectory, 'forum-test.db');
  uploadsPath = path.join(temporaryDirectory, 'uploads');
  port = await listenOnAvailablePort();
  await startServer();
});

after(async () => {
  await stopServer();
  if (uploadsPath && fs.existsSync(uploadsPath)) {
    for (const file of fs.readdirSync(uploadsPath)) fs.unlinkSync(path.join(uploadsPath, file));
    fs.rmdirSync(uploadsPath);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${databasePath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (temporaryDirectory && fs.existsSync(temporaryDirectory)) fs.rmdirSync(temporaryDirectory);
});

test('GET / renders for a visitor without a session', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<title>Inicio \| ZONA GAMERS<\/title>/);
  assert.match(response.headers.get('content-security-policy'), /img-src[^;]*blob:/,
    'Local image object URLs must be allowed for avatar previews and cropping.');
  assert.match(html, /href="\/login">Iniciar sesión<\/a>/);
  assert.match(html, /href="\/registro">Registrarse<\/a>/);
  assert.match(html, /discord.com\/widget\?id=1340227657757098034/);
  assert.match(html, /<strong>ZONA GAMERS DISCORD<\/strong>/);
  assert.match(html, /<small>Únete para conocer toda esta comunidad gamer\.<\/small>/);
  assert.match(html, /data-discord-icon(?:\s|>)/);
  assert.doesNotMatch(html, /data-discord-icon-fallback|>ZG</);
  assert.match(html, /data-discord-members>—/);
  assert.match(html, /Escoge en qué juego quieres publicar tus preguntas y saber cómo jugar en alguno de nuestros servidores/);
  assert.match(html, /Desarrollador Web - Sebastian Bragga - <a href="mailto:sebastianbragga@gmail\.com">sebastianbragga@gmail\.com<\/a>/);
  assert.doesNotMatch(html, /TRUCKERS LATINOAMÉRICA|SIMULACIÓN · COMUNIDAD · RUTA|Entrar al foro/);
  assert.doesNotMatch(html, /href="\/comunidad"/);
  assert.doesNotMatch(html, /Discord oficial/);
  assert.doesNotMatch(html, /class="nav-user"/);
  assert.doesNotMatch(html, /class="nav-logout"/);
  assert.doesNotMatch(html, /ReferenceError|currentUser is not defined|pageTitle is not defined/);
});

test('forum pages, authentication, sessions, posts, comments, and profiles work end to end', async () => {
  let response = await request('/');
  let html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, /<title>Inicio \| ZONA GAMERS<\/title>/);
  assert.match(html, /RECUERDA QUE TENEMOS SERVIDORES EN ESTOS JUEGOS/);
  assert.match(html, /Escoge en qué juego quieres publicar tus preguntas y saber cómo jugar en alguno de nuestros servidores/);
  assert.equal(
    (html.match(/<a class="game-card"/g) || []).length
      + (html.match(/<article class="game-card game-card-coming/g) || []).length,
    6
  );
  assert.match(html, /href="\/juegos\/american-truck"/);
  assert.match(html, /href="\/juegos\/fivem"/);
  assert.match(html, /href="\/juegos\/dayz"/);
  assert.match(html, /href="\/juegos\/arma-reforger"/);
  assert.doesNotMatch(html, /Últimas publicaciones|La carretera está despejada|Actividad reciente/);
  assert.doesNotMatch(html, /Entrar al foro|TRUCKERS LATINOAMÉRICA|SIMULACIÓN · COMUNIDAD · RUTA/);
  assert.match(html, /data-discord-online/);
  assert.match(html, /data-discord-status/);

  for (const [url, title] of [
    ['/foros', 'Foros'],
    ['/comunidad', 'Comunidad'],
    ['/registro', 'Crear cuenta'],
    ['/login', 'Iniciar sesión']
  ]) {
    response = await request(url);
    html = await responseText(response);
    assert.equal(response.status, 200, `${url} should load.`);
    assert.ok(html.includes(`<title>${title} | ZONA GAMERS</title>`), `${url} should set its page title.`);
    if (url === '/login') {
      assert.match(html, /class="auth-wrap auth-login"/);
      assert.doesNotMatch(html, /auth-route-mark|>US</);
    }
  }

  const gameRoutes = [
    ['/juegos/american-truck', 'AMERICAN TRUCK SIMULATOR', 'American Truck Simulator'],
    ['/juegos/fivem', 'FIVE M', 'FiveM'],
    ['/juegos/dayz', 'DAYZ', 'DayZ'],
    ['/juegos/arma-reforger', 'ARMA REFORGER', 'Arma Reforger']
  ];
  for (const [url, name] of gameRoutes) {
    response = await request(url);
    html = await responseText(response);
    assert.equal(response.status, 200, `${url} should load.`);
    assert.match(html, new RegExp(`<h1>${name}</h1>`));
    assert.match(html, /href="\/">← Volver al selector de juegos<\/a>/);
    assert.doesNotMatch(html, /FORO DE JUEGO/);
    assert.match(html, /Aún no hay publicaciones/);
    assert.equal((html.match(/<details class="game-faq">/g) || []).length, 3);
    assert.match(html, /<summary>.*<\/summary>/);
    assert.match(html, /href="\/login">Inicia sesión para publicar<\/a>/);
  }
  response = await request('/juegos/no-existe');
  assert.equal(response.status, 404);
  response = await request('/publicaciones/nueva?juego=fivem');
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login/);

  response = await request('/foros');
  html = await responseText(response);
  const categoryNames = [
    'American Truck Simulator', 'Euro Truck Simulator 2', 'Mods y modificaciones',
    'Camiones y configuraciones', 'Convoyes y multijugador', 'Soporte técnico',
    'Noticias y anuncios', 'Comunidad y conversaciones generales',
    'FiveM', 'DayZ', 'Arma Reforger'
  ];
  for (const name of categoryNames) assert.ok(html.includes(name), `Missing category: ${name}`);

  for (const asset of ['/css/forum.css', '/js/forum.js', '/assets/img/logo-zona-gamers.png', '/assets/img/fondo-truck.jpg']) {
    response = await request(asset);
    assert.equal(response.status, 200, `Static asset ${asset} should load.`);
  }

  response = await request('/publicaciones/nueva');
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login/);
  response = await request('/publicaciones/1/comentarios', {
    method: 'POST',
    fields: { content: 'No token' }
  });
  assert.equal(response.status, 403);
  assert.match(await responseText(response), /Solicitud no válida/);

  response = await request('/registro');
  html = await responseText(response);
  const firstUser = `camionero_${Date.now()}`;
  const firstEmail = `${firstUser}@example.test`;
  response = await request('/registro', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      username: firstUser,
      email: firstEmail,
      password: 'short',
      confirm_password: 'short',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/registro\?error=/);
  response = await request('/transicion');
  assert.equal(response.status, 404, 'The authentication transition route must not exist.');

  response = await request('/registro', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      username: firstUser,
      email: firstEmail,
      password: 'TestPassword!123',
      confirm_password: 'TestPassword!123',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  response = await request('/');
  html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, new RegExp(`>${firstUser}<`), 'Registration should immediately establish an authenticated session on the home page.');
  assert.match(html, /class="nav-logout"/);

  const Database = require('better-sqlite3');
  let testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  const storedPassword = testDb.prepare('SELECT password FROM users WHERE username = ?').get(firstUser).password;
  assert.notEqual(storedPassword, 'TestPassword!123');
  assert.ok(require('bcryptjs').compareSync('TestPassword!123', storedPassword));
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 11);
  testDb.close();

  response = await request('/perfil/' + firstUser);
  assert.equal(response.status, 200, 'Registration should establish the authenticated session after account creation.');
  response = await request('/');
  html = await responseText(response);
  response = await request('/logout', { method: 'POST', fields: { _csrf: tokenFrom(html) } });
  assert.equal(response.status, 302);

  response = await request('/registro', { session: 'retroceso' });
  html = await responseText(response);
  response = await request('/registro', {
    method: 'POST',
    session: 'retroceso',
    fields: {
      _csrf: tokenFrom(html),
      username: 'RETROCESO',
      email: `retroceso_${Date.now()}@example.test`,
      password: 'TestPassword!123',
      confirm_password: 'TestPassword!123',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  response = await request('/', { session: 'retroceso' });
  html = await responseText(response);
  response = await request('/logout', {
    method: 'POST',
    session: 'retroceso',
    fields: { _csrf: tokenFrom(html) }
  });
  assert.equal(response.status, 302);
  testDb = new Database(databasePath);
  const retrocesoPasswordHash = testDb.prepare('SELECT password FROM users WHERE username = ?')
    .get('RETROCESO').password;
  assert.equal(testDb.prepare('SELECT role FROM users WHERE username = ?').get('RETROCESO').role, 'user');
  testDb.close();

  response = await request('/login');
  html = await responseText(response);
  response = await request('/login', {
    method: 'POST',
    fields: { _csrf: tokenFrom(html), identity: firstUser, password: 'DefinitelyWrongPassword!' }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login\?error=/);
  response = await request(response.headers.get('location'));
  assert.equal(response.status, 200);
  assert.match(await responseText(response), /Correo, usuario o contraseña incorrectos\./);

  response = await request('/login');
  html = await responseText(response);
  response = await request('/login', {
    method: 'POST',
    fields: { _csrf: tokenFrom(html), identity: firstUser, password: 'TestPassword!123' }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  response = await request('/');
  html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, new RegExp(`>${firstUser}<`));
  assert.match(html, /<form class="nav-logout" action="\/logout" method="post">/);

  await stopServer();
  await startServer();
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  assert.equal(testDb.prepare('SELECT role FROM users WHERE username = ?').get('RETROCESO').role, 'admin');
  assert.equal(testDb.prepare('SELECT password FROM users WHERE username = ?').get('RETROCESO').password, retrocesoPasswordHash);
  assert.equal(testDb.prepare(`
    SELECT COUNT(*) AS count FROM role_change_audit
    WHERE target_user_id = (SELECT id FROM users WHERE username = 'RETROCESO')
      AND previous_role = 'user' AND new_role = 'admin'
  `).get().count, 1, 'The RETROCESO role migration should be audited once.');
  testDb.close();
  await stopServer();
  await startServer();
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  assert.equal(testDb.prepare(`
    SELECT COUNT(*) AS count FROM role_change_audit
    WHERE target_user_id = (SELECT id FROM users WHERE username = 'RETROCESO')
      AND previous_role = 'user' AND new_role = 'admin'
  `).get().count, 1, 'Restarting must not duplicate the idempotent role migration.');
  testDb.close();
  response = await request(`/perfil/${firstUser}`);
  html = await responseText(response);
  assert.equal(response.status, 200, 'A saved session should survive a server restart.');
  assert.ok(html.includes(firstUser));
  assert.ok(!html.includes(firstEmail), 'A public profile must not expose the member email.');

  const gamePosts = [];
  response = await request('/publicaciones/nueva?juego=american-truck');
  html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, /data-rich-editor/);
  assert.match(html, /data-command="bold"/);
  assert.match(html, /data-command="italic"/);
  assert.match(html, /data-command="underline"/);
  assert.match(html, /data-command="justifyCenter"/);
  assert.match(html, /data-link-dialog/);
  assert.match(html, /data-video-dialog/);
  const uploadToken = tokenFrom(html);
  response = await uploadMedia(uploadToken, {
    name: 'screenshot.png',
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  });
  assert.equal(response.status, 201);
  const uploadedImage = await response.json();
  assert.equal(uploadedImage.media.length, 1);
  assert.equal(uploadedImage.media[0].kind, 'image');
  assert.match(uploadedImage.media[0].url, /^\/uploads\/[a-f\d-]{36}\.png$/);

  response = await uploadMedia(uploadToken, [{
    name: 'screenshot-two.png',
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  }, {
    name: 'screenshot-three.png',
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  }]);
  assert.equal(response.status, 201);
  const uploadedImages = await response.json();
  assert.equal(uploadedImages.media.length, 2, 'Multiple images should be uploaded in one request.');
  uploadedImages.media.forEach((media) => assert.equal(media.kind, 'image'));

  response = await uploadMedia(uploadToken, {
    name: 'clip.mp4',
    mime: 'video/mp4',
    content: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom0000', 'ascii')])
  });
  assert.equal(response.status, 201);
  const uploadedVideo = await response.json();
  assert.equal(uploadedVideo.media[0].kind, 'video');
  assert.match(uploadedVideo.media[0].url, /^\/uploads\/[a-f\d-]{36}\.mp4$/);

  response = await uploadMedia(uploadToken, {
    name: 'not-an-image.png',
    mime: 'image/png',
    content: Buffer.from('not a PNG')
  });
  assert.equal(response.status, 400, 'The upload endpoint must reject mismatched file contents.');
  assert.match((await response.json()).error, /no coincide con un formato/);
  response = await uploadMedia(uploadToken, {
    name: 'payload.exe',
    mime: 'application/octet-stream',
    content: Buffer.from('MZ executable')
  });
  assert.equal(response.status, 400, 'Executable files must be rejected before they are stored.');

  response = await uploadMedia(uploadToken, Array.from({ length: 6 }, (_, index) => ({
    name: `extra-${index}.png`,
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  })));
  assert.equal(response.status, 400, 'The upload endpoint must enforce the five-file limit.');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.doesNotMatch(serverOutput, /Unhandled error for POST \/publicaciones\/medios/,
    'Expected upload validation errors should be returned without being logged as unhandled middleware errors.');

  response = await uploadMedia(uploadToken, {
    name: 'oversized.png',
    mime: 'image/png',
    content: Buffer.alloc(10 * 1024 * 1024 + 1)
  });
  assert.equal(response.status, 413, 'The upload endpoint must enforce the per-file size limit.');

  response = await request(uploadedImage.media[0].url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  response = await request(uploadedVideo.media[0].url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /video\/mp4/);

  for (const [url, , categoryName] of gameRoutes) {
    const slug = url.slice('/juegos/'.length);
    response = await request(`/publicaciones/nueva?juego=${slug}`);
    html = await responseText(response);
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`<input type="hidden" name="game" value="${slug}">`));
    assert.match(html, /data-rich-editor/);
    assert.ok(html.includes(categoryName));
    const title = `Tema ${slug} ${Date.now()}`;
    response = await request('/publicaciones', {
      method: 'POST',
      fields: {
        _csrf: tokenFrom(html),
        game: slug,
        category_id: '1',
        title,
        content: slug === 'american-truck'
          ? `<p style="text-align:center"><strong>Publicación exclusiva</strong> <em><u>para el foro ${categoryName}</u></em>.</p><figure><img src="${uploadedImage.media[0].url}" alt="Captura"><img src="${uploadedImages.media[0].url}" alt="Segunda captura"><img src="${uploadedImages.media[1].url}" alt="Tercera captura"><video controls><source src="${uploadedVideo.media[0].url}" type="video/mp4"></video><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Video de prueba"></iframe></figure><script>window.pwned = true</script><img src="https://example.test/unsafe.png">`
          : `Publicación exclusiva para el foro ${categoryName}.`
      }
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /^\/publicaciones\/\d+\?mensaje=/);
    gamePosts.push({
      slug,
      title,
      categoryName,
      postPath: response.headers.get('location').split('?')[0]
    });
  }

  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  for (const post of gamePosts) {
    const storedCategory = testDb.prepare(`
      SELECT categories.name
      FROM posts JOIN categories ON categories.id = posts.category_id
      WHERE posts.title = ?
    `).get(post.title);
    assert.equal(storedCategory.name, post.categoryName, 'Game posts must use the server-selected category.');
  }
  const truckPost = gamePosts.find((post) => post.slug === 'american-truck');
  const attachedFiles = testDb.prepare(`
    SELECT path, mime_type FROM attachments
    WHERE post_id = (SELECT id FROM posts WHERE title = ?) AND comment_id IS NULL
    ORDER BY id
  `).all(truckPost.title);
  assert.equal(attachedFiles.length, 4, 'Three images and one video should be linked to the saved post.');
  assert.equal(attachedFiles.filter((file) => file.mime_type.startsWith('image/')).length, 3);
  testDb.close();

  for (const game of gamePosts) {
    response = await request(`/juegos/${game.slug}`);
    html = await responseText(response);
    assert.equal(response.status, 200);
    assert.ok(html.includes(game.title), `${game.slug} should show its own post.`);
    for (const otherGame of gamePosts.filter((candidate) => candidate.slug !== game.slug)) {
      assert.ok(!html.includes(otherGame.title), `${game.slug} must not show posts from ${otherGame.slug}.`);
    }
    assert.match(html, new RegExp(`href="/publicaciones/nueva\\?juego=${game.slug}"`));
    assert.match(html, new RegExp(`href="${game.postPath}"`));
    if (game.slug === 'american-truck') {
      response = await request(game.postPath);
      html = await responseText(response);
      assert.equal(response.status, 200);
      assert.match(html, /data-rich-editor/);
      assert.match(html, /src="\/uploads\/[a-f\d-]{36}\.png"/);
      assert.match(html, /src="\/uploads\/[a-f\d-]{36}\.mp4"/);
      assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
      assert.doesNotMatch(html, /class="post-attachments"/,
        'Media included inline in rich content should not be rendered a second time.');
      assert.doesNotMatch(html, /window\.pwned|example\.test\/unsafe/);
    }
  }

  response = await request('/juegos/american-truck');
  html = await responseText(response);
  assert.match(html, /class="post-card-preview"/, 'The forum card should preview an attached image.');

  response = await request('/publicaciones/nueva?juego=american-truck');
  html = await responseText(response);
  response = await request('/publicaciones', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      game: 'american-truck',
      title: 'Publicación vacía inválida',
      content: '<p><br></p>'
    }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/publicaciones\/nueva\?juego=american-truck&error=/);

  const secondUser = `camionero2_${String(Date.now()).slice(-8)}`;
  const secondEmail = `${secondUser}@example.test`;
  response = await request('/registro', { session: 'secondary' });
  html = await responseText(response);
  response = await request('/registro', {
    method: 'POST',
    session: 'secondary',
    fields: {
      _csrf: tokenFrom(html),
      username: secondUser,
      email: secondEmail,
      password: 'TestPassword!123',
      confirm_password: 'TestPassword!123',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');

  response = await request('/login', { session: 'duplicate' });
  html = await responseText(response);
  response = await request('/login', {
    method: 'POST',
    session: 'duplicate',
    fields: {
      _csrf: tokenFrom(html),
      identity: firstUser,
      password: 'TestPassword!123'
    }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  response = await request('/api/miembros-en-linea');
  let onlineResult = await response.json();
  assert.equal(response.status, 200);
  assert.equal(onlineResult.members.length, 2, 'Multiple sessions for one account must not duplicate online members.');
  assert.deepEqual(new Set(onlineResult.members.map((member) => member.username)), new Set([firstUser, secondUser]));
  response = await request('/juegos/american-truck');
  html = await responseText(response);
  assert.equal((html.match(/data-online-user-id="/g) || []).length, 2);
  assert.match(html, /MIEMBROS EN LÍNEA/);
  testDb = new Database(databasePath);
  testDb.prepare('UPDATE sessions SET last_seen = ?').run(Date.now() - 6 * 60 * 1000);
  testDb.close();
  response = await request('/api/miembros-en-linea', { session: 'visitor' });
  onlineResult = await response.json();
  assert.deepEqual(onlineResult.members, [], 'Sessions inactive for more than five minutes must not be listed.');

  response = await request('/login', { session: 'visitor' });
  html = await responseText(response);
  const visitorToken = tokenFrom(html);
  response = await request(`${truckPost.postPath}/comentarios`, {
    method: 'POST',
    session: 'visitor',
    fields: { _csrf: visitorToken, content: '<p>Una respuesta sin sesión</p>' }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login/);
  response = await uploadMedia(visitorToken, {
    name: 'anonymous.png',
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  }, 'visitor');
  assert.equal(response.status, 302, 'Unauthenticated users must not upload media.');

  response = await request(truckPost.postPath, { session: 'secondary' });
  html = await responseText(response);
  const replyToken = tokenFrom(html);
  response = await uploadMedia(replyToken, {
    name: 'reply.png',
    mime: 'image/png',
    content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2cAAAAASUVORK5CYII=', 'base64')
  }, 'secondary');
  assert.equal(response.status, 201);
  const replyMedia = await response.json();
  response = await request(`${truckPost.postPath}/comentarios`, {
    method: 'POST',
    session: 'secondary',
    fields: {
      _csrf: replyToken,
      submission_key: '123e4567-e89b-42d3-a456-426614174000',
      content: `<p><strong>Respuesta de otro miembro</strong></p><figure><img src="${replyMedia.media[0].url}" alt="Captura de respuesta"></figure>`
    }
  });
  assert.equal(response.status, 302);
  response = await request(`${truckPost.postPath}/comentarios`, {
    method: 'POST',
    session: 'secondary',
    fields: {
      _csrf: replyToken,
      submission_key: '123e4567-e89b-42d3-a456-426614174000',
      content: `<p><strong>Respuesta duplicada</strong></p><figure><img src="${replyMedia.media[0].url}" alt="Captura de respuesta"></figure>`
    }
  });
  assert.equal(response.status, 302);
  response = await request(truckPost.postPath);
  html = await responseText(response);
  assert.match(html, /Respuesta de otro miembro/);
  assert.doesNotMatch(html, /Respuesta duplicada/);
  assert.ok(html.includes(secondUser));
  assert.match(html, /Captura de respuesta/);
  assert.doesNotMatch(html, /class="comment-attachments"/,
    'Inline reply media should not be duplicated below the reply.');
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  const storedReply = testDb.prepare(`
    SELECT comments.content, users.username,
      (SELECT COUNT(*) FROM attachments WHERE attachments.comment_id = comments.id) AS attachment_count
    FROM comments JOIN users ON users.id = comments.user_id
    WHERE comments.post_id = (SELECT id FROM posts WHERE title = ?)
  `).get(truckPost.title);
  assert.equal(storedReply.username, secondUser);
  assert.equal(storedReply.attachment_count, 1);
  testDb.close();
  response = await request(`/juegos/${truckPost.slug}`);
  html = await responseText(response);
  assert.match(html, /1 respuestas/);

  response = await request('/publicaciones/nueva');
  html = await responseText(response);
  assert.equal(response.status, 200);
  response = await request('/publicaciones', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      category_id: '1',
      title: '<script>alert(1)</script>',
      content: '<p style="text-align:center"><strong>Contenido para verificar</strong> <em><u>la publicación</u></em> y proteger los datos.</p><script>alert("xss")</script>'
    }
  });
  assert.equal(response.status, 302);
  const postPath = response.headers.get('location').split('?')[0];

  response = await request(postPath);
  html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, /<strong>Contenido para verificar<\/strong>/);
  assert.match(html, /<em><u>la publicación<\/u><\/em>/);
  assert.match(html, /text-align:center/);
  assert.doesNotMatch(html, /<script>alert\(1\)|alert\("xss"\)/);
  assert.match(html, /data-rich-editor/, 'Authenticated replies should use the rich editor.');
  response = await request(`${postPath}/comentarios`, {
    method: 'POST',
    fields: { _csrf: tokenFrom(html), content: '<p><u><b>Comentario seguro</b></u></p><script>alert("comment")</script>' }
  });
  assert.equal(response.status, 302);

  response = await request('/foros?categoria=1');
  html = await responseText(response);
  assert.ok(html.includes('1 respuestas'));
  assert.ok(html.includes('1 temas'));
  response = await request(postPath);
  html = await responseText(response);
  assert.match(html, /<u><b>Comentario seguro<\/b><\/u>/);
  assert.doesNotMatch(html, /alert\("comment"\)/);

  response = await request('/perfil/editar');
  html = await responseText(response);
  response = await request('/perfil/editar', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      bio: 'Perfil de prueba comunitario.',
      avatar: ''
    }
  });
  assert.equal(response.status, 302);
  response = await request(`/perfil/${firstUser}`);
  html = await responseText(response);
  assert.ok(html.includes('Perfil de prueba comunitario.'));
  assert.match(html, /Editar perfil/);

  const profileToken = tokenFrom(await (await request('/perfil/editar')).text());
  const validAvatar = {
    name: 'avatar.png',
    mime: 'image/png',
    content: fs.readFileSync(path.resolve(forumDirectory, '..', 'assets', 'img', 'logo-zona-gamers.png'))
  };
  response = await uploadAvatar(profileToken, validAvatar);
  assert.equal(response.status, 200);
  const avatarResult = await response.json();
  assert.match(avatarResult.avatar, /^\/uploads\/[a-f\d-]{36}\.jpg$/);
  const firstAvatarPath = path.join(uploadsPath, path.basename(avatarResult.avatar));
  response = await uploadAvatar(profileToken, { ...validAvatar, name: 'avatar-replacement.png' });
  assert.equal(response.status, 200);
  const replacementAvatar = await response.json();
  assert.notEqual(replacementAvatar.avatar, avatarResult.avatar);
  assert.equal(fs.existsSync(firstAvatarPath), false, 'Replacing an avatar should remove the old managed file.');
  const horizontalPhotoPath = path.resolve(forumDirectory, '..', 'assets', 'img', 'preview-zona-gamers.png');
  const horizontalPhoto = fs.readFileSync(horizontalPhotoPath);
  response = await previewAvatar(profileToken, {
    name: 'landscape.jpg',
    mime: 'image/jpeg',
    content: horizontalPhoto
  });
  assert.equal(response.status, 200, 'A real landscape image should be normalized for preview despite a misleading MIME and extension.');
  assert.match(response.headers.get('content-type'), /image\/jpeg/);
  const previewMetadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.ok(previewMetadata.width > previewMetadata.height, 'The landscape preview must preserve its orientation.');
  response = await uploadAvatar(profileToken, {
    name: 'landscape.jpg',
    mime: 'image/jpeg',
    content: horizontalPhoto
  });
  assert.equal(response.status, 200);
  const landscapeAvatar = await response.json();
  const savedLandscape = await fetch(`http://127.0.0.1:${port}${landscapeAvatar.avatar}`);
  assert.equal(savedLandscape.status, 200);
  const savedLandscapeMetadata = await sharp(Buffer.from(await savedLandscape.arrayBuffer())).metadata();
  assert.equal(savedLandscapeMetadata.width, 512);
  assert.equal(savedLandscapeMetadata.height, 512);
  const verticalPhoto = await sharp(horizontalPhoto).rotate(90).jpeg({ quality: 90 }).toBuffer();
  const squarePhoto = await sharp(horizontalPhoto)
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const jpegPhoto = await sharp(horizontalPhoto).jpeg({ quality: 90 }).toBuffer();
  for (const fixture of [
    { name: 'portrait.jpeg', mime: 'image/jpeg', content: verticalPhoto, expected: 'portrait' },
    { name: 'square.png', mime: 'image/png', content: squarePhoto, expected: 'square' },
    { name: 'landscape.jpeg', mime: 'image/jpeg', content: jpegPhoto, expected: 'landscape' }
  ]) {
    const sourceMetadata = await sharp(fixture.content).metadata();
    assert.equal(
      sourceMetadata.width === sourceMetadata.height ? 'square'
        : sourceMetadata.width > sourceMetadata.height ? 'landscape' : 'portrait',
      fixture.expected,
      `${fixture.name} must exercise its intended real image orientation.`
    );
    response = await previewAvatar(profileToken, fixture);
    assert.equal(response.status, 200, `${fixture.name} must be accepted by the preview endpoint.`);
    const previewImage = Buffer.from(await response.arrayBuffer());
    const normalizedPreview = await sharp(previewImage).metadata();
    assert.equal(normalizedPreview.format, 'jpeg');
    assert.equal(
      normalizedPreview.width === normalizedPreview.height ? 'square'
        : normalizedPreview.width > normalizedPreview.height ? 'landscape' : 'portrait',
      fixture.expected,
      `${fixture.name} preview must preserve the original orientation.`
    );

    response = await uploadAvatar(profileToken, fixture);
    assert.equal(response.status, 200, `${fixture.name} must be saved.`);
    const saved = await response.json();
    const stored = await fetch(`http://127.0.0.1:${port}${saved.avatar}`);
    assert.equal(stored.status, 200, `${fixture.name} must remain available after upload.`);
    const storedMetadata = await sharp(Buffer.from(await stored.arrayBuffer())).metadata();
    assert.deepEqual([storedMetadata.width, storedMetadata.height], [512, 512]);
  }
  response = await uploadAvatar(profileToken, {
    name: 'corrupt.jpeg',
    mime: 'application/octet-stream',
    content: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXAUUYf//Z', 'base64')
  });
  assert.equal(response.status, 400, 'A truncated JPEG must be rejected during image decoding.');
  assert.match((await response.json()).message, /Sharp no pudo leer la imagen/);
  assert.equal(fs.existsSync(path.join(uploadsPath, path.basename(replacementAvatar.avatar))), false);
  response = await uploadAvatar(profileToken, {
    name: 'avatar.svg',
    mime: 'image/svg+xml',
    content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  });
  assert.equal(response.status, 400, 'Avatar uploads must reject unsupported formats.');
  assert.match((await response.json()).message, /JPG, PNG, WebP, GIF o HEIC\/HEIF/);
  response = await uploadAvatar(profileToken, {
    name: 'invalid.png',
    mime: 'image/png',
    content: Buffer.from('not a PNG')
  });
  assert.equal(response.status, 400, 'Avatar uploads must reject invalid image signatures.');
  assert.match((await response.json()).message, /JPG, PNG, WebP, GIF o HEIC\/HEIF/);
  response = await uploadAvatar(profileToken, {
    name: 'oversized.jpg',
    mime: 'image/jpeg',
    content: Buffer.alloc(20 * 1024 * 1024 + 1)
  });
  assert.equal(response.status, 413, 'The original avatar upload must be limited to 20 MB.');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.doesNotMatch(serverOutput, /Unhandled error for POST \/perfil\/avatar/,
    'Expected avatar validation errors should be handled without a Multer stack trace.');
  response = await request('/perfil/avatar/eliminar', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: profileToken }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).avatar, null);
  assert.equal(fs.existsSync(path.join(uploadsPath, path.basename(landscapeAvatar.avatar))), false);

  const renamedUser = `renamed_${String(Date.now()).slice(-8)}`;
  response = await request('/perfil/cambiar-nombre', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: profileToken, username: renamedUser }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).username, renamedUser);
  response = await request('/perfil/cambiar-nombre', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: profileToken, username: `${renamedUser}_again` }
  });
  assert.equal(response.status, 409, 'A second name change must be rejected during the 15-day cooldown.');

  response = await request('/perfil/cambiar-correo', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: {
      _csrf: profileToken,
      email: `pending_${Date.now()}@example.test`,
      current_password: 'TestPassword!123'
    }
  });
  assert.equal(response.status, 202, 'Without a mail provider, the email must remain pending.');
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  assert.equal(testDb.prepare('SELECT email FROM users WHERE id = (SELECT id FROM users WHERE username = ?)').get(renamedUser).email, firstEmail);
  assert.equal(testDb.prepare(`
    SELECT status FROM email_change_requests
    WHERE user_id = (SELECT id FROM users WHERE username = ?)
    ORDER BY id DESC LIMIT 1
  `).get(renamedUser).status, 'awaiting_email_provider');
  testDb.close();

  const bcrypt = require('bcryptjs');
  testDb = new Database(databasePath);
  const firstUserId = testDb.prepare('SELECT id FROM users WHERE username = ?').get(renamedUser).id;
  const secondUserId = testDb.prepare('SELECT id FROM users WHERE username = ?').get(secondUser).id;
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUserId);
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', secondUserId);
  testDb.close();

  response = await request(`/perfil/${secondUser}`);
  html = await responseText(response);
  assert.match(html, /name="role"/, 'Admins should be able to manage roles from member profiles.');
  const roleToken = tokenFrom(html);
  response = await request(`/perfil/${secondUser}/rol`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: roleToken, role: 'moderator' }
  });
  assert.equal(response.status, 200);
  response = await request(`/perfil/${secondUser}`);
  html = await responseText(response);
  assert.match(html, /MODERATOR/);
  assert.match(html, /role-moderator/);
  testDb = new Database(databasePath);
  const moderatedCommentId = testDb.prepare(`
    SELECT id FROM comments WHERE post_id = (SELECT id FROM posts WHERE title = ?)
  `).get(truckPost.title).id;
  testDb.close();
  response = await request(truckPost.postPath, { session: 'secondary' });
  html = await responseText(response);
  response = await request(`${truckPost.postPath}/comentarios/${moderatedCommentId}/eliminar`, {
    method: 'POST',
    session: 'secondary',
    fields: { _csrf: tokenFrom(html) }
  });
  assert.equal(response.status, 302, 'Moderators should be allowed to remove community replies.');
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM comments WHERE id = ?')
    .get(moderatedCommentId).count, 0);
  testDb.close();

  for (const role of ['admin', 'ceo']) {
    response = await request(`/perfil/${secondUser}/rol`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      fields: { _csrf: tokenFrom(html), role }
    });
    assert.equal(response.status, 403, `Admins must not assign the ${role} role.`);
  }
  response = await request(`/perfil/${renamedUser}/rol`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: 'user' }
  });
  assert.equal(response.status, 403, 'An admin must not change their own role.');

  testDb = new Database(databasePath);
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('ceo', secondUserId);
  testDb.close();
  response = await request(`/perfil/${secondUser}/rol`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: 'user' }
  });
  assert.equal(response.status, 403, 'Admins must not modify or demote the CEO.');
  testDb = new Database(databasePath);
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('moderator', secondUserId);
  testDb.close();

  const moderationPostTitle = `Moderation target ${Date.now()}`;
  response = await request('/publicaciones/nueva?juego=american-truck');
  html = await responseText(response);
  response = await request('/publicaciones', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      game: 'american-truck',
      category_id: '1',
      title: moderationPostTitle,
      content: '<p>Contenido para probar moderación.</p>'
    }
  });
  const moderationPostPath = response.headers.get('location').split('?')[0];
  const moderationPostId = moderationPostPath.split('/').pop();
  response = await request(moderationPostPath, { session: 'secondary' });
  html = await responseText(response);
  response = await request(`${moderationPostPath}/eliminar`, {
    method: 'POST',
    session: 'secondary',
    fields: { _csrf: tokenFrom(html) }
  });
  assert.equal(response.status, 302, 'Moderators should be allowed to remove community posts.');

  response = await request(`/perfil/${secondUser}/rol`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(await (await request(`/perfil/${secondUser}`)).text()), role: 'support' }
  });
  assert.equal(response.status, 200);
  onlineResult = await (await request('/api/miembros-en-linea')).json();
  assert.equal(onlineResult.members.find((member) => member.username === secondUser).role, 'support');
  testDb = new Database(databasePath);
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', firstUserId);
  testDb.close();
  const supportModerationTitle = `Support restriction ${Date.now()}`;
  response = await request('/publicaciones/nueva?juego=american-truck');
  html = await responseText(response);
  response = await request('/publicaciones', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      game: 'american-truck',
      category_id: '1',
      title: supportModerationTitle,
      content: '<p>Contenido para comprobar permisos de soporte.</p>'
    }
  });
  const supportPostPath = response.headers.get('location').split('?')[0];
  response = await request(supportPostPath, { session: 'secondary' });
  html = await responseText(response);
  response = await request(`${supportPostPath}/eliminar`, {
    method: 'POST',
    session: 'secondary',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html) }
  });
  assert.equal(response.status, 403, 'Support members must not moderate posts.');
  response = await request(`/perfil/${renamedUser}/rol`, {
    method: 'POST',
    session: 'secondary',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: 'admin' }
  });
  assert.equal(response.status, 403, 'Support members must not assign roles.');
  testDb = new Database(databasePath);
  testDb.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUserId);
  testDb.close();

  const ceoUser = `ceo_${String(Date.now()).slice(-8)}`;
  response = await request('/registro', { session: 'ceo' });
  html = await responseText(response);
  response = await request('/registro', {
    method: 'POST',
    session: 'ceo',
    fields: {
      _csrf: tokenFrom(html),
      username: ceoUser,
      email: `${ceoUser}@example.test`,
      password: 'TestPassword!123',
      confirm_password: 'TestPassword!123',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  testDb = new Database(databasePath);
  testDb.prepare('UPDATE users SET role = ? WHERE username = ?').run('ceo', ceoUser);
  testDb.close();
  response = await request(`/perfil/${ceoUser}`, { session: 'ceo' });
  html = await responseText(response);
  assert.match(html, /CEO/);
  response = await request(`/perfil/${secondUser}/rol`, {
    method: 'POST',
    session: 'ceo',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: 'admin' }
  });
  assert.equal(response.status, 200, 'The CEO should be able to assign Admin.');
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  assert.equal(testDb.prepare(`
    SELECT COUNT(*) AS count FROM role_change_audit
    WHERE actor_user_id = (SELECT id FROM users WHERE username = ?)
      AND target_user_id = ? AND previous_role = 'support' AND new_role = 'admin'
  `).get(ceoUser, secondUserId).count, 1, 'Role changes should be written to the audit history.');
  testDb.close();
  response = await request(`/perfil/${ceoUser}/rol`, {
    method: 'POST',
    session: 'ceo',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: 'admin' }
  });
  assert.equal(response.status, 403, 'Even the CEO must not assign a role to themself.');
  response = await request(`/perfil/${secondUser}/rol`, {
    method: 'POST',
    session: 'ceo',
    headers: { Accept: 'application/json' },
    fields: { _csrf: tokenFrom(html), role: '__proto__' }
  });
  assert.equal(response.status, 403, 'Only defined role names should be accepted.');

  testDb = new Database(databasePath);
  const secondSessionForFirstUser = testDb.prepare('SELECT sid, sess FROM sessions').all()
    .find((session) => JSON.parse(session.sess).user?.id === firstUserId);
  assert.ok(secondSessionForFirstUser, 'The duplicate login should still be active before password rotation.');
  testDb.close();
  response = await request('/perfil/cambiar-contrasena', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    fields: {
      _csrf: profileToken,
      current_password: 'TestPassword!123',
      password: 'NewPassword!321',
      confirm_password: 'NewPassword!321'
    }
  });
  assert.equal(response.status, 200);
  testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  const changedPasswordHash = testDb.prepare('SELECT password FROM users WHERE id = ?').get(firstUserId).password;
  assert.ok(bcrypt.compareSync('NewPassword!321', changedPasswordHash));
  assert.equal(testDb.prepare('SELECT sid, sess FROM sessions').all()
    .filter((session) => JSON.parse(session.sess).user?.id === firstUserId).length, 1,
  'Password rotation should retain the current session and revoke other sessions for the account.');
  testDb.close();
  response = await request('/perfil/editar', { session: 'duplicate' });
  assert.equal(response.status, 302, 'Password rotation must invalidate other sessions for this account.');

  response = await request('/perfil/editar');
  html = await responseText(response);
  response = await request(`/perfil/${firstUser}/editar`, { method: 'POST', fields: { _csrf: tokenFrom(html), bio: 'No permitido' } });
  assert.equal(response.status, 404, 'There must not be a route to edit another user by profile ID.');
  response = await request('/does-not-exist');
  assert.equal(response.status, 404);
  assert.match(await responseText(response), /Página no encontrada/);

  response = await request('/', { method: 'GET' });
  html = await responseText(response);
  response = await request('/logout', { method: 'POST', fields: { _csrf: tokenFrom(html) } });
  assert.equal(response.status, 302);
  response = await request('/publicaciones/nueva');
  assert.equal(response.status, 302, 'Logout must revoke the authenticated session.');
});
