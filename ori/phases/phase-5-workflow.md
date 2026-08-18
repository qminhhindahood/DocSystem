# Phase 5: Agentic Workflow Engine

> Current backend note: The workflow still follows Planner → Researcher → Writer, but Python/FastAPI examples in this original phase are legacy. Implement the API with Express/TypeScript routes and middleware as described in `../reference/CURRENT_BACKEND_CONTRACT.md`.

## 5.1 Agent Orchestrator

The orchestrator manages the three-agent pipeline: Planner → Researcher → Writer.

```python
# backend/services/orchestrator.py
from typing import Dict, Any, Optional
import asyncio
from datetime import datetime
from dataclasses import dataclass, asdict
import json

@dataclass
class AgentState:
    """Track state across agent executions."""
    session_id: str
    user_request: str
    doc_type: str
    phase: str = "init"
    plan: Optional[Dict] = None
    research: Optional[Dict] = None
    draft: Optional[Dict] = None
    errors: list = None
    metadata: Dict = None

    def to_dict(self):
        return asdict(self)

class AgentOrchestrator:
    """
    Manages the agentic workflow:
    Planner → Researcher → Writer
    """

    def __init__(self, rag_service, ollama_service):
        self.rag = rag_service
        self.ollama = ollama_service
        self.prompts = PromptTemplates()

    async def execute_workflow(
        self,
        user_request: str,
        doc_type: str,
        template_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> AsyncIterator[Dict]:
        """
        Execute full workflow with streaming updates.
        Yields phase completions for real-time UI updates.
        """
        state = AgentState(
            session_id=session_id or f"sess_{datetime.now().timestamp()}",
            user_request=user_request,
            doc_type=doc_type,
            metadata={"started_at": datetime.now().isoformat()}
        )

        try:
            # PHASE 1: Planning
            yield {"phase": "planning", "status": "starting"}
            state.phase = "planning"

            plan = await self._run_planner(user_request, doc_type)
            state.plan = plan
            yield {"phase": "planning", "status": "completed", "result": plan}

            # PHASE 2: Research
            yield {"phase": "research", "status": "starting"}
            state.phase = "research"

            research = await self._run_researcher(plan)
            state.research = research
            yield {"phase": "research", "status": "completed", "result": research}

            # PHASE 3: Writing
            yield {"phase": "writing", "status": "starting"}
            state.phase = "writing"

            # Stream writing progress
            async for chunk in self._run_writer_stream(plan, research, template_id):
                yield {"phase": "writing", "status": "streaming", "chunk": chunk}

            final_doc = json.loads(chunk)  # Final JSON document
            state.draft = final_doc
            yield {"phase": "writing", "status": "completed", "result": final_doc}

            # Complete
            yield {"phase": "complete", "status": "success", "session_id": state.session_id}

        except Exception as e:
            state.errors.append(str(e))
            yield {"phase": state.phase, "status": "error", "error": str(e)}

    async def _run_planner(self, user_request: str, doc_type: str) -> Dict:
        """Execute Planner agent."""
        prompt = self.prompts.build_planner_prompt(user_request, doc_type)

        response = await self.ollama.generate(
            prompt=prompt,
            system=self.prompts.PLANNER_SYSTEM,
            options={"temperature": 0.2}  # Low temp for structured output
        )

        try:
            # Clean response - extract JSON only
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            json_str = response[json_start:json_end]

            return json.loads(json_str)
        except json.JSONDecodeError:
            raise Exception(f"Planner returned invalid JSON: {response[:200]}")

    async def _run_researcher(self, plan: Dict) -> Dict:
        """Execute Researcher agent with RAG."""
        # Search for relevant legal basis
        query = plan.get('title', '') + ' ' + ' '.join(plan.get('required_sections', []))
        rag_results = await self.rag.search(query, doc_type=plan.get('document_type'))

        rag_context = self.prompts.build_rag_context(rag_results)
        prompt = self.prompts.build_researcher_prompt(plan, rag_context)

        response = await self.ollama.generate(
            prompt=prompt,
            system=self.prompts.RESEARCHER_SYSTEM,
            options={"temperature": 0.1}
        )

        try:
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            return json.loads(response[json_start:json_end])
        except json.JSONDecodeError:
            raise Exception(f"Researcher returned invalid JSON")

    async def _run_writer_stream(self, plan: Dict, research: Dict, template_id: Optional[str]):
        """Execute Writer agent with streaming."""
        template = {}
        if template_id:
            template = await self._load_template(template_id)

        prompt = self.prompts.build_writer_prompt(plan, research, template)

        full_response = ""
        async for token in self.ollama.generate_stream(prompt, self.prompts.WRITER_SYSTEM):
            full_response += token
            yield token  # Stream to UI

    async def _load_template(self, template_id: str) -> Dict:
        """Load template from database."""
        # Implement template loading
        return {}
```

