# Repository Guidelines

This document outlines contribution guidelines for the Pitty CLI project — an AI coding assistant for your terminal.

## Project Structure

- **`pitty.js`**: Main entry point and CLI bootstrap
- **`lib/`**: Core modules and tool implementations
  - `lib/tools/`: Individual tool implementations (bash, edit, read, etc.)
  - `lib/lang/`: Internationalization files (en, zh)
- **`test/`**: Unit tests using Node.js test runner
- **`PITTY.md`**: Main documentation

## Development Commands

- `npm start`: Run the CLI locally
- `npm test`: Run all unit tests with Node.js built-in test runner

Requires Node.js 18+. All dependencies are installed via `npm install`.

## Coding Style

- 2-space indentation for JavaScript
- CommonJS module format (`require()`/`module.exports`)
- camelCase for variables and functions, PascalCase for constructors
- No automatic formatter is currently enforced; maintain consistency with surrounding code
- Prefer concise, direct code with minimal dependencies

## Testing Guidelines

- Uses Node.js native `node:test` framework
- Tests are located in `test/` with naming pattern `*.test.js`
- Run all tests with `npm test`
- Add tests for new tools and core functionality when possible

## Commit & Pull Requests

- Commit messages are currently automated with timestamps; when contributing, use clear descriptive messages
- Pull requests should link to any related issues
- Describe what changed and why, test results should be included for functional changes

## Agent Instructions

When working in this repository:
- Follow existing coding style
- Run tests after making changes to verify nothing breaks
- Keep changes focused and minimal to reduce review time
