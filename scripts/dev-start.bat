@echo off
echo 🚀 Starting Acorn development environment...

REM Copy environment file if it doesn't exist
if not exist .env (
    echo 📝 Creating .env file from .env.example...
    copy .env.example .env
)

REM Build and start services
echo 🏗️  Building and starting services...
docker-compose down --remove-orphans
docker-compose up --build -d

REM Wait for services to be ready
echo ⏳ Waiting for services to be ready...
timeout /t 10 /nobreak >nul

REM Check service health
echo 🏥 Checking service health...
docker-compose ps

REM Show logs
echo 📋 Service logs:
docker-compose logs --tail=20

echo.
echo ✅ Development environment is ready!
echo 🌐 API Server: http://localhost:3001
echo 🔧 pgAdmin: http://localhost:5050 (admin@acorn.com / admin123)
echo 📊 Health Check: http://localhost:3001/health
echo.
echo 📚 Useful commands:
echo   - View logs: docker-compose logs -f
echo   - Stop services: docker-compose down
echo   - Restart API: docker-compose restart api
echo   - Shell into API: docker-compose exec api sh

pause
