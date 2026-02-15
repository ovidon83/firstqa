const express = require('express');
const router = express.Router();

// GET /status
router.get('/', (req, res) => {
  res.render('status');
});

module.exports = router; 