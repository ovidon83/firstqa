const express = require('express');
const router = express.Router();

// GET /terms
router.get('/', (req, res) => {
  res.render('terms');
});

module.exports = router; 