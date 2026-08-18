# Phase 4: Ollama Integration & Model Setup

> Current backend note: Ollama concepts and prompt guidance remain useful, but backend wrapper and streaming route examples should be implemented in Express/TypeScript. See `../reference/CURRENT_BACKEND_CONTRACT.md`.

## 4.1 Qwen3.6-14B Configuration

### Custom Modelfile for Vietnamese State Documents
```dockerfile
# backend/ollama-modelfile
FROM qwen3.6:14b

# System prompt for state document tone
SYSTEM """
Bạn là trợ lý hành chính nhà nước chuyên nghiệp. Khi soạn thảo văn bản:

1. Sử dụng ngôn ngữ trang trọng, chính xác, khách quan
2. Tuân thủ mẫu văn bản hành chính theo Nghị định 30/2020/NĐ-CP
3. Cấu trúc: Số/ký hiệu, tiêu đề, nơi nhận, nội dung, ký tên, đóng dấu
4. Không sử dụng ngôn ngữ đối thoại, tiếng lóng, hoặc biểu cảm
5. Luôn trả về JSON với trường: "content", "metadata", "templates_used"

Khi được yêu cầu soạn thảo:
- Phân tích yêu cầu
- Tìm căn cứ pháp lý từ RAG
- Lập dàn ý
- Soạn thảo theo mẫu chuẩn
"""

# Vietnamese tokenizer optimization
PARAMETER num_ctx 4096
PARAMETER num_batch 512
PARAMETER num_gqa 16
PARAMETER num_gpu_layers 35  # Offload 35 layers to 8GB VRAM

# Temperature for deterministic output
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1

# Qwen3.6-specific optimizations
PARAMETER num_ctx 8192  # Extended context for 128K window support
```

### Build Custom Model
```bash
cd backend
ollama create airabbit-qwen -f ./Modelfile
```

### Service Wrapper for Backend
```python
# backend/services/ollama_service.py
import requests
import json
from typing import Dict, Any, AsyncIterator
import asyncio

class OllamaService:
    def __init__(self, model: str = "airabbit-qwen", base_url: str = "http://localhost:11434"):
        self.model = model
        self.base_url = base_url

    async def generate(
        self,
        prompt: str,
        system: str = None,
        stream: bool = False,
        options: Dict = None
    ) -> str:
        """Generate response from Ollama (Qwen3.6 optimized)."""

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": stream,
            "options": options or {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": 2048
            }
        }

        if system:
            payload["system"] = system

        response = requests.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=120
        )

        if response.status_code != 200:
            raise Exception(f"Ollama error: {response.text}")

        return response.json()["response"]

    async def generate_stream(
        self,
        prompt: str,
        system: str = None
    ) -> AsyncIterator[str]:
        """Stream response for real-time UI updates."""

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": True,
            "options": {"temperature": 0.3}
        }

        if system:
            payload["system"] = system

        response = requests.post(
            f"{self.base_url}/api/generate",
            json=payload,
            stream=True
        )

        for line in response.iter_lines():
            if line:
                data = json.loads(line)
                if "response" in data:
                    yield data["response"]

    def health_check(self) -> bool:
        """Check if Ollama is running."""
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return response.status_code == 200
        except:
            return False

    def list_models(self) -> List[Dict]:
        """List available models."""
        response = requests.get(f"{self.base_url}/api/tags")
        return response.json().get("models", [])
```

## 4.2 Prompt Templates for Document Generation

