# Acorn - Node.js TypeScript Backend

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
acorn/
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
npm install
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

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project for production
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio

## 🚀 Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Start the development server:

```bash
pnpm dev
```

3. The server will be running at `http://localhost:3000`

## 🗄️ Database Setup

This project uses Prisma as the database toolkit. To set up your database:

1. Configure your database URL in the `.env` file
2. Generate Prisma client:

```bash
npx prisma generate
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
