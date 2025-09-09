# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Quartz-based static site generator repository that serves as a documentation/coursework repository. Quartz transforms Markdown content into fully functional websites.

## Architecture

This repository uses Quartz 4.5.1 static site generator with the following structure:

- **content/**: Primary content directory containing course materials organized by semester (e.g., fa25-cs354/)
- **docs/**: Quartz framework documentation
- **public/**: Generated static site output (do not edit directly)
- **quartz/**: Core Quartz framework code including:
  - Components (React-based UI components)
  - Plugins (transformers, filters, emitters)
  - Build pipeline and processing logic

## Common Commands

```bash
# Build and serve locally (default content folder)
npx quartz build --serve

# Development shorthand
npm run dev

# Build and serve docs folder
npm run docs

# Type checking and formatting
npm run check    # TypeScript check + Prettier check
npm run format   # Auto-format with Prettier

# Run tests
npm run test
```

## Build Options

- `-d` or `--directory`: Specify content folder (default: `content`)
- `-v` or `--verbose`: Enable verbose logging
- `-o` or `--output`: Specify output folder (default: `public`)
- `--serve`: Run local preview server
- `--port`: Specify server port
- `--concurrency`: Number of parsing threads

## Key Configuration

Main configuration is in `quartz.config.ts` which controls:

- Site metadata (title, base URL)
- Theme settings (fonts, colors)
- Plugin configuration (markdown processors, page generators)
- Build behavior

## Development Workflow

1. Content goes in `/content/` directory as Markdown files
2. Run `npm run dev` for local development with hot reload
3. Generated site appears in `/public/` directory
4. Do not edit files in `/public/` - they are auto-generated