## 5.2 Legacy FastAPI Routes

The following route shape is retained as original planning material. For implementation, use Express/TypeScript endpoints from `../reference/CURRENT_BACKEND_CONTRACT.md`.

```python
# backend/routes/workflow.py
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/workflow", tags=["workflow"])

class GenerationRequest(BaseModel):
    query: str
    doc_type: str
    template_id: Optional[str] = None
    use_rag: bool = True

class GenerationResponse(BaseModel):
    session_id: str
    status: str
    message: str

@router.post("/generate")
async def start_generation(
    request: GenerationRequest,
    background_tasks: BackgroundTasks
):
    """Start async document generation."""
    orchestrator = AgentOrchestrator(rag_service, ollama_service)

    session_id = f"sess_{datetime.now().timestamp()}"

    # Store initial state in Redis or DB for polling
    await store_session_state(session_id, {
        "status": "running",
        "phase": "init",
        "request": request.dict()
    })

    # Run in background
    background_tasks.add_task(
        run_workflow_background,
        session_id,
        orchestrator,
        request
    )

    return GenerationResponse(
        session_id=session_id,
        status="started",
        message="Generation started. Poll /api/workflow/status/{session_id}"
    )

@router.get("/status/{session_id}")
async def get_status(session_id: str):
    """Poll generation status."""
    state = await get_session_state(session_id)
    return state or {"error": "Session not found"}

async def run_workflow_background(session_id: str, orchestrator: AgentOrchestrator, request: GenerationRequest):
    """Run workflow in background and store results."""
    try:
        async for update in orchestrator.execute_workflow(
            user_request=request.query,
            doc_type=request.doc_type,
            template_id=request.template_id,
            session_id=session_id
        ):
            await store_session_state(session_id, update)

        await store_session_state(session_id, {
            "status": "completed",
            "completed_at": datetime.now().isoformat()
        })
    except Exception as e:
        await store_session_state(session_id, {
            "status": "failed",
            "error": str(e)
        })
```

## 5.3 State Persistence

```python
# backend/services/state_store.py
import aioredis
import json
from datetime import timedelta

class StateStore:
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = aioredis.from_url(redis_url, decode_responses=True)

    async def store(self, session_id: str, state: Dict, ttl: int = 3600):
        """Store session state in Redis."""
        key = f"workflow:{session_id}"
        await self.redis.set(key, json.dumps(state), ex=ttl)

    async def get(self, session_id: str) -> Optional[Dict]:
        """Get session state."""
        key = f"workflow:{session_id}"
        data = await self.redis.get(key)
        return json.loads(data) if data else None

    async def delete(self, session_id: str):
        """Clean up session."""
        await self.redis.delete(f"workflow:{session_id}")
```

## 5.4 Error Recovery & Retries

```python
# backend/services/retry_handler.py
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

class RetryableError(Exception):
    pass

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(RetryableError)
)
async def safe_ollama_call(ollama, prompt, system):
    """Retry failed Ollama calls."""
    try:
        return await ollama.generate(prompt, system)
    except Exception as e:
        if "timeout" in str(e).lower() or "connection" in str(e).lower():
            raise RetryableError(f"Ollama call failed: {e}")
        raise
```
