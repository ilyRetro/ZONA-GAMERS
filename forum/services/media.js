const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const uploadsDirectory = path.resolve(
  process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads')
);

function imageProcessingError(operation, cause) {
  const error = new Error(`Sharp no pudo ${operation}: ${cause.message}`, { cause });
  error.status = 400;
  return error;
}

const mediaTypes = {
  '.jpg': { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  '.png': { mime: 'image/png', extensions: ['.png'], signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.webp': { mime: 'image/webp', extensions: ['.webp'], signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
  '.gif': { mime: 'image/gif', extensions: ['.gif'], signature: (buffer) => buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) },
  '.mp4': { mime: 'video/mp4', extensions: ['.mp4'], signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' },
  '.webm': { mime: 'video/webm', extensions: ['.webm'], signature: (buffer) => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }
};

const avatarTypes = [
  {
    extension: '.jpg',
    mime: 'image/jpeg',
    signature: (buffer) => buffer.length >= 3
      && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  {
    extension: '.png',
    mime: 'image/png',
    signature: (buffer) => buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    extension: '.webp',
    mime: 'image/webp',
    signature: (buffer) => buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP'
  },
  {
    extension: '.gif',
    mime: 'image/gif',
    signature: (buffer) => buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))
  },
  {
    extension: '.jpg',
    mime: 'image/jpeg',
    format: 'heif',
    signature: (buffer) => {
      if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
      const brands = buffer.toString('ascii', 8, Math.min(buffer.length, 128));
      return /\b(?:heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)\b/.test(brands);
    }
  }
];

async function writeMedia(buffer, type) {
  const filename = `${crypto.randomUUID()}${type.extension}`;
  const filePath = path.join(uploadsDirectory, filename);
  await fs.promises.mkdir(uploadsDirectory, { recursive: true });
  await fs.promises.writeFile(filePath, buffer, { flag: 'wx', mode: 0o644 });

  return {
    url: `/uploads/${filename}`,
    filename,
    mime: type.mime,
    kind: type.kind || 'image'
  };
}

async function saveMedia(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const type = Object.values(mediaTypes).find((candidate) =>
    candidate.mime === file.mimetype && candidate.extensions.includes(extension));
  if (!type || !type.signature(file.buffer)) {
    const error = new Error('El archivo no coincide con un formato de imagen o video admitido.');
    error.status = 400;
    throw error;
  }

  const canonicalExtension = Object.entries(mediaTypes)
    .find(([, candidate]) => candidate === type)[0];
  return writeMedia(file.buffer, {
    extension: canonicalExtension,
    mime: type.mime,
    kind: type.mime.startsWith('image/') ? 'image' : 'video'
  });
}

async function saveAvatarImage(file) {
  let metadata;
  try {
    metadata = await sharp(file.buffer).metadata();
  } catch (error) {
    throw imageProcessingError('leer la imagen. Comprueba que esté completa y sea JPG, PNG, WebP, GIF o HEIC/HEIF', error);
  }

  const type = avatarTypes.find((candidate) =>
    candidate.format
      ? metadata.format === candidate.format && candidate.signature(file.buffer)
      : metadata.format === candidate.mime.split('/')[1] && candidate.signature(file.buffer));
  if (!type) {
    const error = new Error('El contenido no es una imagen JPG, PNG, WebP, GIF o HEIC/HEIF admitida.');
    error.status = 400;
    throw error;
  }

  let normalized;
  try {
    normalized = await sharp(file.buffer)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    throw imageProcessingError('convertir la imagen', error);
  }
  return writeMedia(normalized, { extension: '.jpg', mime: 'image/jpeg' });
}

async function createAvatarPreview(file) {
  let metadata;
  try {
    metadata = await sharp(file.buffer).metadata();
  } catch (error) {
    throw imageProcessingError('decodificar la foto. Usa un archivo completo en formato JPG, PNG, WebP, GIF o HEIC/HEIF', error);
  }

  const type = avatarTypes.find((candidate) =>
    candidate.format
      ? metadata.format === candidate.format && candidate.signature(file.buffer)
      : metadata.format === candidate.mime.split('/')[1] && candidate.signature(file.buffer));
  if (!type) {
    const error = new Error('El formato real de la imagen no coincide con JPG, PNG, WebP, GIF o HEIC/HEIF.');
    error.status = 400;
    throw error;
  }

  try {
    return await sharp(file.buffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    throw imageProcessingError('convertir esta foto. Prueba con otra imagen o expórtala como JPG o PNG', error);
  }
}

async function removeMedia(filename) {
  await fs.promises.unlink(path.join(uploadsDirectory, filename));
}

module.exports = { createAvatarPreview, removeMedia, saveAvatarImage, saveMedia, uploadsDirectory };
