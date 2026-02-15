const express = require('express');
const router = express.Router();

// GET /docs
router.get('/', (req, res) => {
  res.render('docs');
});

module.exports = router; 