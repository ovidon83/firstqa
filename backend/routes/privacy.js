const express = require('express');
const router = express.Router();

// GET /privacy
router.get('/', (req, res) => {
  res.render('privacy');
});

module.exports = router; 