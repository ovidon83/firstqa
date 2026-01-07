#!/bin/bash
# Script to add Bitbucket credentials to .env file

echo "Adding Bitbucket credentials to .env file..."

# Generate webhook secret
WEBHOOK_SECRET=$(node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'))")

# Add to .env file
echo "" >> .env
echo "# Bitbucket Integration" >> .env
echo "BITBUCKET_CLIENT_ID=YmY4Kmgz2PZ1oHnF2xYHK4eTPLltti3B" >> .env
echo "BITBUCKET_CLIENT_SECRET=ATOAppO7Oc8ZohgWimHoU9u3AUONZQZqXDlmi9hlyVBK7edp3gsQtUe8AvgI6TjVhdxy5EFD154C" >> .env
echo "BITBUCKET_CALLBACK_URL=https://firstqa.dev/api/auth/bitbucket/callback" >> .env
echo "BITBUCKET_WEBHOOK_SECRET=$WEBHOOK_SECRET" >> .env

echo "✅ Bitbucket credentials added to .env"
echo "Webhook secret generated: $WEBHOOK_SECRET"
echo ""
echo "⚠️  IMPORTANT: Make sure to configure this webhook secret in your Bitbucket repository webhook settings!"

