const express = require('express');
const router = express.Router();

// GET /support
router.get('/', (req, res) => {
  res.render('support');
});

module.exports = router; 