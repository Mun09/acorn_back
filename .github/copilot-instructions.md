<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Acorn Backend Project Instructions

This is a Node.js TypeScript backend project with the following stack:

## Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Package Manager**: pnpm
- **Database**: Prisma ORM
- **Linting**: ESLint with TypeScript support
- **Formatting**: Prettier
- **Development**: ts-node, nodemon

## Code Style Guidelines

- Use TypeScript strict mode
- Follow functional programming patterns where appropriate
- Prefer explicit return types for functions
- Use async/await over Promises
- Follow the established directory structure:
  - `src/api/` - API routes and server logic
  - `src/lib/` - Utility functions and shared code
  - `prisma/` - Database schema and migrations

## Development Practices

- Always run `pnpm lint` before committing
- Use `pnpm format` to maintain consistent code style
- Write type-safe code with proper TypeScript annotations
- Follow RESTful API conventions
- Use proper error handling and logging

## Database Guidelines

- Use Prisma for all database operations
- Define clear database models in `schema.prisma`
- Use database migrations for schema changes
- Follow Prisma naming conventions
