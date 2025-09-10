#!/bin/bash

# FirstQA Chrome Extension Release Script
# This script packages the Chrome extension for GitHub release

echo "🚀 Creating FirstQA Chrome Extension Release Package..."

# Create release directory
RELEASE_DIR="chrome_extension_release"
mkdir -p $RELEASE_DIR

# Copy essential extension files
echo "📦 Copying extension files..."
cp chrome_extension/manifest.json $RELEASE_DIR/
cp chrome_extension/popup.html $RELEASE_DIR/
cp chrome_extension/popup.js $RELEASE_DIR/
cp chrome_extension/content.js $RELEASE_DIR/
cp chrome_extension/background.js $RELEASE_DIR/
cp chrome_extension/utils.js $RELEASE_DIR/
cp chrome_extension/formatters.js $RELEASE_DIR/
cp chrome_extension/settings.html $RELEASE_DIR/
cp chrome_extension/settings.js $RELEASE_DIR/
cp chrome_extension/submission.js $RELEASE_DIR/
cp chrome_extension/ui.css $RELEASE_DIR/

# Copy icons
echo "🎨 Copying icons..."
mkdir -p $RELEASE_DIR/icons
cp chrome_extension/icons/icon16.png $RELEASE_DIR/icons/
cp chrome_extension/icons/icon48.png $RELEASE_DIR/icons/
cp chrome_extension/icons/icon128.png $RELEASE_DIR/icons/

# Copy installation guide
echo "📖 Copying installation guide..."
cp chrome_extension/INSTALLATION.md $RELEASE_DIR/

# Create README for release
echo "📝 Creating release README..."
cat > $RELEASE_DIR/README.md << 'EOF'
# FirstQA Chrome Extension - Early Access

## 🚀 Quick Start

1. **Download** this extension package
2. **Extract** the files to a folder on your computer
3. **Follow** the [INSTALLATION.md](INSTALLATION.md) guide
4. **Start analyzing** Jira and Linear tickets!

## 📋 What's Included

- ✅ **Complete Extension**: All files needed for installation
- ✅ **Installation Guide**: Step-by-step setup instructions
- ✅ **Icons**: All required extension icons
- ✅ **Full Functionality**: Jira and Linear ticket analysis

## 🔧 Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked" and select this folder
4. Start using FirstQA on Jira and Linear!

## 📞 Support

- **Email**: hello@firstqa.dev
- **GitHub**: https://github.com/ovidon83/firstqa
- **Documentation**: https://firstqa.dev/docs

---

**Version**: 1.0  
**Last Updated**: September 2024  
**Compatible**: Chrome 88+
EOF

# Create zip file
echo "📦 Creating release package..."
cd $RELEASE_DIR
zip -r ../firstqa-chrome-extension-v1.0.zip . -x "*.DS_Store" "*.git*"
cd ..

# Clean up
echo "🧹 Cleaning up..."
rm -rf $RELEASE_DIR

echo "✅ Release package created: firstqa-chrome-extension-v1.0.zip"
echo "📤 Ready for GitHub release upload!"
echo ""
echo "Next steps:"
echo "1. Go to https://github.com/ovidon83/firstqa/releases"
echo "2. Create a new release"
echo "3. Upload firstqa-chrome-extension-v1.0.zip"
echo "4. Add release notes and publish"
