# RPA Agent Frontend

## Prerequisites

Before setting up the frontend, ensure you have:

- **Node.js**: Version 20 or higher
- **Service Accounts**:
  - [Supabase](https://supabase.com/) for database and storage
  - [Resend](https://resend.com/) for emails
  - API keys for AI models (OpenAI, Gemini, etc.)

## Setup

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Supabase Setup**:

   - Create a new project at [Supabase](https://supabase.com/).
   - Copy the contents of `lib/supabase/migrations/schema.sql` and run it in the Supabase SQL Editor to set up the database.

3. **Environment Variables**:
   Create a `.env.local` file (copy from `env.example`):

   ```env
    NEXT_PUBLIC_SUPABASE_URL=
    NEXT_PUBLIC_SUPABASE_ANON_KEY=
    NEXT_PUBLIC_SUPABASE_ADMIN=""

    NEXT_PUBLIC_RESEND_API_KEY=
    NEXT_PUBLIC_RESEND_DOMAIN=

    NEXT_PUBLIC_APP_NAME="AI SDK"
    NEXT_PUBLIC_APP_ICON='/next.svg'

    # AI Providers
    OPENAI_API_KEY=""
    GOOGLE_GENERATIVE_AI_API_KEY=
    XAI_API_KEY=""
    GROQ_API_KEY=""
    CEREBRAS_API_KEY=""

    CICD_MCP_URL="http://localhost:8001/mcp"
    BACKEND_WORKFLOW_API_URL="http://localhost:8000"
   ```

4. **Run Dev Server**:
   ```bash
   npm run dev
   ```

## Tech Stack

- **Framework**: Next.js 15
- **AI SDK**: Vercel AI SDK
- **Styling**: Tailwind CSS & Framer Motion
- **UI Components**: Shadcn UI
- **State Management**: Zustand
