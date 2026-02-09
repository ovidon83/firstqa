#!/bin/bash
# Cleanup stray files from /opt/render/project/src/
echo "🧹 Cleaning up stray files..."
rm -rf src/node_modules src/index.js src/webhook-server.js src/package.json src/package-lock.json
echo "✅ Cleanup complete"
