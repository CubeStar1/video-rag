## Blocks

### Frontend Experience
- Next.js app for chat, projects, workflow graph, artifact viewing, and authenticated user operations.
- Main UI for triggering repository-driven CI/CD generation.
- Reads project, conversation, and workflow state from Supabase.

### App Server And AI Gateway
- Next.js server routes handle AI chat streaming and tool execution.
- `/api/agent` connects the chat UI to model providers and workflow tools.
- Forwards Supabase session context so backend actions can run on behalf of the user.

### Backend API And Control Plane
- FastAPI backend exposes workflow trigger, status, stop, credential, and GitHub Actions tracking endpoints.
- Shared workflow service is used by both FastAPI and FastMCP.
- Orchestrates asynchronous workflow runs and cancellation handling.

### Agentic Workflow Pipeline
- Six-stage pipeline:
  1. Repo Input
  2. Analysis Agent
  3. Planning Agent
  4. YAML Generation
  5. Validation
  6. PR Automation
- Generation and validation form a retry loop up to 3 attempts.
- Produces artifacts like repo facts, workflow plans, generated YAML, validation results, and PR metadata.

### Persistence And Identity
- Supabase Auth handles user identity and JWT-backed access.
- Supabase DB stores projects, conversations, messages, workflow runs, stages, events, and artifacts.
- RLS policies scope access to the owning user.

### External Services And Runtime
- Mistral provides structured reasoning for analysis, planning, generation, and validation.
- GitHub is the source repo, PR target, and GitHub Actions execution environment.
- FastMCP exposes the same backend workflow capability for MCP clients.
- Docker and Azure are the intended deployment/runtime options.

---

## Connections

- `Frontend Experience -> App Server And AI Gateway`
  - User chat and workflow actions go through `/api/agent`.

- `Frontend Experience -> Persistence And Identity`
  - Project lists, conversations, and workflow history are loaded from Supabase.

- `App Server And AI Gateway -> Backend API And Control Plane`
  - Workflow tools call backend trigger, status, and stop endpoints.

- `Backend API And Control Plane -> Persistence And Identity`
  - Workflow runs, stages, events, and artifacts are persisted to Supabase.

- `Backend API And Control Plane -> Agentic Workflow Pipeline`
  - FastAPI starts and manages the async six-stage orchestration flow.

- `Agentic Workflow Pipeline -> External Services And Runtime`
  - Uses Mistral for reasoning and GitHub for repo access, PR creation, and Actions tracking.

- `Agentic Workflow Pipeline -> Persistence And Identity`
  - Writes stage outputs and workflow artifacts to Supabase and local temp storage.

- `External Services And Runtime -> Frontend Experience`
  - Results return indirectly through backend state and frontend workflow views.

---

## Mermaid

```mermaid
flowchart LR
    FE[Frontend Experience<br/>Next.js UI for chat, projects, workflow graph, artifacts]
    AG[App Server and AI Gateway<br/>Next.js API routes, AI streaming, workflow tools]
    BE[Backend API and Control Plane<br/>FastAPI, workflow service, orchestration control]
    PL[Agentic Workflow Pipeline<br/>Repo Input -> Analysis -> Planning -> YAML Gen -> Validation -> PR]
    DB[Persistence and Identity<br/>Supabase Auth, DB, workflow runs, stages, artifacts]
    EX[External Services and Runtime<br/>Mistral, GitHub, FastMCP, Docker/Azure]

    FE --> AG
    FE --> DB
    AG --> BE
    BE --> DB
    BE --> PL
    PL --> DB
    PL --> EX
    EX -. results/status .-> FE
```

## More detailed Mermaid

```mermaid
flowchart TD
    U[User]
    FE[Frontend Experience<br/>Next.js pages<br/>Chat UI<br/>Workflow graph<br/>Artifact panel]
    AG[App Server and AI Gateway<br/>/api/agent<br/>Model provider layer<br/>Workflow tool wrappers]
    BE[Backend API and Control Plane<br/>FastAPI routes<br/>workflow_service<br/>workflow_registry<br/>workflow_orchestrator]
    DB[Supabase<br/>Auth<br/>Projects<br/>Conversations<br/>Messages<br/>Workflow runs/stages/events/artifacts]
    M[Mistral<br/>Structured reasoning]
    G[GitHub<br/>Repo clone<br/>PR creation<br/>Actions tracking]
    MCP[FastMCP<br/>Optional MCP access]

    subgraph PIPE[Agentic Workflow Pipeline]
        R1[1. Repo Input]
        R2[2. Analysis Agent]
        R3[3. Planning Agent]
        R4[4. YAML Generation]
        R5[5. Validation]
        R6[6. PR Automation]
        R4 --> R5
        R5 -- retry up to 3x --> R4
        R5 --> R6
        R1 --> R2 --> R3 --> R4
    end

    U --> FE
    FE --> AG
    FE --> DB
    AG --> BE
    BE --> PIPE
    BE --> DB
    PIPE --> DB
    R2 --> M
    R3 --> M
    R4 --> M
    R5 --> M
    R1 --> G
    R6 --> G
    G --> BE
    MCP --> BE
```

If you want, I can also turn this into a clean `ARCHITECTURE.md` file in the repo.