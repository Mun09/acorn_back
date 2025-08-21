#!/bin/bash

# Production deployment script
echo "🚀 Deploying Acorn to production..."

# Check if production environment file exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production file not found!"
    echo "Please create .env.production with production settings"
    exit 1
fi

# Build production images
echo "🏗️  Building production images..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Stop existing services
echo "🛑 Stopping existing services..."
docker-compose -f docker-compose.prod.yml down

# Start production services
echo "▶️  Starting production services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 15

# Check health
echo "🏥 Checking service health..."
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "✅ Production deployment complete!"
echo "🌐 API Server: http://localhost (via Nginx)"
echo "📊 Health Check: http://localhost/health"
