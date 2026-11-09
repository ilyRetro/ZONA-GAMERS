const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');

document.querySelectorAll('[data-online-members]').forEach((panel) => {
  const list = panel.querySelector('[data-online-list]');
  const emptyState = panel.querySelector('[data-online-empty]');
  const status = panel.querySelector('[data-online-status]');
  const roleLabels = { ceo: 'CEO', admin: 'ADMIN', moderator: 'MODERATOR', support: 'SOPORTE', user: 'MIEMBRO' };
  const renderMembers = (members) => {
    const items = members.map((member) => {
      const item = document.createElement('li');
      item.className = 'online-member';
      item.dataset.onlineUserId = String(member.id);
      const link = document.createElement('a');
      link.href = `/perfil/${encodeURIComponent(member.username)}`;
      if (member.avatar) {
        const avatar = document.createElement('img');
        avatar.className = 'avatar avatar-small';
        avatar.src = member.avatar;
        avatar.alt = '';
        link.append(avatar);
      } else {
        const avatar = document.createElement('span');
        avatar.className = 'avatar avatar-small avatar-initial';
        avatar.textContent = member.username.slice(0, 1).toUpperCase();
        link.append(avatar);
      }
      const name = document.createElement('span');
      name.className = 'online-member-name';
      name.textContent = member.username;
      const role = roleLabels[member.role] ? member.role : 'user';
      const badge = document.createElement('span');
      badge.className = `role-badge role-${role}`;
      badge.textContent = roleLabels[role];
      const indicator = document.createElement('span');
      indicator.className = 'online-member-dot';
      indicator.setAttribute('aria-label', 'En línea');
      link.append(name, badge, indicator);
      item.append(link);
      return item;
    });
    list.replaceChildren(...items);
    emptyState.hidden = items.length > 0;
  };
  const refreshMembers = async () => {
    try {
      const response = await fetch('/api/miembros-en-linea', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Online-members request returned HTTP ${response.status}.`);
      const result = await response.json();
      if (!Array.isArray(result.members)) throw new Error('Online-members response is invalid.');
      renderMembers(result.members);
      status.hidden = true;
      status.textContent = '';
    } catch (error) {
      console.error('Unable to refresh online members:', error);
      status.textContent = 'No se pudo actualizar la lista de miembros en línea.';
      status.hidden = false;
    }
  };
  refreshMembers();
  window.setInterval(refreshMembers, 30 * 1000);
});

if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!expanded));
    mainNav.classList.toggle('is-open', !expanded);
  });
}

document.querySelectorAll('.password-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const input = toggle.parentElement.querySelector('input');
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    toggle.textContent = showPassword ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-label', showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
    toggle.setAttribute('aria-pressed', String(showPassword));
  });
});

document.querySelectorAll('[data-auth-form]').forEach((form) => {
  const password = form.elements.password;
  const confirmation = form.elements.confirm_password;
  if (password && confirmation) {
    const validateConfirmation = () => {
      confirmation.setCustomValidity(
        confirmation.value && confirmation.value !== password.value
          ? 'Las contraseñas no coinciden.'
          : ''
      );
    };
    password.addEventListener('input', validateConfirmation);
    confirmation.addEventListener('input', validateConfirmation);
  }

  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = true;
    button.classList.add('is-loading');
    const label = button.querySelector('.submit-label');
    if (label) {
      button.dataset.defaultLabel = label.textContent;
      label.textContent = 'Comprobando…';
    }
  });
});

const discordStats = document.querySelector('[data-discord-stats]');
if (discordStats) {
  const members = discordStats.querySelector('[data-discord-members]');
  const online = discordStats.querySelector('[data-discord-online]');
  const status = discordStats.querySelector('[data-discord-status]');
  const serverIcon = document.querySelector('[data-discord-icon]');
  const refreshDiscordStats = async () => {
    try {
      const response = await fetch('/api/discord/stats', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Discord statistics request returned HTTP ${response.status}.`);
      const stats = await response.json();
      if (stats.icon && serverIcon && serverIcon.dataset.source !== stats.icon) {
        serverIcon.dataset.source = stats.icon;
        serverIcon.addEventListener('load', () => {
          serverIcon.hidden = false;
        }, { once: true });
        serverIcon.addEventListener('error', () => {
          serverIcon.hidden = true;
        }, { once: true });
        serverIcon.src = stats.icon;
      }
      if (!stats.available || !Number.isSafeInteger(stats.members) || !Number.isSafeInteger(stats.online)) {
        members.textContent = '—';
        online.textContent = '—';
        status.textContent = 'Estadísticas temporalmente no disponibles';
        return;
      }
      members.textContent = stats.members.toLocaleString('es');
      online.textContent = stats.online.toLocaleString('es');
      status.textContent = 'Datos aproximados de Discord';
    } catch {
      members.textContent = '—';
      online.textContent = '—';
      status.textContent = 'Estadísticas temporalmente no disponibles';
    }
  };
  refreshDiscordStats();
  window.setInterval(refreshDiscordStats, 60 * 1000);
}

window.addEventListener('pageshow', () => {
  document.querySelectorAll('[data-auth-form] button[type="submit"]').forEach((button) => {
    button.disabled = false;
    button.classList.remove('is-loading');
    const label = button.querySelector('.submit-label');
    if (label && button.dataset.defaultLabel) label.textContent = button.dataset.defaultLabel;
  });
});

document.querySelectorAll('[data-rich-editor]').forEach((editorShell) => {
  const canvas = editorShell.querySelector('[data-editor-canvas]');
  const contentInput = editorShell.querySelector('[data-editor-content]');
  const status = editorShell.querySelector('[data-editor-status]');
  const form = editorShell.closest('form');
  const csrfInput = form?.querySelector('input[name="_csrf"]');
  const imageInput = editorShell.querySelector('[data-image-input]');
  const videoInput = editorShell.querySelector('[data-video-input]');
  const attachmentField = editorShell.querySelector('[data-editor-attachments]');
  const attachmentTray = editorShell.querySelector('[data-attachment-tray]');
  const attachmentList = editorShell.querySelector('[data-attachment-list]');
  const commandTags = {
    bold: ['B', 'STRONG'],
    italic: ['I', 'EM'],
    underline: ['U'],
    strikeThrough: ['S', 'DEL', 'STRIKE']
  };
  let savedRange = null;
  const selectedMedia = new Map();

  const report = (message) => {
    status.textContent = message;
  };
  const closestTag = (node, tags) => {
    let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (element && element !== canvas) {
      if (tags.includes(element.tagName)) return element;
      element = element.parentElement;
    }
    return null;
  };
  const toColorInputValue = (color) => {
    const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) return `#${rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
    return /^#[a-f\d]{6}$/i.test(color) ? color : '#f5f7fb';
  };
  const updateToolbarState = () => {
    const selection = window.getSelection();
    const selectionIsInside = selection?.anchorNode && canvas.contains(selection.anchorNode);
    editorShell.querySelectorAll('[data-command]').forEach((button) => {
      const command = button.dataset.command;
      let active = false;
      if (selectionIsInside && commandTags[command]) {
        active = Boolean(closestTag(selection.anchorNode, commandTags[command]));
      } else if (selectionIsInside && command.startsWith('insert')) {
        const tag = command === 'insertUnorderedList' ? 'UL' : 'OL';
        active = Boolean(closestTag(selection.anchorNode, [tag]));
      } else if (selectionIsInside && command.startsWith('justify')) {
        const block = closestTag(selection.anchorNode, ['P', 'DIV', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'LI']);
        const alignment = block ? getComputedStyle(block).textAlign : 'left';
        active = command === 'justifyLeft'
          ? alignment === 'left' || alignment === 'start'
          : command === 'justifyFull'
            ? alignment === 'justify'
            : alignment === command.replace('justify', '').toLowerCase();
      }
      button.setAttribute('aria-pressed', String(active));
    });

    if (!selectionIsInside) return;
    const block = closestTag(selection.anchorNode, ['P', 'DIV', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
    const blockFormat = editorShell.querySelector('[data-block-format]');
    if (block && [...blockFormat.options].some((option) => option.value === block.tagName.toLowerCase())) {
      blockFormat.value = block.tagName.toLowerCase();
    } else {
      blockFormat.value = 'p';
    }
    blockFormat.dataset.active = String(blockFormat.value !== 'p');

    const span = closestTag(selection.anchorNode, ['SPAN']);
    const fontSize = span?.style.fontSize;
    const fontSizeSelect = editorShell.querySelector('[data-font-size]');
    fontSizeSelect.dataset.active = String(Boolean(fontSize));
    if (fontSize && [...fontSizeSelect.options].some((option) => option.value === fontSize)) {
      fontSizeSelect.value = fontSize;
    } else {
      fontSizeSelect.value = '16px';
    }
    const colorInput = editorShell.querySelector('[data-text-color]');
    colorInput.dataset.active = String(Boolean(span?.style.color));
    colorInput.value = toColorInputValue(span?.style.color || '#f5f7fb');
  };
  const syncContent = () => {
    contentInput.value = canvas.innerHTML;
  };
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && canvas.contains(selection.anchorNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
    updateToolbarState();
  };
  const restoreSelection = () => {
    canvas.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  };
  const insertNode = (node) => {
    restoreSelection();
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
    if (!selection.rangeCount) {
      range.selectNodeContents(canvas);
      range.collapse(false);
    }
    if (!range.collapsed) range.collapse(false);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    syncContent();
    saveSelection();
  };
  const createInlineMedia = (media, name) => {
    if (media.kind === 'image') {
      const image = document.createElement('img');
      image.src = media.url;
      image.alt = name;
      image.dataset.editorMedia = media.url;
      return image;
    }
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.dataset.editorMedia = media.url;
    const source = document.createElement('source');
    source.src = media.url;
    source.type = media.mime;
    video.append(source);
    return video;
  };
  const applyInlineStyle = (property, value) => {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) {
      report('Selecciona el texto que quieres formatear.');
      return;
    }
    const range = selection.getRangeAt(0);
    const wrapper = document.createElement('span');
    wrapper.style[property] = value;
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    syncContent();
  };
  const normalizeLink = (value) => {
    if (!value.trim()) throw new Error('Empty link.');
    const url = new URL(value.trim(), window.location.origin);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      throw new Error('Unsupported link protocol.');
    }
    return url.href;
  };
  const videoEmbedUrl = (value) => {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^www\./, '');
    const youtubeId = host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? url.searchParams.get('v') || url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/)?.[1]
        : null;
    const vimeoId = host === 'vimeo.com'
      ? url.pathname.match(/^\/(\d+)$/)?.[1]
      : host === 'player.vimeo.com'
        ? url.pathname.match(/^\/video\/(\d+)$/)?.[1]
        : null;
    if (youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
    }
    if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    throw new Error('Unsupported video URL.');
  };
  const renderAttachments = () => {
    attachmentField.value = JSON.stringify([...selectedMedia.keys()]);
    attachmentTray.hidden = selectedMedia.size === 0;
    const previewItems = [...selectedMedia.entries()].map(([url, media]) => {
      const item = document.createElement('figure');
      item.className = 'editor-attachment';
      if (media.kind === 'image') {
        const image = document.createElement('img');
        image.src = url;
        image.alt = media.name;
        item.append(image);
      } else {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        const source = document.createElement('source');
        source.src = url;
        source.type = media.mime;
        video.append(source);
        item.append(video);
      }
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'editor-attachment-remove';
      removeButton.textContent = 'Quitar';
      removeButton.setAttribute('aria-label', `Quitar ${media.name}`);
      removeButton.addEventListener('click', async () => {
        removeButton.disabled = true;
        try {
          const response = await fetch('/publicaciones/medios/eliminar', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfInput.value
            },
            body: JSON.stringify({ path: url })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'No se pudo quitar el archivo adjunto.');
          selectedMedia.delete(url);
          canvas.querySelectorAll('[data-editor-media]').forEach((inlineMedia) => {
            if (inlineMedia.dataset.editorMedia === url) inlineMedia.remove();
          });
          syncContent();
          renderAttachments();
          saveSelection();
          report(result.message);
        } catch (error) {
          removeButton.disabled = false;
          report(error.message);
        }
      });
      item.append(removeButton);
      return item;
    });
    attachmentList.replaceChildren(...previewItems);
  };
  const connectUrlDialog = ({ button, dialog, input, normalize, insert, errorMessage, successMessage }) => {
    const submitButton = dialog.querySelector('[data-dialog-submit]');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      saveSelection();
      input.value = '';
      dialog.returnValue = '';
      dialog.showModal();
      input.focus();
    });
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close('cancel'));
    const insertFromDialog = () => {
      try {
        dialog.dataset.normalizedUrl = normalize(input.value);
        dialog.close('insert');
      } catch {
        report(errorMessage);
        input.focus();
      }
    };
    submitButton.addEventListener('click', insertFromDialog);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        insertFromDialog();
      }
    });
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'insert') return;
      restoreSelection();
      insert(dialog.dataset.normalizedUrl);
      syncContent();
      saveSelection();
      updateToolbarState();
      report(successMessage);
    });
  };

  canvas.addEventListener('input', () => {
    saveSelection();
    report('');
  });
  canvas.addEventListener('keyup', saveSelection);
  canvas.addEventListener('mouseup', saveSelection);
  document.addEventListener('selectionchange', () => {
    if (window.getSelection()?.anchorNode && canvas.contains(window.getSelection().anchorNode)) {
      saveSelection();
    } else {
      updateToolbarState();
    }
  });
  editorShell.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      restoreSelection();
      document.execCommand(button.dataset.command, false);
      syncContent();
      saveSelection();
      updateToolbarState();
    });
  });
  editorShell.querySelector('[data-block-format]').addEventListener('change', (event) => {
    restoreSelection();
    document.execCommand('formatBlock', false, event.target.value);
    syncContent();
    saveSelection();
    updateToolbarState();
  });
  editorShell.querySelector('[data-font-size]').addEventListener('change', (event) => {
    applyInlineStyle('fontSize', event.target.value);
  });
  editorShell.querySelector('[data-text-color]').addEventListener('input', (event) => {
    applyInlineStyle('color', event.target.value);
  });
  connectUrlDialog({
    button: editorShell.querySelector('[data-insert-link]'),
    dialog: editorShell.querySelector('[data-link-dialog]'),
    input: editorShell.querySelector('[data-link-dialog-input]'),
    normalize: normalizeLink,
    insert: (href) => {
      const selection = window.getSelection();
      if (selection.rangeCount && !selection.isCollapsed) {
        document.execCommand('createLink', false, href);
      } else {
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.textContent = href;
        insertNode(anchor);
      }
    },
    errorMessage: 'Introduce un enlace HTTP, HTTPS o de correo válido.',
    successMessage: 'Enlace insertado.'
  });
  editorShell.querySelectorAll('[data-upload-image], [data-upload-video]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  });
  editorShell.querySelector('[data-upload-image]').addEventListener('click', () => {
    saveSelection();
    imageInput.click();
  });
  editorShell.querySelector('[data-upload-video]').addEventListener('click', () => {
    saveSelection();
    videoInput.click();
  });

  const uploadFiles = async (input) => {
    const files = Array.from(input.files);
    if (!files.length) return;
    const body = new FormData();
    files.forEach((file) => body.append('media', file));
    report(`Subiendo ${files.length === 1 ? 'archivo' : `${files.length} archivos`}…`);
    try {
      const response = await fetch('/publicaciones/medios', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': csrfInput.value
        },
        body
      });
      if (response.redirected) throw new Error('Tu sesión terminó. Inicia sesión para adjuntar archivos.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo subir el archivo.');
      if (!Array.isArray(result.media) || result.media.length !== files.length) {
        throw new Error('El servidor no pudo completar la subida de todos los archivos.');
      }

      if (selectedMedia.size + result.media.length > 5) {
        await Promise.all(result.media.map((media) => fetch('/publicaciones/medios/eliminar', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfInput.value
          },
          body: JSON.stringify({ path: media.url })
        })));
        throw new Error('Puedes adjuntar hasta cinco archivos por publicación o respuesta.');
      }
      result.media.forEach((media, index) => {
        selectedMedia.set(media.url, { ...media, name: files[index].name });
        insertNode(createInlineMedia(media, files[index].name));
      });
      renderAttachments();
      report(`${files.length === 1 ? 'Archivo adjuntado' : 'Archivos adjuntados'}.`);
    } catch (error) {
      report(error.message);
    } finally {
      input.value = '';
    }
  };
  imageInput.addEventListener('change', () => uploadFiles(imageInput));
  videoInput.addEventListener('change', () => uploadFiles(videoInput));

  connectUrlDialog({
    button: editorShell.querySelector('[data-insert-video-link]'),
    dialog: editorShell.querySelector('[data-video-dialog]'),
    input: editorShell.querySelector('[data-video-dialog-input]'),
    normalize: videoEmbedUrl,
    insert: (embedUrl) => {
      const frame = document.createElement('iframe');
      frame.src = embedUrl;
      frame.title = 'Video insertado';
      frame.width = '560';
      frame.height = '315';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      frame.allowFullscreen = true;
      insertNode(frame);
    },
    errorMessage: 'Solo se admiten enlaces de YouTube o Vimeo válidos.',
    successMessage: 'Video insertado.'
  });

  if (form && form.matches('[data-editor-form], .reply-form')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      if (form.dataset.submitting === 'true') return;
      while (canvas.lastElementChild) {
        const trailingBlock = canvas.lastElementChild;
        const isTextBlock = ['P', 'DIV'].includes(trailingBlock.tagName);
        const hasMedia = trailingBlock.querySelector('img, video, iframe');
        if (!isTextBlock || trailingBlock.textContent.trim() || hasMedia) break;
        trailingBlock.remove();
      }
      syncContent();
      const text = canvas.innerText.trim();
      const hasMedia = selectedMedia.size > 0
        || canvas.querySelector('img[src^="/uploads/"], video source[src^="/uploads/"], iframe[src]');
      const minimumTextLength = form.classList.contains('reply-form') ? 2 : 10;
      if (text.length < minimumTextLength && !hasMedia) {
        report(`Escribe al menos ${minimumTextLength} caracteres o adjunta una imagen o video.`);
        canvas.focus();
        return;
      }
      let submissionKey = form.querySelector('[name="submission_key"]');
      if (form.classList.contains('reply-form') && !submissionKey) {
        submissionKey = document.createElement('input');
        submissionKey.type = 'hidden';
        submissionKey.name = 'submission_key';
        form.append(submissionKey);
      }
      if (submissionKey && !submissionKey.value) submissionKey.value = crypto.randomUUID();

      form.dataset.submitting = 'true';
      if (submitButton) submitButton.disabled = true;
      report('Enviando…');
      try {
        const response = await fetch(form.action, {
          method: form.method || 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRF-Token': csrfInput.value
          },
          body: new URLSearchParams(new FormData(form))
        });
        if (response.redirected) {
          window.location.assign(response.url);
          return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar el contenido.');
        if (!result.redirect) throw new Error('El servidor no devolvió la página de destino.');
        window.location.assign(result.redirect);
      } catch (error) {
        form.dataset.submitting = 'false';
        if (submitButton) submitButton.disabled = false;
        report(error.message);
        canvas.focus();
      }
    });
  }
});

document.querySelectorAll('[data-async-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = form.querySelector('.form-feedback');
    const button = form.querySelector('button[type="submit"]');
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = 'Guardando…';
    try {
      const response = await fetch(form.action, {
        method: form.method || 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRF-Token': form.querySelector('[name="_csrf"]')?.value || ''
        },
        body: new URLSearchParams(new FormData(form))
      });
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar el cambio.');
      if (feedback) feedback.textContent = result.message;
      if (result.username) {
        const name = form.querySelector('[name="username"]');
        if (name) name.value = result.username;
      }
      if (result.redirect) {
        window.location.assign(result.redirect);
        return;
      }
      if (form.matches('.role-management-form')) window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    } finally {
      form.dataset.submitting = 'false';
      if (button) button.disabled = false;
    }
  });
});

const avatarForm = document.querySelector('[data-avatar-form]');
if (avatarForm) {
  const fileInput = avatarForm.querySelector('[data-avatar-input]');
  const feedback = avatarForm.querySelector('.form-feedback');
  const saveButton = avatarForm.querySelector('[data-avatar-save]');
  const modal = document.querySelector('[data-avatar-crop-modal]');
  const stage = modal.querySelector('[data-avatar-crop-stage]');
  const cropImage = modal.querySelector('[data-avatar-crop-image]');
  const cropPreview = modal.querySelector('[data-avatar-crop-preview]');
  const zoomControl = modal.querySelector('[data-avatar-crop-zoom]');
  const confirmCropButton = modal.querySelector('[data-avatar-crop-confirm]');
  const cropCancelButtons = modal.querySelectorAll('[data-avatar-crop-cancel]');
  const zoomInButton = modal.querySelector('[data-avatar-zoom-in]');
  const zoomOutButton = modal.querySelector('[data-avatar-zoom-out]');
  const maxAvatarBytes = 20 * 1024 * 1024;
  let sourceImage = null;
  let sourceObjectUrl = null;
  let previewObjectUrl = null;
  let croppedAvatar = null;
  let fitScale = 1;
  let scale = 1;
  let imageLeft = 0;
  let imageTop = 0;
  let pointerStart = null;
  let avatarSelectionId = 0;
  let savedAvatarUrl = document.querySelector('[data-avatar-preview]')?.getAttribute('src') || null;

  const updatePreview = (source) => {
    const image = document.createElement('img');
    image.className = 'avatar avatar-profile';
    image.alt = 'Vista previa del avatar';
    image.dataset.avatarPreview = '';
    image.src = source;
    document.querySelector('[data-avatar-preview]')?.replaceWith(image);
  };
  const updateNavigationAvatar = (source) => {
    const current = document.querySelector('[data-nav-avatar]');
    if (!current) return;
    if (source) {
      const image = document.createElement('img');
      image.className = 'avatar avatar-small';
      image.alt = '';
      image.dataset.navAvatar = '';
      image.src = source;
      current.replaceWith(image);
      return;
    }
    const fallback = document.createElement('span');
    fallback.className = 'avatar avatar-small avatar-initial';
    fallback.dataset.navAvatar = '';
    fallback.textContent = document.querySelector('.nav-user > span:last-child')?.textContent.trim().slice(0, 1).toUpperCase() || '?';
    current.replaceWith(fallback);
  };
  const cropBounds = () => {
    const bounds = stage.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  };
  const clampImage = () => {
    const { width, height } = cropBounds();
    imageLeft = Math.min(0, Math.max(width - sourceImage.naturalWidth * scale, imageLeft));
    imageTop = Math.min(0, Math.max(height - sourceImage.naturalHeight * scale, imageTop));
  };
  const drawCropPreview = () => {
    if (!sourceImage) return;
    const { width, height } = cropBounds();
    const context = cropPreview.getContext('2d');
    context.clearRect(0, 0, cropPreview.width, cropPreview.height);
    context.drawImage(
      sourceImage,
      -imageLeft / scale,
      -imageTop / scale,
      width / scale,
      height / scale,
      0,
      0,
      cropPreview.width,
      cropPreview.height
    );
  };
  const renderCrop = () => {
    if (!sourceImage) return;
    clampImage();
    cropImage.style.width = `${sourceImage.naturalWidth * scale}px`;
    cropImage.style.height = `${sourceImage.naturalHeight * scale}px`;
    cropImage.style.left = `${imageLeft}px`;
    cropImage.style.top = `${imageTop}px`;
    drawCropPreview();
  };
  const centerCrop = () => {
    const { width, height } = cropBounds();
    fitScale = Math.max(width / sourceImage.naturalWidth, height / sourceImage.naturalHeight);
    scale = fitScale * Number(zoomControl.value);
    imageLeft = (width - sourceImage.naturalWidth * scale) / 2;
    imageTop = (height - sourceImage.naturalHeight * scale) / 2;
    renderCrop();
  };
  const closeCrop = (cancelled) => {
    avatarSelectionId += 1;
    modal.hidden = true;
    sourceImage = null;
    cropImage.removeAttribute('src');
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = null;
    fileInput.value = '';
    if (cancelled) {
      croppedAvatar = null;
      saveButton.disabled = true;
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
      if (savedAvatarUrl) updatePreview(savedAvatarUrl);
      else {
        const fallback = document.createElement('span');
        fallback.className = 'avatar avatar-profile avatar-initial';
        fallback.dataset.avatarPreview = '';
        fallback.textContent = document.querySelector('.profile-settings-heading h1').textContent.trim().slice(0, 1).toUpperCase();
        document.querySelector('[data-avatar-preview]')?.replaceWith(fallback);
      }
    }
  };
  const encodeCrop = async () => {
    const { width, height } = cropBounds();
    const sourceX = -imageLeft / scale;
    const sourceY = -imageTop / scale;
    const sourceSize = Math.min(width, height) / scale;
    for (const [size, quality] of [[512, 0.86], [512, 0.72], [384, 0.68], [256, 0.62]]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(
        sourceImage,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        size,
        size
      );
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxAvatarBytes) return blob;
    }
    throw new Error('No se pudo optimizar el avatar dentro del límite de 20 MB.');
  };
  const responseErrorMessage = async (response, operation) => {
    const body = await response.text();
    try {
      const result = JSON.parse(body);
      if (result.message || result.error) return result.message || result.error;
    } catch {}
    if (response.status === 404) {
      return `No se pudo ${operation} (HTTP 404). El servidor activo no tiene registrada esta ruta; reinícialo para cargar el código actualizado.`;
    }
    const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    return `No se pudo ${operation} (HTTP ${response.status})${title ? `: ${title}` : '.'}`;
  };
  const reportFetchError = (error, operation) => {
    console.error(`Avatar request ${operation} failed:`, error);
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      return `No se pudo conectar con el servidor para ${operation}. Comprueba que la aplicación siga activa. (${error.message})`;
    }
    return error.message;
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const selectionId = ++avatarSelectionId;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'];
    const allowedMimes = [
      'image/jpeg', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'
    ];
    if ((!allowedExtensions.includes(extension) && !allowedMimes.includes(file.type)) || file.size > maxAvatarBytes) {
      fileInput.value = '';
      feedback.textContent = file.size > maxAvatarBytes
        ? 'La fotografía original no puede superar los 20 MB.'
        : 'Elige una fotografía JPG, JPEG, PNG, WebP, GIF, HEIC o HEIF.';
      return;
    }
    croppedAvatar = null;
    saveButton.disabled = true;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = null;
    previewObjectUrl = URL.createObjectURL(file);
    updatePreview(previewObjectUrl);
    feedback.textContent = 'Fotografía seleccionada. Preparando vista previa…';

    const previewData = new FormData();
    previewData.append('_csrf', avatarForm.querySelector('[name="_csrf"]').value);
    previewData.append('avatar', file, file.name);
    fetch('/perfil/avatar/preview', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-CSRF-Token': avatarForm.querySelector('[name="_csrf"]').value
      },
      body: previewData
    }).then(async (response) => {
      if (selectionId !== avatarSelectionId) return;
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'preparar la fotografía'));
      }
      const normalizedImage = await response.blob();
      if (!normalizedImage.size) throw new Error('El servidor no devolvió una vista previa de la fotografía.');
      sourceObjectUrl = URL.createObjectURL(normalizedImage);
      sourceImage = new Image();
      sourceImage.onload = () => {
        if (selectionId !== avatarSelectionId) return;
        modal.hidden = false;
        zoomControl.value = '1';
        cropImage.src = sourceObjectUrl;
        centerCrop();
        feedback.textContent = 'Ajusta el encuadre y confirma el recorte.';
        modal.querySelector('[data-avatar-crop-cancel]').focus();
      };
      sourceImage.onerror = () => {
        if (selectionId !== avatarSelectionId) return;
        feedback.textContent = 'No se pudo mostrar la fotografía convertida para el recorte.';
        closeCrop(true);
      };
      sourceImage.src = sourceObjectUrl;
    }).catch((error) => {
      if (selectionId !== avatarSelectionId) return;
      feedback.textContent = reportFetchError(error, 'preparar la fotografía');
      closeCrop(true);
    });
  });
  zoomControl.addEventListener('input', () => {
    if (!sourceImage) return;
    const { width, height } = cropBounds();
    const focalX = (width / 2 - imageLeft) / scale;
    const focalY = (height / 2 - imageTop) / scale;
    scale = fitScale * Number(zoomControl.value);
    imageLeft = width / 2 - focalX * scale;
    imageTop = height / 2 - focalY * scale;
    renderCrop();
  });
  zoomInButton.addEventListener('click', () => {
    zoomControl.value = String(Math.min(Number(zoomControl.max), Number(zoomControl.value) + 0.1));
    zoomControl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  zoomOutButton.addEventListener('click', () => {
    zoomControl.value = String(Math.max(Number(zoomControl.min), Number(zoomControl.value) - 0.1));
    zoomControl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  stage.addEventListener('pointerdown', (event) => {
    if (!sourceImage) return;
    pointerStart = { x: event.clientX, y: event.clientY, left: imageLeft, top: imageTop };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    imageLeft = pointerStart.left + event.clientX - pointerStart.x;
    imageTop = pointerStart.top + event.clientY - pointerStart.y;
    renderCrop();
  });
  stage.addEventListener('pointerup', () => { pointerStart = null; });
  stage.addEventListener('pointercancel', () => { pointerStart = null; });
  zoomControl.addEventListener('change', renderCrop);
  cropCancelButtons.forEach((button) => button.addEventListener('click', () => closeCrop(true)));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeCrop(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeCrop(true);
  });
  confirmCropButton.addEventListener('click', async () => {
    confirmCropButton.disabled = true;
    try {
      const blob = await encodeCrop();
      croppedAvatar = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(croppedAvatar);
      updatePreview(previewObjectUrl);
      saveButton.disabled = false;
      feedback.textContent = 'Recorte listo. Pulsa GUARDAR AVATAR para subirlo.';
      closeCrop(false);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      confirmCropButton.disabled = false;
    }
  });
  avatarForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!croppedAvatar) {
      feedback.textContent = 'Selecciona y confirma el recorte de una imagen antes de guardar.';
      return;
    }
    saveButton.disabled = true;
    feedback.textContent = 'Guardando avatar…';
    try {
      const formData = new FormData();
      formData.append('_csrf', avatarForm.querySelector('[name="_csrf"]').value);
      formData.append('avatar', croppedAvatar, croppedAvatar.name);
      const response = await fetch(avatarForm.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-CSRF-Token': avatarForm.querySelector('[name="_csrf"]').value },
        body: formData
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, 'guardar el avatar'));
      const result = await response.json();
      if (!result.avatar) throw new Error('El servidor no devolvió la ruta del avatar guardado.');
      feedback.textContent = result.message;
      avatarForm.querySelector('[data-avatar-remove]').disabled = false;
      savedAvatarUrl = result.avatar;
      updatePreview(result.avatar);
      updateNavigationAvatar(result.avatar);
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
      croppedAvatar = null;
      fileInput.value = '';
    } catch (error) {
      feedback.textContent = reportFetchError(error, 'guardar el avatar');
    } finally {
      saveButton.disabled = !croppedAvatar;
    }
  });
  avatarForm.querySelector('[data-avatar-remove]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch('/perfil/avatar/eliminar', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': avatarForm.querySelector('[name="_csrf"]').value
        },
        body: '{}'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'No se pudo eliminar el avatar.');
      const fallback = document.createElement('span');
      fallback.className = 'avatar avatar-profile avatar-initial';
      fallback.dataset.avatarPreview = '';
      fallback.textContent = document.querySelector('.profile-settings-heading h1').textContent.trim().slice(0, 1).toUpperCase();
      document.querySelector('[data-avatar-preview]').replaceWith(fallback);
      updateNavigationAvatar(null);
      savedAvatarUrl = null;
      croppedAvatar = null;
      saveButton.disabled = true;
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
      fileInput.value = '';
      feedback.textContent = result.message;
    } catch (error) {
      feedback.textContent = error.message;
      button.disabled = false;
    }
  });
}

document.querySelectorAll('.moderation-form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});
