#!/bin/bash

# Simple script to create placeholder PNG icons
# This creates minimal 1x1 PNG files that will work for testing

echo "Creating placeholder PNG icons..."

# Create a minimal PNG file (1x1 pixel, transparent)
# PNG header + minimal data
cat > icon16.png << 'EOF'
�PNG

   �a   �a   �IDATx�c`�    IEND�B`�
EOF

cat > icon48.png << 'EOF'
�PNG

   �a   �a   �IDATx�c`�    IEND�B`�
EOF

cat > icon128.png << 'EOF'
�PNG

   �a   �a   �IDATx�c`�    IEND�B`�
EOF

echo "Placeholder icons created!"
echo "Note: These are minimal placeholders. For production, convert the SVG to proper PNG files."