```python
# backend/services/prompt_templates.py
from typing import List, Dict

class PromptTemplates:
    """Templates optimized for Decree 30/2020 formatting."""

    PLANNER_SYSTEM = """
Bạn là Planner - trợ lý lập kế hoạch soạn thảo văn bản hành chính.

Nhiệm vụ:
1. Phân tích yêu cầu người dùng
2. Xác định loại văn bản (thuộc, quyết định, nghị định, thông tư, ...)
3. Xác định cấu trúc cần thiết
4. Liệt kê các phần cần soạn thảo

Đầu ra: JSON với schema:
{
  "document_type": "loai_van_ban",
  "title": "tiêu_đề",
  "required_sections": ["phần1", "phần2", ...],
  "legal_basis_needed": ["căn_cứ_pháp_lý_1", ...],
  "template_reference": "mẫu_số"
}

Chỉ trả JSON, không có giải thích.
"""

    RESEARCHER_SYSTEM = """
Bạn là Researcher - chuyên gia tìm kiếm căn cứ pháp lý.

Nhiệm vụ:
1. Tìm các điều, khoản, điểm pháp luật liên quan từ RAG results
2. Trích dẫn chính xác: "Điều X Luật Y" hoặc "Khoản Z Nghị định ABC"
3. Tóm tắt nội dung liên quan

Đầu ra: JSON với schema:
{
  "relevant_laws": [
    {
      "law_name": "tên_văn_bản",
      "article": "số_điều",
      "clause": "số_khoản",
      "content": "trích_dẫn",
      "relevance": "mức_độ_liên_quan"
    }
  ]
}
"""

    WRITER_SYSTEM = """
Bạn là Writer - soạn thảo văn bản hành chính chuẩn.

Nguyên tắc:
1. Tuân thủ mẫu quy định tại Nghị định 30/2020/NĐ-CP
2. Cấu trúc văn bản:
   - Số/ký hiệu
   - Tiêu đề (in hoa)
   - "Như sau:" hoặc "Quyết định:"
   - Nội dung (chia đoạn, đánh số)
   - Nơi nhận
   - Thư ký
   - Ký tên, chức vụ, đóng dấu

3. Ngôn ngữ: trang trọng, khách quan, không thiên vị
4. Sử dụng từ ngữ pháp lý chính xác

Đầu ra: JSON với schema:
{
  "document": {
    "number": "Số: 123/TTr",
    "title": "V/v...",
    "content": "nội dung_đầy_đủ",
    "signature_block": {
      "place": "Hà Nội, ngày ... tháng ... năm ...",
      "signer": "Họ và tên",
      "position": "Chức vụ"
    }
  },
  "templates_used": ["mẫu_1", "mẫu_2"]
}
"""

    @staticmethod
    def build_rag_context(search_results: List[Dict]) -> str:
        """Format RAG results for context."""
        context = "CĂN CỨ PHÁP LÝ:\n\n"
        for i, result in enumerate(search_results, 1):
            context += f"{i}. {result['document']['filename']}\n"
            context += f"   Điều/Khoản: {result['metadata'].get('article', 'N/A')}\n"
            context += f"   Nội dung: {result['content'][:500]}...\n\n"
        return context

    @staticmethod
    def build_planner_prompt(user_request: str, doc_type: str) -> str:
        return f"""
Yêu cầu người dùng: {user_request}
Loại văn bản dự kiến: {doc_type}

Hãy lập kế hoạch soạn thảo văn bản hành chính.

Các mẫu văn bản hành chính theo Nghị định 30/2020:
- Thông báo
- Quyết định
- Công văn
- Tờ trình
- Báo cáo
- Nghị quyết

Hãy trả về JSON với kế hoạch chi tiết.
"""

    @staticmethod
    def build_researcher_prompt(plan: Dict, rag_context: str) -> str:
        return f"""
Kế hoạch soạn thảo:
{json.dumps(plan, ensure_ascii=False, indent=2)}

Căn cứ pháp lý có sẵn:
{rag_context}

Hãy chọn và trích dẫn căn cứ pháp lý phù hợp nhất.
Trả về JSON danh sách căn cứ.
"""

    @staticmethod
    def build_writer_prompt(plan: Dict, research: Dict, template: Dict) -> str:
        return f"""
Kế hoạch: {json.dumps(plan, ensure_ascii=False, indent=2)}
Căn cứ pháp lý: {json.dumps(research, ensure_ascii=False, indent=2)}
Mẫu tham khảo: {json.dumps(template, ensure_ascii=False, indent=2)}

Hãy soạn thảo văn bản hoàn chỉnh theo mẫu Nghị định 30/2020.
Trả về JSON với document và signature_block.
"""
```

## 4.3 Streaming for Real-time UX

```python
# backend/routes/generate_stream.py
from fastapi import APIRouter, StreamingResponse
import json
import asyncio

router = APIRouter()

@router.post("/generate/stream")
async def generate_stream(request: Dict):
    """Stream generation progress to frontend."""
    ollama = OllamaService()

    async def event_generator():
        # Phase 1: Planning
        yield f"data: {json.dumps({'phase': 'planning', 'status': 'started'})}\n\n"

        planner_prompt = PromptTemplates.build_planner_prompt(
            request['query'], request['doc_type']
        )
        plan = await ollama.generate(planner_prompt, PromptTemplates.PLANNER_SYSTEM)

        yield f"data: {json.dumps({'phase': 'planning', 'status': 'done', 'data': json.loads(plan)})}\n\n"

        # Phase 2: Research
        yield f"data: {json.dumps({'phase': 'research', 'status': 'started'})}\n\n"

        rag_results = await rag_service.search(request['query'])
        rag_context = PromptTemplates.build_rag_context(rag_results)

        research_prompt = PromptTemplates.build_researcher_prompt(json.loads(plan), rag_context)
        research = await ollama.generate(research_prompt, PromptTemplates.RESEARCHER_SYSTEM)

        yield f"data: {json.dumps({'phase': 'research', 'status': 'done', 'data': json.loads(research)})}\n\n"

        # Phase 3: Writing (stream token by token)
        yield f"data: {json.dumps({'phase': 'writing', 'status': 'started'})}\n\n"

        writer_prompt = PromptTemplates.build_writer_prompt(
            json.loads(plan), json.loads(research), request.get('template')
        )

        async for token in ollama.generate_stream(writer_prompt, PromptTemplates.WRITER_SYSTEM):
            yield f"data: {json.dumps({'phase': 'writing', 'token': token})}\n\n"

        yield f"data: {json.dumps({'phase': 'complete', 'status': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
```

## 4.4 GPU Memory Optimization

```bash
# Create ollama service configuration
sudo mkdir -p /etc/ollama
sudo tee /etc/ollama/ollama.service << 'EOF'
[Service]
Environment="OLLAMA_GPU_LAYERS=35"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="CUDA_VISIBLE_DEVICES=0"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
ExecStartPre=/bin/sleep 5
EOF

sudo systemctl daemon-reload
sudo systemctl restart ollama

# Monitor GPU usage
watch -n 1 nvidia-smi
```

### Adaptive Context Length
```python
# backend/services/context_manager.py
class ContextManager:
    """Manage context window efficiently for 8GB VRAM."""

    def __init__(self, max_context: int = 4096):
        self.max_context = max_context
        self.reserved_tokens = 512  # For response
        self.available = max_context - self.reserved_tokens

    def truncate_rag_context(self, results: List[Dict], query: str) -> str:
        """Fit RAG results within context window."""
        query_tokens = len(query.split()) * 1.3  # Rough estimate
        available = self.available - query_tokens

        context = ""
        for result in results:
            chunk = f"{result['content'][:500]}\n"
            if len((context + chunk).split()) > available:
                break
            context += chunk

        return context
```
