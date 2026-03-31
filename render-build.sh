#!/bin/bash
# Render build script - forces clean install to fix corrupted node_modules

echo "🧹 Cleaning up any existing node_modules..."
rm -rf node_modules
rm -rf package-lock.json

echo "📦 Installing dependencies (clean install)..."
npm install --no-cache --prefer-offline=false

echo "✅ Build complete!"
