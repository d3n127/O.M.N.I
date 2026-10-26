/*
 * Image uploads: a profile picture for any signed-in user, and a logo for an adviser's organization.
 * The browser sends the raw file as the request body (see public/js/shared/common.js).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../conn');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_BYTES = 2 * 1024 * 1024;

/* File type from the first bytes, so a renamed file cannot sneak in. Returns an extension or null. */
function imageExtension(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') {
    return 'png';
  }
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/* Delete a previously uploaded file; seeded images outside /uploads/ are left alone. */
function removeOldFile(webPath) {
  if (!webPath || !webPath.startsWith('/uploads/')) {
    return;
  }
  fs.unlink(path.join(UPLOAD_DIR, path.basename(webPath)), () => {});
}

/* Save the uploaded image and give its web path. done(err, webPath | null, message) */
function saveImage(req, prefix, done) {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return done(null, null, 'Choose an image file (JPG, PNG or WebP, up to 2 MB).');
  }
  const ext = imageExtension(buf);
  if (!ext) {
    return done(null, null, 'Only JPG, PNG or WebP images are allowed.');
  }
  const name = `${prefix}-${Date.now()}.${ext}`;
  fs.writeFile(path.join(UPLOAD_DIR, name), buf, (err) => done(err, '/uploads/' + name));
}

const readImage = express.raw({ type: 'image/*', limit: MAX_BYTES });

function reply(res, ok, message, url) {
  res.status(ok ? 200 : 400).json({ ok, message, url });
}

function uploadAvatar(req, res, next) {
  const uid = req.session.user.id;
  saveImage(req, `u${uid}`, (err, url, message) => {
    if (err) {
      return next(err);
    }
    if (!url) {
      return reply(res, false, message);
    }
    db.query('SELECT avatar FROM users WHERE id = ?', [uid], (err, rows) => {
      if (err) {
        return next(err);
      }
      db.query('UPDATE users SET avatar = ? WHERE id = ?', [url, uid], (err) => {
        if (err) {
          return next(err);
        }
        removeOldFile(rows[0] && rows[0].avatar);
        reply(res, true, 'Profile picture updated.', url);
      });
    });
  });
}

function uploadOrgLogo(req, res, next) {
  const orgId = req.session.user.org_id;
  saveImage(req, `org${orgId}`, (err, url, message) => {
    if (err) {
      return next(err);
    }
    if (!url) {
      return reply(res, false, message);
    }
    db.query('SELECT logo_img FROM organizations WHERE id = ?', [orgId], (err, rows) => {
      if (err) {
        return next(err);
      }
      db.query('UPDATE organizations SET logo_img = ? WHERE id = ?', [url, orgId], (err) => {
        if (err) {
          return next(err);
        }
        removeOldFile(rows[0] && rows[0].logo_img);
        reply(res, true, 'Organization logo updated.', url);
      });
    });
  });
}

/* Multer-style size errors from express.raw come back as JSON, not an HTML error page. */
function uploadError(err, req, res, next) {
  if (err && err.type === 'entity.too.large') {
    return reply(res, false, 'That image is larger than 2 MB.');
  }
  next(err);
}

router.post('/upload/avatar', requireAuth, readImage, uploadAvatar);
router.post('/upload/org-logo', requireAuth, requireRole('adviser'), readImage, uploadOrgLogo);
router.use(uploadError);

module.exports = router;
