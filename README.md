# Acorn Backend

A modern Node.js backend project built with TypeScript, featuring a clean architecture and developer-friendly setup.

## 🚀 Features

- **TypeScript** - Type-safe JavaScript with modern ES features
- **Express.js** - Fast, minimalist web framework
- **ts-node** - Direct TypeScript execution for development
- **nodemon** - Auto-restart development server
- **ESLint** - Code linting with TypeScript support
- **Prettier** - Code formatting
- **Prisma** - Modern database toolkit
- **Security** - Helmet for security headers, CORS support
- **Environment** - dotenv with Zod validation
- **Logging** - Morgan request logging with custom logger

## 📁 Project Structure

```
acorn_back/
├── src/
│   ├── api/          # API routes and server logic
│   ├── config/       # Configuration files (env validation)
│   ├── lib/          # Utility libraries and helpers
│   ├── server.ts     # Express server setup
│   └── index.ts      # Application entry point
├── prisma/
│   └── schema.prisma # Database schema
├── dist/             # Compiled JavaScript (generated)
├── .env              # Environment variables
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc.json
├── nodemon.json
└── README.md
```

## 🛠 Installation

1. Clone the repository
2. Install dependencies:

```bash
pnpm install
```

3. Copy and configure environment variables:

```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `JWT_SECRET`: A secure secret key (minimum 32 characters)
   - `PORT`: Server port (default: 3001)

## 📋 Available Scripts

- `pnpm run dev` - Start development server with hot reload
- `pnpm run build` - Build the project for production
- `pnpm run start` - Start the production server
- `pnpm run lint` - Run ESLint
- `pnpm run lint:fix` - Run ESLint with auto-fix
- `pnpm run format` - Format code with Prettier
- `pnpm run format:check` - Check code formatting
- `pnpm run type-check` - Run TypeScript type checking
- `pnpm run prisma:generate` - Generate Prisma client
- `pnpm run prisma:migrate` - Run database migrations
- `pnpm run prisma:studio` - Open Prisma Studio

## 🚀 Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Start the development server:

```bash
pnpm dev
```

3. The server will be running at `http://localhost:3001`

## 🐳 Docker Development

### Quick Start with Docker

1. **Start development environment:**

```bash
pnpm docker:dev
```

2. **Access services:**
   - API Server: http://localhost:3001
   - pgAdmin: http://localhost:5050 (admin@acorn.com / admin123)
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

3. **Stop services:**

```bash
pnpm docker:dev:down
```

### Docker Commands

- `pnpm docker:dev` - Start development environment
- `pnpm docker:dev:down` - Stop development environment
- `pnpm docker:prod` - Start production environment
- `pnpm docker:prod:down` - Stop production environment
- `pnpm docker:logs` - View service logs
- `pnpm docker:clean` - Clean up Docker resources

### Manual Docker Setup

1. **Copy environment file:**

```bash
cp .env.example .env
```

2. **Build and start services:**

```bash
docker-compose up --build
```

3. **Run database migrations:**

```bash
docker-compose exec api pnpm prisma:migrate
```

## 🗄️ Database Setup

This project uses Prisma as the database toolkit. To set up your database:

1. Configure your database URL in the `.env` file
2. Generate Prisma client:

```bash
pnpm prisma:generate
```

3. Run database migrations:

```bash
npx prisma migrate dev
```

## 🧪 API Endpoints

- `GET /` - Root endpoint with server info
- `GET /health` - Health check endpoint with system info
- `GET /api/hello` - Hello world endpoint

## 🔧 Development

The project includes a comprehensive development setup:

- **Hot reload** with nodemon
- **Type checking** with TypeScript
- **Code linting** with ESLint
- **Code formatting** with Prettier
- **Database management** with Prisma

## 📝 License

MIT
