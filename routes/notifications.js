const express = require('express');
const router = express.Router();

// Marks current session notifications as read
router.post('/notifications/mark-read', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  req.session.notificationLastReadAt = new Date();
  return res.json({ ok: true });
});

module.exports = router;
