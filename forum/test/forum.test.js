const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const forumDirectory = path.resolve(__dirname, '..');
let temporaryDirectory;
let databasePath;
let port;
let server;
let serverOutput = '';
let cookie = '';

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

async function request(url, { method = 'GET', fields, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
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
  if (sessionCookie) cookie = sessionCookie.split(';')[0].replace(/^zona\.sid=$/, '');
  return response;
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
  port = await listenOnAvailablePort();
  await startServer();
});

after(async () => {
  await stopServer();
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
  assert.match(html, /href="\/login">Iniciar sesión<\/a>/);
  assert.match(html, /href="\/registro">Registrarse<\/a>/);
  assert.doesNotMatch(html, /class="nav-user"/);
  assert.doesNotMatch(html, /class="nav-logout"/);
  assert.doesNotMatch(html, /ReferenceError|currentUser is not defined|pageTitle is not defined/);
});

test('forum pages, authentication, sessions, posts, comments, and profiles work end to end', async () => {
  let response = await request('/');
  let html = await responseText(response);
  assert.equal(response.status, 200);
  assert.match(html, /<title>Inicio \| ZONA GAMERS<\/title>/);
  assert.match(html, />0<\/strong>\s*<span>miembros<\/span>/);
  assert.match(html, />0<\/strong>\s*<span>publicaciones<\/span>/);

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
  }

  response = await request('/foros');
  html = await responseText(response);
  const categoryNames = [
    'American Truck Simulator', 'Euro Truck Simulator 2', 'Mods y modificaciones',
    'Camiones y configuraciones', 'Convoyes y multijugador', 'Soporte técnico',
    'Noticias y anuncios', 'Comunidad y conversaciones generales'
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
      password: 'TestPassword!123',
      confirm_password: 'TestPassword!123',
      accept_rules: 'on'
    }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login\?/);

  const Database = require('better-sqlite3');
  let testDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  const storedPassword = testDb.prepare('SELECT password FROM users WHERE username = ?').get(firstUser).password;
  assert.notEqual(storedPassword, 'TestPassword!123');
  assert.ok(require('bcryptjs').compareSync('TestPassword!123', storedPassword));
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 8);
  testDb.close();

  response = await request('/login');
  html = await responseText(response);
  response = await request('/login', {
    method: 'POST',
    fields: { _csrf: tokenFrom(html), identity: firstUser, password: 'TestPassword!123' }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/\?mensaje=/);
  response = await request('/');
  html = await responseText(response);
  assert.match(html, new RegExp(`>${firstUser}<`));
  assert.match(html, /<form class="nav-logout" action="\/logout" method="post">/);

  await stopServer();
  await startServer();
  response = await request(`/perfil/${firstUser}`);
  html = await responseText(response);
  assert.equal(response.status, 200, 'A saved session should survive a server restart.');
  assert.ok(html.includes(firstUser));
  assert.ok(!html.includes(firstEmail), 'A public profile must not expose the member email.');

  response = await request('/publicaciones/nueva');
  html = await responseText(response);
  assert.equal(response.status, 200);
  response = await request('/publicaciones', {
    method: 'POST',
    fields: {
      _csrf: tokenFrom(html),
      category_id: '1',
      title: '<script>alert(1)</script>',
      content: 'Contenido para verificar la publicación y proteger los datos.'
    }
  });
  assert.equal(response.status, 302);
  const postPath = response.headers.get('location').split('?')[0];

  response = await request(postPath);
  html = await responseText(response);
  assert.equal(response.status, 200);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  response = await request(`${postPath}/comentarios`, {
    method: 'POST',
    fields: { _csrf: tokenFrom(html), content: '<b>Comentario seguro</b>' }
  });
  assert.equal(response.status, 302);

  response = await request('/foros?categoria=1');
  html = await responseText(response);
  assert.ok(html.includes('1 respuestas'));
  assert.ok(html.includes('1 temas'));
  response = await request(postPath);
  html = await responseText(response);
  assert.ok(html.includes('&lt;b&gt;Comentario seguro&lt;/b&gt;'));

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
